from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .errors import AppError


@dataclass(frozen=True)
class DetectPermissionRequest:
    client_id: str
    refresh_token: str

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "DetectPermissionRequest":
        payload = payload or {}
        client_id = str(payload.get("client_id", "")).strip()
        refresh_token = str(payload.get("refresh_token", "")).strip()
        if not client_id or not refresh_token:
            raise AppError("缺少 client_id 或 refresh_token", "invalid", 400)
        return cls(client_id=client_id, refresh_token=refresh_token)


@dataclass(frozen=True)
class RefreshEmailsRequest:
    email_address: str
    client_id: str
    refresh_token: str
    folder: str = "inbox"
    token_type: str = "imap"
    provider: str = "microsoft"

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "RefreshEmailsRequest":
        payload = payload or {}
        email_address = str(payload.get("email_address", "")).strip()
        client_id = str(payload.get("client_id", "")).strip()
        refresh_token = str(payload.get("refresh_token", "")).strip()
        folder = str(payload.get("folder", "inbox")).strip() or "inbox"
        token_type = str(payload.get("token_type", "imap")).strip() or "imap"
        provider = str(payload.get("provider", "microsoft")).strip().lower() or "microsoft"
        if not email_address or "@" not in email_address:
            raise AppError("缺少有效的 email_address", "invalid", 400)
        if provider not in {"microsoft", "google"}:
            raise AppError(f"不支持的 provider: {provider}", "invalid", 400)
        if provider == "microsoft" and (not client_id or not refresh_token):
            raise AppError("缺少 client_id 或 refresh_token", "invalid", 400)
        if provider == "google" and not refresh_token:
            raise AppError("Gmail 账号缺少 refresh_token，请先完成 Gmail 授权", "invalid", 400)
        return cls(
            email_address=email_address,
            client_id=client_id,
            refresh_token=refresh_token,
            folder=folder,
            token_type=token_type,
            provider=provider,
        )


@dataclass(frozen=True)
class EmailDetailRequest:
    email_address: str
    client_id: str
    refresh_token: str
    message_id: str
    provider: str = "microsoft"

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "EmailDetailRequest":
        payload = payload or {}
        email_address = str(payload.get("email_address", "")).strip()
        client_id = str(payload.get("client_id", "")).strip()
        refresh_token = str(payload.get("refresh_token", "")).strip()
        message_id = str(payload.get("message_id", "")).strip()
        provider = str(payload.get("provider", "microsoft")).strip().lower() or "microsoft"

        if not email_address or "@" not in email_address:
            raise AppError("缺少有效的 email_address", "invalid", 400)
        if not message_id:
            raise AppError("缺少有效的 message_id", "invalid", 400)
        if provider not in {"microsoft", "google"}:
            raise AppError(f"不支持的 provider: {provider}", "invalid", 400)
        if provider == "microsoft" and (not client_id or not refresh_token):
            raise AppError("缺少 client_id 或 refresh_token", "invalid", 400)
        if provider == "google" and not refresh_token:
            raise AppError("Gmail 账号缺少 refresh_token，请先完成 Gmail 授权", "invalid", 400)

        return cls(
            email_address=email_address,
            client_id=client_id,
            refresh_token=refresh_token,
            message_id=message_id,
            provider=provider,
        )


@dataclass(frozen=True)
class RegisterRequest:
    email: str
    password: str
    display_name: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "RegisterRequest":
        payload = payload or {}
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        display_name = str(payload.get("display_name", "")).strip()
        if not email:
            raise AppError("缺少注册邮箱", "invalid", 400)
        if not password:
            raise AppError("缺少注册密码", "invalid", 400)
        return cls(email=email, password=password, display_name=display_name)


@dataclass(frozen=True)
class LoginRequest:
    email: str
    password: str

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "LoginRequest":
        payload = payload or {}
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        if not email or not password:
            raise AppError("缺少邮箱或密码", "invalid", 400)
        return cls(email=email, password=password)


@dataclass(frozen=True)
class CloudAccountsSyncRequest:
    accounts: list[dict[str, Any]]
    replace_missing: bool = False

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "CloudAccountsSyncRequest":
        payload = payload or {}
        raw_accounts = payload.get("accounts", [])
        if not isinstance(raw_accounts, list):
            raise AppError("accounts 必须是数组", "invalid", 400)
        accounts = [item for item in raw_accounts if isinstance(item, dict)]
        if len(accounts) != len(raw_accounts):
            raise AppError("accounts 内只能包含对象", "invalid", 400)
        replace_missing = bool(payload.get("replace_missing", False))
        return cls(accounts=accounts, replace_missing=replace_missing)


@dataclass(frozen=True)
class CloudSecretsSyncRequest:
    accounts: list[dict[str, Any]]

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "CloudSecretsSyncRequest":
        payload = payload or {}
        raw_accounts = payload.get("accounts", [])
        if not isinstance(raw_accounts, list):
            raise AppError("accounts 必须是数组", "invalid", 400)
        accounts = [item for item in raw_accounts if isinstance(item, dict)]
        if len(accounts) != len(raw_accounts):
            raise AppError("accounts 内只能包含对象", "invalid", 400)
        return cls(accounts=accounts)


@dataclass(frozen=True)
class CloudSecretsUnlockRequest:
    emails: list[str]

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "CloudSecretsUnlockRequest":
        payload = payload or {}
        raw_emails = payload.get("emails", [])
        if raw_emails is None:
            raw_emails = []
        if not isinstance(raw_emails, list):
            raise AppError("emails 必须是数组", "invalid", 400)
        emails = [str(email).strip() for email in raw_emails if str(email).strip()]
        return cls(emails=emails)


@dataclass(frozen=True)
class TwoFactorCodeRequest:
    email_address: str
    twofa_secret: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "TwoFactorCodeRequest":
        payload = payload or {}
        email_address = str(payload.get("email_address", "")).strip().lower()
        twofa_secret = str(
            payload.get("twofa_secret")
            or payload.get("2fa_secret")
            or payload.get("two_factor_secret")
            or payload.get("两步验证")
            or ""
        ).strip()
        if not email_address or "@" not in email_address:
            raise AppError("缺少有效的 email_address", "invalid", 400)
        return cls(email_address=email_address, twofa_secret=twofa_secret)


@dataclass(frozen=True)
class EmailRecord:
    id: str
    subject: str
    from_address: str
    from_name: str
    received_time: str
    body_preview: str
    body: str
    is_read: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
