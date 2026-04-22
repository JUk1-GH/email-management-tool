from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    frontend_dir: Path
    db_path: Path
    sensitive_key_path: Path
    cors_origin: str
    imap_host: str
    imap_port: int
    imap_timeout: int
    http_timeout: int
    mail_fetch_limit: int
    auth_session_ttl_days: int
    live_token_url: str
    microsoft_token_url: str
    graph_base_url: str
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_auth_url: str
    google_token_url: str
    gmail_api_base_url: str
    google_state_secret: str


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_settings() -> Settings:
    load_env_file()

    frontend_default = Path(__file__).resolve().parents[2] / "jemail-app"
    frontend_dir = Path(os.environ.get("JEMAIL_FRONTEND_DIR", str(frontend_default))).expanduser().resolve()
    db_default = Path(__file__).resolve().parents[1] / "data" / "jemail.sqlite3"
    db_path = Path(os.environ.get("JEMAIL_DB_PATH", str(db_default))).expanduser().resolve()
    sensitive_key_default = db_path.parent / "jemail_sensitive_fernet.key"
    sensitive_key_path = Path(
        os.environ.get("JEMAIL_SENSITIVE_KEY_PATH", str(sensitive_key_default))
    ).expanduser().resolve()

    return Settings(
        frontend_dir=frontend_dir,
        db_path=db_path,
        sensitive_key_path=sensitive_key_path,
        cors_origin=os.environ.get("JEMAIL_CORS_ORIGIN", "").strip(),
        imap_host=os.environ.get("JEMAIL_IMAP_HOST", "outlook.office365.com"),
        imap_port=int(os.environ.get("JEMAIL_IMAP_PORT", "993")),
        imap_timeout=int(os.environ.get("JEMAIL_IMAP_TIMEOUT", "20")),
        http_timeout=int(os.environ.get("JEMAIL_HTTP_TIMEOUT", "20")),
        mail_fetch_limit=int(os.environ.get("JEMAIL_MAIL_FETCH_LIMIT", "20")),
        auth_session_ttl_days=int(os.environ.get("JEMAIL_AUTH_SESSION_TTL_DAYS", "30")),
        live_token_url=os.environ.get("JEMAIL_LIVE_TOKEN_URL", "https://login.live.com/oauth20_token.srf"),
        microsoft_token_url=os.environ.get(
            "JEMAIL_MS_TOKEN_URL",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        ),
        graph_base_url=os.environ.get("JEMAIL_GRAPH_BASE_URL", "https://graph.microsoft.com/v1.0"),
        google_client_id=os.environ.get("JEMAIL_GOOGLE_CLIENT_ID", "").strip(),
        google_client_secret=os.environ.get("JEMAIL_GOOGLE_CLIENT_SECRET", "").strip(),
        google_redirect_uri=os.environ.get("JEMAIL_GOOGLE_REDIRECT_URI", "").strip(),
        google_auth_url=os.environ.get(
            "JEMAIL_GOOGLE_AUTH_URL",
            "https://accounts.google.com/o/oauth2/v2/auth",
        ).strip(),
        google_token_url=os.environ.get(
            "JEMAIL_GOOGLE_TOKEN_URL",
            "https://oauth2.googleapis.com/token",
        ).strip(),
        gmail_api_base_url=os.environ.get(
            "JEMAIL_GMAIL_API_BASE_URL",
            "https://gmail.googleapis.com/gmail/v1",
        ).strip(),
        google_state_secret=os.environ.get("JEMAIL_GOOGLE_STATE_SECRET", "").strip(),
    )
