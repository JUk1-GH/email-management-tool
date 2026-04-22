from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from werkzeug.security import check_password_hash, generate_password_hash

from .config import Settings
from .errors import AppError

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
FORBIDDEN_SYNC_FIELDS = {
    "password",
    "refresh_token",
    "client_id",
    "client_secret",
    "two_factor_secret",
    "two_factor_backup_codes",
    "2fa_secret",
    "邮箱密码",
    "密码",
    "刷新令牌",
    "辅助邮箱",
    "两步验证",
}
SUPPORTED_PROVIDERS = {"microsoft", "google"}
SUPPORTED_OAUTH_STATUS = {"not_connected", "connected", "expired", "error"}
SECRET_PAYLOAD_FIELDS = {
    "password": "",
    "recovery_email": "",
    "twofa_secret": "",
    "client_id": "",
    "refresh_token": "",
    "token_expires_at": "",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_iso() -> str:
    return utcnow().isoformat()


@contextmanager
def get_connection(settings: Settings) -> Iterator[sqlite3.Connection]:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        yield conn
    finally:
        conn.close()


def initialize_database(settings: Settings) -> None:
    with get_connection(settings) as conn:
        current_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if current_version < 1:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS user_profiles (
                    user_id INTEGER PRIMARY KEY,
                    sync_mode TEXT NOT NULL DEFAULT 'local_plus_cloud',
                    allow_sensitive_sync INTEGER NOT NULL DEFAULT 0,
                    last_cloud_push_at TEXT,
                    last_cloud_pull_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS cloud_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    email_address TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    group_name TEXT NOT NULL DEFAULT '默认分组',
                    status TEXT NOT NULL DEFAULT '正常',
                    note TEXT NOT NULL DEFAULT '',
                    oauth_status TEXT NOT NULL DEFAULT 'not_connected',
                    oauth_email TEXT NOT NULL DEFAULT '',
                    oauth_updated_at TEXT NOT NULL DEFAULT '',
                    import_sequence INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_synced_at TEXT NOT NULL,
                    UNIQUE (user_id, email_address),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
                ON auth_sessions (user_id);

                CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
                ON auth_sessions (expires_at);

                CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_order
                ON cloud_accounts (user_id, import_sequence, email_address);
                """
            )
            conn.execute("PRAGMA user_version = 1")
            current_version = 1

        if current_version < 2:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cloud_account_secrets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    cloud_account_id INTEGER,
                    email_address TEXT NOT NULL,
                    email_address_normalized TEXT NOT NULL,
                    encrypted_payload TEXT NOT NULL,
                    encryption_scheme TEXT NOT NULL DEFAULT 'fernet-v1',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (user_id, email_address_normalized),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (cloud_account_id) REFERENCES cloud_accounts(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_cloud_account_secrets_user_id
                ON cloud_account_secrets (user_id);
                """
            )
            conn.execute("PRAGMA user_version = 2")
            current_version = 2

        if current_version < 3:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS auth_login_attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    attempt_key TEXT NOT NULL UNIQUE,
                    email TEXT NOT NULL,
                    ip_address TEXT NOT NULL DEFAULT '',
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    first_failed_at TEXT NOT NULL,
                    last_failed_at TEXT NOT NULL,
                    locked_until TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_locked_until
                ON auth_login_attempts (locked_until);

                CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_last_failed_at
                ON auth_login_attempts (last_failed_at);
                """
            )
            conn.execute("PRAGMA user_version = 3")
        conn.commit()


def _hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _clean_expired_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (utcnow_iso(),))


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _login_attempt_key(email: str, ip_address: str) -> str:
    return hashlib.sha256(f"{email}\x1f{ip_address.strip()}".encode("utf-8")).hexdigest()


def _clean_old_login_attempts(conn: sqlite3.Connection, settings: Settings) -> None:
    cutoff = utcnow() - timedelta(
        minutes=max(settings.login_rate_window_minutes, settings.login_lockout_minutes, 1) * 4
    )
    conn.execute(
        """
        DELETE FROM auth_login_attempts
        WHERE last_failed_at <= ? AND (locked_until IS NULL OR locked_until <= ?)
        """,
        (cutoff.isoformat(), utcnow_iso()),
    )


def _check_login_rate_limit(
    conn: sqlite3.Connection,
    settings: Settings,
    email: str,
    ip_address: str,
) -> None:
    row = conn.execute(
        "SELECT locked_until FROM auth_login_attempts WHERE attempt_key = ?",
        (_login_attempt_key(email, ip_address),),
    ).fetchone()
    locked_until = _parse_iso_datetime(row["locked_until"]) if row else None
    now = utcnow()
    if locked_until and locked_until > now:
        retry_after = max(1, int((locked_until - now).total_seconds()))
        raise AppError(
            "登录尝试过多，请稍后再试",
            "rate_limited",
            429,
            {"retry_after_seconds": retry_after},
        )


def _record_failed_login_attempt(
    conn: sqlite3.Connection,
    settings: Settings,
    email: str,
    ip_address: str,
) -> None:
    now = utcnow()
    now_iso = now.isoformat()
    key = _login_attempt_key(email, ip_address)
    row = conn.execute(
        """
        SELECT failed_count, first_failed_at
        FROM auth_login_attempts
        WHERE attempt_key = ?
        """,
        (key,),
    ).fetchone()

    window_started_at = _parse_iso_datetime(row["first_failed_at"]) if row else None
    window_minutes = max(settings.login_rate_window_minutes, 1)
    max_failed_attempts = max(settings.login_max_failed_attempts, 1)
    within_window = bool(
        window_started_at
        and window_started_at + timedelta(minutes=window_minutes) > now
    )
    failed_count = int(row["failed_count"]) + 1 if row and within_window else 1
    first_failed_at = row["first_failed_at"] if row and within_window else now_iso
    locked_until = (
        (now + timedelta(minutes=settings.login_lockout_minutes)).isoformat()
        if failed_count >= max_failed_attempts
        else None
    )

    conn.execute(
        """
        INSERT INTO auth_login_attempts (
            attempt_key,
            email,
            ip_address,
            failed_count,
            first_failed_at,
            last_failed_at,
            locked_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
            failed_count = excluded.failed_count,
            first_failed_at = excluded.first_failed_at,
            last_failed_at = excluded.last_failed_at,
            locked_until = excluded.locked_until
        """,
        (key, email, ip_address.strip(), failed_count, first_failed_at, now_iso, locked_until),
    )

    if locked_until:
        raise AppError(
            "登录尝试过多，请稍后再试",
            "rate_limited",
            429,
            {"retry_after_seconds": settings.login_lockout_minutes * 60},
        )


def _clear_failed_login_attempts(
    conn: sqlite3.Connection,
    email: str,
    ip_address: str,
) -> None:
    conn.execute(
        "DELETE FROM auth_login_attempts WHERE attempt_key = ?",
        (_login_attempt_key(email, ip_address),),
    )


def _get_secret_cipher(settings: Settings) -> Fernet:
    key_path = settings.sensitive_key_path
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if not key_path.exists():
        key_path.write_bytes(Fernet.generate_key())
    os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
    return Fernet(key_path.read_bytes().strip())


def _validate_email(email: str) -> str:
    normalized = str(email or "").strip().lower()
    if not EMAIL_RE.match(normalized):
        raise AppError("请输入有效的邮箱地址", "invalid", 400)
    return normalized


def _validate_password(password: str) -> str:
    value = str(password or "")
    if len(value) < 8:
        raise AppError("密码至少需要 8 位字符", "invalid", 400)
    return value


def _serialize_user_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_login_at": row["last_login_at"] or "",
    }


def _serialize_profile_row(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "sync_mode": "local_plus_cloud",
            "allow_sensitive_sync": True,
            "last_cloud_push_at": "",
            "last_cloud_pull_at": "",
        }
    return {
        "sync_mode": row["sync_mode"],
        "allow_sensitive_sync": bool(row["allow_sensitive_sync"]),
        "last_cloud_push_at": row["last_cloud_push_at"] or "",
        "last_cloud_pull_at": row["last_cloud_pull_at"] or "",
    }


def _build_identity_payload(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    user_row = conn.execute(
        """
        SELECT
            users.id,
            users.email,
            users.display_name,
            users.created_at,
            users.updated_at,
            users.last_login_at,
            user_profiles.sync_mode,
            user_profiles.allow_sensitive_sync,
            user_profiles.last_cloud_push_at,
            user_profiles.last_cloud_pull_at
        FROM users
        LEFT JOIN user_profiles ON user_profiles.user_id = users.id
        WHERE users.id = ?
        """,
        (user_id,),
    ).fetchone()
    if user_row is None:
        raise AppError("用户不存在", "not_found", 404)

    cloud_count = int(
        conn.execute(
            "SELECT COUNT(*) FROM cloud_accounts WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
    )
    credential_count = int(
        conn.execute(
            "SELECT COUNT(*) FROM cloud_account_secrets WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
    )

    return {
        "user": _serialize_user_row(user_row),
        "profile": _serialize_profile_row(user_row),
        "cloud_summary": {
            "account_count": cloud_count,
            "credential_count": credential_count,
        },
    }


def _create_session(
    conn: sqlite3.Connection,
    settings: Settings,
    user_id: int,
    user_agent: str,
    ip_address: str,
) -> str:
    issued_at = utcnow()
    raw_token = secrets.token_urlsafe(48)
    conn.execute(
        """
        INSERT INTO auth_sessions (
            user_id,
            token_hash,
            created_at,
            expires_at,
            last_used_at,
            user_agent,
            ip_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            _hash_session_token(raw_token),
            issued_at.isoformat(),
            (issued_at + timedelta(days=settings.auth_session_ttl_days)).isoformat(),
            issued_at.isoformat(),
            user_agent.strip(),
            ip_address.strip(),
        ),
    )
    return raw_token


def register_user(
    settings: Settings,
    email: str,
    password: str,
    display_name: str = "",
    user_agent: str = "",
    ip_address: str = "",
) -> dict[str, Any]:
    normalized_email = _validate_email(email)
    normalized_password = _validate_password(password)
    now = utcnow_iso()

    with get_connection(settings) as conn:
        _clean_expired_sessions(conn)
        try:
            cursor = conn.execute(
                """
                INSERT INTO users (
                    email,
                    password_hash,
                    display_name,
                    created_at,
                    updated_at,
                    last_login_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_email,
                    generate_password_hash(normalized_password),
                    str(display_name or "").strip(),
                    now,
                    now,
                    now,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise AppError("该邮箱已经注册，请直接登录", "conflict", 409) from exc

        user_id = int(cursor.lastrowid)
        conn.execute(
            """
            INSERT INTO user_profiles (
                user_id,
                sync_mode,
                allow_sensitive_sync,
                created_at,
                updated_at
            ) VALUES (?, 'local_plus_cloud', 1, ?, ?)
            """,
            (user_id, now, now),
        )
        token = _create_session(conn, settings, user_id, user_agent, ip_address)
        conn.commit()
        identity = _build_identity_payload(conn, user_id)

    return {"token": token, **identity}


def login_user(
    settings: Settings,
    email: str,
    password: str,
    user_agent: str = "",
    ip_address: str = "",
) -> dict[str, Any]:
    normalized_email = _validate_email(email)
    raw_password = str(password or "")

    with get_connection(settings) as conn:
        _clean_expired_sessions(conn)
        _clean_old_login_attempts(conn, settings)
        _check_login_rate_limit(conn, settings, normalized_email, ip_address)
        row = conn.execute(
            "SELECT id, password_hash, is_active FROM users WHERE email = ?",
            (normalized_email,),
        ).fetchone()
        if row is None or not check_password_hash(row["password_hash"], raw_password):
            try:
                _record_failed_login_attempt(conn, settings, normalized_email, ip_address)
            except AppError:
                conn.commit()
                raise
            else:
                conn.commit()
            raise AppError("邮箱或密码错误", "invalid_credentials", 401)
        if not bool(row["is_active"]):
            raise AppError("当前账号已被停用", "forbidden", 403)

        now = utcnow_iso()
        _clear_failed_login_attempts(conn, normalized_email, ip_address)
        conn.execute(
            "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
            (now, now, row["id"]),
        )
        token = _create_session(conn, settings, int(row["id"]), user_agent, ip_address)
        conn.commit()
        identity = _build_identity_payload(conn, int(row["id"]))

    return {"token": token, **identity}


def resolve_session(
    settings: Settings,
    raw_token: str,
    *,
    touch: bool = True,
) -> dict[str, Any]:
    token = str(raw_token or "").strip()
    if not token:
        raise AppError("缺少登录凭证", "unauthorized", 401)

    with get_connection(settings) as conn:
        _clean_expired_sessions(conn)
        row = conn.execute(
            """
            SELECT auth_sessions.id AS session_id, auth_sessions.user_id
            FROM auth_sessions
            JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ? AND users.is_active = 1
            """,
            (_hash_session_token(token),),
        ).fetchone()
        if row is None:
            raise AppError("登录状态已失效，请重新登录", "unauthorized", 401)

        if touch:
            conn.execute(
                "UPDATE auth_sessions SET last_used_at = ? WHERE id = ?",
                (utcnow_iso(), row["session_id"]),
            )
            conn.commit()

        return _build_identity_payload(conn, int(row["user_id"]))


def logout_session(settings: Settings, raw_token: str) -> None:
    token = str(raw_token or "").strip()
    if not token:
        return

    with get_connection(settings) as conn:
        conn.execute(
            "DELETE FROM auth_sessions WHERE token_hash = ?",
            (_hash_session_token(token),),
        )
        conn.commit()


def _normalize_cloud_account(payload: dict[str, Any], fallback_sequence: int) -> dict[str, Any]:
    for key in FORBIDDEN_SYNC_FIELDS:
        if key in payload:
            raise AppError(
                f"云同步接口不接受敏感字段：{key}",
                "invalid",
                400,
                {"forbidden_field": key},
            )

    email_address = _validate_email(payload.get("email_address") or payload.get("邮箱地址") or "")
    provider = str(payload.get("provider", "microsoft")).strip().lower() or "microsoft"
    if provider not in SUPPORTED_PROVIDERS:
        raise AppError(f"不支持的 provider: {provider}", "invalid", 400)

    oauth_status = str(payload.get("oauth_status", "not_connected")).strip() or "not_connected"
    if oauth_status not in SUPPORTED_OAUTH_STATUS:
        raise AppError(f"不支持的 oauth_status: {oauth_status}", "invalid", 400)

    return {
        "email_address": email_address,
        "provider": provider,
        "group_name": str(payload.get("group_name") or payload.get("分组") or "默认分组").strip()
        or "默认分组",
        "status": str(payload.get("status") or payload.get("状态") or "正常").strip() or "正常",
        "note": str(payload.get("note") or payload.get("备注") or "").strip(),
        "oauth_status": oauth_status,
        "oauth_email": str(payload.get("oauth_email") or "").strip(),
        "oauth_updated_at": str(payload.get("oauth_updated_at") or "").strip(),
        "import_sequence": int(payload.get("import_sequence") or payload.get("导入序号") or fallback_sequence),
    }


def list_cloud_accounts(settings: Settings, user_id: int) -> list[dict[str, Any]]:
    with get_connection(settings) as conn:
        rows = conn.execute(
            """
            SELECT
                email_address,
                provider,
                group_name,
                status,
                note,
                oauth_status,
                oauth_email,
                oauth_updated_at,
                import_sequence,
                updated_at,
                last_synced_at
            FROM cloud_accounts
            WHERE user_id = ?
            ORDER BY import_sequence ASC, email_address ASC
            """,
            (user_id,),
        ).fetchall()
        return [
            {
                "email_address": row["email_address"],
                "provider": row["provider"],
                "group_name": row["group_name"],
                "status": row["status"],
                "note": row["note"],
                "oauth_status": row["oauth_status"],
                "oauth_email": row["oauth_email"],
                "oauth_updated_at": row["oauth_updated_at"],
                "import_sequence": row["import_sequence"],
                "updated_at": row["updated_at"],
                "last_synced_at": row["last_synced_at"],
            }
            for row in rows
        ]


def touch_cloud_pull(settings: Settings, user_id: int) -> str:
    now = utcnow_iso()
    with get_connection(settings) as conn:
        conn.execute(
            "UPDATE user_profiles SET last_cloud_pull_at = ?, updated_at = ? WHERE user_id = ?",
            (now, now, user_id),
        )
        conn.commit()
    return now


def sync_cloud_accounts(
    settings: Settings,
    user_id: int,
    accounts: list[dict[str, Any]],
    *,
    replace_missing: bool,
) -> dict[str, Any]:
    normalized_accounts = [
        _normalize_cloud_account(account, index + 1)
        for index, account in enumerate(accounts)
    ]
    now = utcnow_iso()
    deleted_count = 0

    with get_connection(settings) as conn:
        if replace_missing:
            if normalized_accounts:
                synced_emails = [account["email_address"] for account in normalized_accounts]
                placeholders = ", ".join("?" for _ in synced_emails)
                params: list[Any] = [user_id, *synced_emails]
                delete_cursor = conn.execute(
                    f"""
                    DELETE FROM cloud_accounts
                    WHERE user_id = ? AND email_address NOT IN ({placeholders})
                    """,
                    params,
                )
            else:
                delete_cursor = conn.execute("DELETE FROM cloud_accounts WHERE user_id = ?", (user_id,))
            deleted_count = max(int(delete_cursor.rowcount or 0), 0)

        for account in normalized_accounts:
            existing = conn.execute(
                """
                SELECT id, created_at
                FROM cloud_accounts
                WHERE user_id = ? AND email_address = ?
                """,
                (user_id, account["email_address"]),
            ).fetchone()

            if existing is None:
                conn.execute(
                    """
                    INSERT INTO cloud_accounts (
                        user_id,
                        email_address,
                        provider,
                        group_name,
                        status,
                        note,
                        oauth_status,
                        oauth_email,
                        oauth_updated_at,
                        import_sequence,
                        created_at,
                        updated_at,
                        last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        account["email_address"],
                        account["provider"],
                        account["group_name"],
                        account["status"],
                        account["note"],
                        account["oauth_status"],
                        account["oauth_email"],
                        account["oauth_updated_at"],
                        account["import_sequence"],
                        now,
                        now,
                        now,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE cloud_accounts
                    SET
                        provider = ?,
                        group_name = ?,
                        status = ?,
                        note = ?,
                        oauth_status = ?,
                        oauth_email = ?,
                        oauth_updated_at = ?,
                        import_sequence = ?,
                        updated_at = ?,
                        last_synced_at = ?
                    WHERE id = ?
                    """,
                    (
                        account["provider"],
                        account["group_name"],
                        account["status"],
                        account["note"],
                        account["oauth_status"],
                        account["oauth_email"],
                        account["oauth_updated_at"],
                        account["import_sequence"],
                        now,
                        now,
                        existing["id"],
                    ),
                )

        after_count = int(
            conn.execute(
                "SELECT COUNT(*) FROM cloud_accounts WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
        )

        conn.execute(
            "UPDATE user_profiles SET last_cloud_push_at = ?, updated_at = ? WHERE user_id = ?",
            (now, now, user_id),
        )
        conn.commit()

    return {
        "upserted": len(normalized_accounts),
        "deleted": deleted_count,
        "total": after_count,
        "last_cloud_push_at": now,
    }


def _secret_value(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return str(value).strip()
    return ""


def _normalize_secret_payload(payload: dict[str, Any]) -> dict[str, Any]:
    email_address = _validate_email(payload.get("email_address") or payload.get("邮箱地址") or "")
    provider = str(payload.get("provider", "microsoft")).strip().lower() or "microsoft"
    if provider not in SUPPORTED_PROVIDERS:
        provider = "google" if email_address.endswith(("@gmail.com", "@googlemail.com")) else "microsoft"

    return {
        "email_address": email_address,
        "provider": provider,
        "group_name": str(payload.get("group_name") or payload.get("分组") or "默认分组").strip()
        or "默认分组",
        "status": str(payload.get("status") or payload.get("状态") or "正常").strip() or "正常",
        "note": str(payload.get("note") or payload.get("备注") or "").strip(),
        "oauth_status": str(payload.get("oauth_status") or "not_connected").strip() or "not_connected",
        "oauth_email": str(payload.get("oauth_email") or "").strip(),
        "oauth_updated_at": str(payload.get("oauth_updated_at") or "").strip(),
        "import_sequence": int(payload.get("import_sequence") or payload.get("导入序号") or 0),
        "secret": {
            "password": _secret_value(payload, "password", "密码"),
            "recovery_email": _secret_value(payload, "recovery_email", "辅助邮箱"),
            "twofa_secret": _secret_value(payload, "twofa_secret", "2fa_secret", "two_factor_secret", "两步验证"),
            "client_id": _secret_value(payload, "client_id"),
            "refresh_token": _secret_value(payload, "refresh_token", "刷新令牌"),
            "token_expires_at": _secret_value(payload, "token_expires_at", "令牌过期时间"),
        },
    }


def _has_secret_values(secret: dict[str, str]) -> bool:
    return any(bool(secret.get(key, "").strip()) for key in SECRET_PAYLOAD_FIELDS)


def _ensure_cloud_account_for_secret(
    conn: sqlite3.Connection,
    user_id: int,
    account: dict[str, Any],
    now: str,
) -> int:
    row = conn.execute(
        """
        SELECT id
        FROM cloud_accounts
        WHERE user_id = ? AND lower(email_address) = ?
        """,
        (user_id, account["email_address"]),
    ).fetchone()
    if row is not None:
        return int(row["id"])

    import_sequence = int(account["import_sequence"] or 0)
    if import_sequence <= 0:
        import_sequence = int(
            conn.execute(
                "SELECT COALESCE(MAX(import_sequence), 0) + 1 FROM cloud_accounts WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
        )

    cursor = conn.execute(
        """
        INSERT INTO cloud_accounts (
            user_id,
            email_address,
            provider,
            group_name,
            status,
            note,
            oauth_status,
            oauth_email,
            oauth_updated_at,
            import_sequence,
            created_at,
            updated_at,
            last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            account["email_address"],
            account["provider"],
            account["group_name"],
            account["status"],
            account["note"],
            account["oauth_status"],
            account["oauth_email"],
            account["oauth_updated_at"],
            import_sequence,
            now,
            now,
            now,
        ),
    )
    return int(cursor.lastrowid)


def sync_cloud_account_secrets(
    settings: Settings,
    user_id: int,
    accounts: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized_accounts = [_normalize_secret_payload(account) for account in accounts]
    normalized_accounts = [
        account for account in normalized_accounts if _has_secret_values(account["secret"])
    ]
    cipher = _get_secret_cipher(settings)
    now = utcnow_iso()

    with get_connection(settings) as conn:
        upserted = 0
        for account in normalized_accounts:
            cloud_account_id = _ensure_cloud_account_for_secret(conn, user_id, account, now)
            secret_payload = {
                key: account["secret"].get(key, "")
                for key in SECRET_PAYLOAD_FIELDS
            }
            encrypted_payload = cipher.encrypt(
                json.dumps(secret_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            ).decode("ascii")
            existing = conn.execute(
                """
                SELECT id
                FROM cloud_account_secrets
                WHERE user_id = ? AND email_address_normalized = ?
                """,
                (user_id, account["email_address"]),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO cloud_account_secrets (
                        user_id,
                        cloud_account_id,
                        email_address,
                        email_address_normalized,
                        encrypted_payload,
                        encryption_scheme,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'fernet-v1', ?, ?)
                    """,
                    (
                        user_id,
                        cloud_account_id,
                        account["email_address"],
                        account["email_address"],
                        encrypted_payload,
                        now,
                        now,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE cloud_account_secrets
                    SET
                        cloud_account_id = ?,
                        email_address = ?,
                        encrypted_payload = ?,
                        encryption_scheme = 'fernet-v1',
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        cloud_account_id,
                        account["email_address"],
                        encrypted_payload,
                        now,
                        existing["id"],
                    ),
                )
            upserted += 1

        total = int(
            conn.execute(
                "SELECT COUNT(*) FROM cloud_account_secrets WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
        )
        conn.commit()

    return {"upserted": upserted, "total": total, "updated_at": now}


def list_cloud_account_secrets(
    settings: Settings,
    user_id: int,
    emails: list[str] | None = None,
) -> list[dict[str, Any]]:
    cipher = _get_secret_cipher(settings)
    normalized_emails = [_validate_email(email) for email in emails or []]

    with get_connection(settings) as conn:
        params: list[Any] = [user_id]
        where = "WHERE s.user_id = ?"
        if normalized_emails:
            placeholders = ",".join("?" for _ in normalized_emails)
            where += f" AND s.email_address_normalized IN ({placeholders})"
            params.extend(normalized_emails)

        rows = conn.execute(
            f"""
            SELECT
                s.email_address,
                s.encrypted_payload,
                s.encryption_scheme,
                s.updated_at,
                c.provider,
                c.group_name,
                c.status,
                c.import_sequence
            FROM cloud_account_secrets s
            LEFT JOIN cloud_accounts c ON c.id = s.cloud_account_id
            {where}
            ORDER BY COALESCE(c.import_sequence, 0) ASC, s.email_address ASC
            """,
            params,
        ).fetchall()

    secrets_payload: list[dict[str, Any]] = []
    for row in rows:
        if row["encryption_scheme"] != "fernet-v1":
            raise AppError("不支持的凭据加密版本", "invalid", 500)
        try:
            decrypted = cipher.decrypt(str(row["encrypted_payload"]).encode("ascii"))
        except InvalidToken as exc:
            raise AppError("凭据解密失败，请检查服务器加密 key", "invalid", 500) from exc

        payload = json.loads(decrypted.decode("utf-8"))
        secret = {
            key: str(payload.get(key, "") or "")
            for key in SECRET_PAYLOAD_FIELDS
        }
        secrets_payload.append(
            {
                "email_address": row["email_address"],
                "provider": row["provider"] or (
                    "google"
                    if str(row["email_address"]).endswith(("@gmail.com", "@googlemail.com"))
                    else "microsoft"
                ),
                "group_name": row["group_name"] or "默认分组",
                "status": row["status"] or "正常",
                "import_sequence": row["import_sequence"] or 0,
                "updated_at": row["updated_at"],
                **secret,
            }
        )

    return secrets_payload
