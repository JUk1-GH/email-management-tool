from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from email.utils import parseaddr
from urllib.error import HTTPError, URLError

from .config import Settings
from .errors import AppError, classify_google_error, extract_error_text
from .mail import decode_header_value, html_preview
from .models import EmailRecord

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_STATE_TTL_SECONDS = 15 * 60


@dataclass(frozen=True)
class GoogleOAuthState:
    account_email: str
    return_origin: str
    issued_at: int


def _origin_of(url: str) -> str | None:
    candidate = str(url or "").strip()
    if not candidate:
        return None
    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def allowed_return_origins(settings: Settings) -> set[str]:
    origins: set[str] = set()
    cors_origin = str(settings.cors_origin or "").strip()
    if cors_origin:
        for item in cors_origin.split(","):
            normalized = _origin_of(item.strip())
            if normalized:
                origins.add(normalized)
    redirect_origin = _origin_of(settings.google_redirect_uri)
    if redirect_origin:
        origins.add(redirect_origin)
    return origins


@dataclass(frozen=True)
class GoogleTokenBundle:
    access_token: str
    refresh_token: str | None
    expires_in: int
    token_endpoint: str
    raw: dict[str, object]


def ensure_google_oauth_config(settings: Settings) -> None:
    missing: list[str] = []
    if not settings.google_client_id:
        missing.append("JEMAIL_GOOGLE_CLIENT_ID")
    if not settings.google_client_secret:
        missing.append("JEMAIL_GOOGLE_CLIENT_SECRET")
    if not settings.google_redirect_uri:
        missing.append("JEMAIL_GOOGLE_REDIRECT_URI")
    if missing:
        raise AppError(
            "Google OAuth 配置不完整，请先设置后端环境变量",
            "invalid",
            500,
            {"missing": missing},
        )


def _google_state_secret(settings: Settings) -> bytes:
    secret = settings.google_state_secret or settings.google_client_secret
    if not secret:
        raise AppError(
            "Google OAuth state secret 未配置，请设置 JEMAIL_GOOGLE_STATE_SECRET 或 JEMAIL_GOOGLE_CLIENT_SECRET",
            "invalid",
            500,
        )
    return secret.encode("utf-8")


def validate_return_origin(settings: Settings, return_origin: str) -> str:
    candidate = str(return_origin or "").strip()
    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
        raise AppError("缺少有效的 return_origin", "invalid", 400)
    normalized = f"{parsed.scheme}://{parsed.netloc}"
    allowed = allowed_return_origins(settings)
    if normalized not in allowed:
        raise AppError(
            "return_origin 不在允许列表中，请检查前端域名与后端配置",
            "invalid",
            400,
            {"allowed_origins": sorted(allowed)},
        )
    return normalized


def _urlsafe_b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _urlsafe_b64decode(raw: str) -> bytes:
    padded = raw + ("=" * ((4 - len(raw) % 4) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def build_google_oauth_state(
    settings: Settings,
    account_email: str,
    return_origin: str,
) -> str:
    normalized_email = str(account_email or "").strip()
    if not normalized_email or "@" not in normalized_email:
        raise AppError("缺少有效的 account_email", "invalid", 400)
    issued_at = int(time.time())
    payload = {
        "account_email": normalized_email,
        "return_origin": validate_return_origin(settings, return_origin),
        "iat": issued_at,
    }
    payload_b64 = _urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = hmac.new(
        _google_state_secret(settings),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def parse_google_oauth_state(settings: Settings, state: str) -> GoogleOAuthState:
    raw_state = str(state or "").strip()
    if "." not in raw_state:
        raise AppError("Google OAuth state 无效", "invalid", 400)

    payload_b64, signature = raw_state.rsplit(".", 1)
    expected_signature = hmac.new(
        _google_state_secret(settings),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise AppError("Google OAuth state 校验失败", "invalid", 400)

    try:
        payload = json.loads(_urlsafe_b64decode(payload_b64).decode("utf-8"))
    except Exception as exc:
        raise AppError("Google OAuth state 解析失败", "invalid", 400) from exc

    account_email = str(payload.get("account_email", "")).strip()
    return_origin = validate_return_origin(
        settings, str(payload.get("return_origin", "")).strip()
    )
    issued_at = int(payload.get("iat", 0) or 0)
    if not account_email or "@" not in account_email:
        raise AppError("Google OAuth state 缺少目标邮箱", "invalid", 400)
    if not issued_at or int(time.time()) - issued_at > GOOGLE_STATE_TTL_SECONDS:
        raise AppError("Google OAuth state 已过期，请重新发起授权", "invalid", 400)

    return GoogleOAuthState(
        account_email=account_email,
        return_origin=return_origin,
        issued_at=issued_at,
    )


def build_google_authorization_url(
    settings: Settings,
    account_email: str,
    return_origin: str,
) -> str:
    ensure_google_oauth_config(settings)
    state = build_google_oauth_state(settings, account_email, return_origin)
    query = urllib.parse.urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": GMAIL_READONLY_SCOPE,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "login_hint": account_email.strip(),
            "state": state,
        }
    )
    return f"{settings.google_auth_url}?{query}"


def _post_form_json(url: str, form_data: dict[str, str], timeout: int) -> dict[str, object]:
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def exchange_google_authorization_code(settings: Settings, code: str) -> GoogleTokenBundle:
    ensure_google_oauth_config(settings)
    payload = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "code": code,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    try:
        token_data = _post_form_json(settings.google_token_url, payload, settings.http_timeout)
    except HTTPError as exc:
        response_body = exc.read()
        error_type, message = classify_google_error(response_body, "Google OAuth code 交换失败")
        raise AppError(message, error_type, 502, {"provider_response": extract_error_text(response_body)}) from exc
    except URLError as exc:
        raise AppError(f"Google OAuth 请求失败: {exc.reason}", "invalid", 502) from exc

    access_token = str(token_data.get("access_token", "")).strip()
    if not access_token:
        error_type, message = classify_google_error(token_data, "Google OAuth 未返回 access token")
        raise AppError(message, error_type, 502, {"provider_response": extract_error_text(token_data)})

    return GoogleTokenBundle(
        access_token=access_token,
        refresh_token=str(token_data.get("refresh_token") or "") or None,
        expires_in=int(token_data.get("expires_in", 3600) or 3600),
        token_endpoint=settings.google_token_url,
        raw=token_data,
    )


def exchange_google_refresh_token(settings: Settings, refresh_token: str) -> GoogleTokenBundle:
    ensure_google_oauth_config(settings)
    payload = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    try:
        token_data = _post_form_json(settings.google_token_url, payload, settings.http_timeout)
    except HTTPError as exc:
        response_body = exc.read()
        error_type, message = classify_google_error(response_body, "Google refresh token 交换失败")
        raise AppError(message, error_type, 401, {"provider_response": extract_error_text(response_body)}) from exc
    except URLError as exc:
        raise AppError(f"Google OAuth 请求失败: {exc.reason}", "invalid", 502) from exc

    access_token = str(token_data.get("access_token", "")).strip()
    if not access_token:
        error_type, message = classify_google_error(token_data, "Google OAuth 未返回 access token")
        raise AppError(message, error_type, 401, {"provider_response": extract_error_text(token_data)})

    return GoogleTokenBundle(
        access_token=access_token,
        refresh_token=str(token_data.get("refresh_token") or "") or None,
        expires_in=int(token_data.get("expires_in", 3600) or 3600),
        token_endpoint=settings.google_token_url,
        raw=token_data,
    )


def _gmail_get_json(settings: Settings, access_token: str, url: str) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.http_timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        response_body = exc.read()
        default_message = "Gmail API 请求失败"
        if exc.code == 403:
            default_message = "Gmail API 拒绝了请求"
        elif exc.code == 429:
            default_message = "Gmail API 调用频率过高"
        elif exc.code >= 500:
            default_message = "Gmail API 暂时不可用"
        error_type, message = classify_google_error(response_body, default_message)
        raise AppError(message, error_type, 502, {"provider_response": extract_error_text(response_body)}) from exc
    except URLError as exc:
        raise AppError(f"Gmail API 请求失败: {exc.reason}", "invalid", 502) from exc


def fetch_gmail_profile(settings: Settings, access_token: str) -> dict[str, object]:
    url = f"{settings.gmail_api_base_url}/users/me/profile"
    return _gmail_get_json(settings, access_token, url)


def _decode_gmail_part_data(data: str) -> str:
    if not data:
        return ""
    padded = data + ("=" * ((4 - len(data) % 4) % 4))
    try:
        return base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _iter_gmail_parts(payload: dict[str, object]) -> list[dict[str, object]]:
    parts: list[dict[str, object]] = [payload]
    for part in payload.get("parts") or []:
        if isinstance(part, dict):
            parts.extend(_iter_gmail_parts(part))
    return parts


def _extract_gmail_bodies(payload: dict[str, object]) -> tuple[str, str]:
    html_body = ""
    text_body = ""

    for part in _iter_gmail_parts(payload):
        body = part.get("body") or {}
        if not isinstance(body, dict):
            continue

        data = _decode_gmail_part_data(str(body.get("data") or ""))
        if not data:
            continue

        mime_type = str(part.get("mimeType") or "")
        filename = str(part.get("filename") or "")
        if filename and mime_type not in {"text/plain", "text/html"}:
            continue

        if mime_type == "text/html" and not html_body:
            html_body = data
        elif mime_type == "text/plain" and not text_body:
            text_body = data

    if not html_body and text_body:
        html_body = "<pre>" + html.escape(text_body) + "</pre>"
    return html_body, text_body


def _gmail_headers_map(headers: object) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for item in headers or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        value = str(item.get("value") or "").strip()
        if name and value and name not in mapped:
            mapped[name] = value
    return mapped


def format_gmail_internal_date(raw_value: object) -> str:
    try:
        timestamp_ms = int(str(raw_value or "0").strip() or "0")
    except ValueError:
        return ""
    if timestamp_ms <= 0:
        return ""
    return datetime.fromtimestamp(timestamp_ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


def _gmail_message_to_record(item: dict[str, object]) -> dict[str, object]:
    payload = item.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    headers = _gmail_headers_map(payload.get("headers"))
    from_header = decode_header_value(headers.get("from"))
    from_name, from_address = parseaddr(from_header)
    html_body, text_body = _extract_gmail_bodies(payload)
    preview = str(item.get("snippet") or "").strip() or html_preview(text_body or html_body)
    subject = decode_header_value(headers.get("subject")) or "(无主题)"
    record = EmailRecord(
        id=str(item.get("id") or ""),
        subject=subject,
        from_address=from_address,
        from_name=decode_header_value(from_name),
        received_time=format_gmail_internal_date(item.get("internalDate")),
        body_preview=preview,
        body=html_body or ("<pre>" + html.escape(text_body or preview) + "</pre>" if (text_body or preview) else ""),
        is_read="UNREAD" not in {str(label) for label in item.get("labelIds") or []},
    ).to_dict()
    if html_body:
        record["body_html"] = html_body
    return record


def _gmail_message_to_summary(item: dict[str, object]) -> dict[str, object]:
    payload = item.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    headers = _gmail_headers_map(payload.get("headers"))
    from_header = decode_header_value(headers.get("from"))
    from_name, from_address = parseaddr(from_header)
    preview = str(item.get("snippet") or "").strip()
    subject = decode_header_value(headers.get("subject")) or "(无主题)"
    return EmailRecord(
        id=str(item.get("id") or ""),
        subject=subject,
        from_address=from_address,
        from_name=decode_header_value(from_name),
        received_time=format_gmail_internal_date(item.get("internalDate")),
        body_preview=preview,
        body="",
        is_read="UNREAD" not in {str(label) for label in item.get("labelIds") or []},
    ).to_dict()


def fetch_gmail_messages(
    settings: Settings,
    access_token: str,
    folder: str,
    limit: int,
) -> list[dict[str, object]]:
    label_id = "SPAM" if folder == "junkemail" else "INBOX"
    query_items: list[tuple[str, str]] = [
        ("labelIds", label_id),
        ("maxResults", str(limit)),
    ]
    if label_id == "SPAM":
        query_items.append(("includeSpamTrash", "true"))
    list_url = f"{settings.gmail_api_base_url}/users/me/messages?{urllib.parse.urlencode(query_items, doseq=True)}"
    list_payload = _gmail_get_json(settings, access_token, list_url)
    records: list[dict[str, object]] = []

    for item in list_payload.get("messages", []):
        if not isinstance(item, dict):
            continue
        message_id = str(item.get("id") or "").strip()
        if not message_id:
            continue
        detail_url = (
            f"{settings.gmail_api_base_url}/users/me/messages/"
            f"{urllib.parse.quote(message_id)}"
            "?format=metadata&metadataHeaders=Subject&metadataHeaders=From"
            "&fields=id,internalDate,labelIds,snippet,payload/headers"
        )
        detail_payload = _gmail_get_json(settings, access_token, detail_url)
        records.append(_gmail_message_to_summary(detail_payload))
    return records


def fetch_gmail_message_detail(
    settings: Settings,
    access_token: str,
    message_id: str,
) -> dict[str, object]:
    normalized_id = str(message_id or "").strip()
    if not normalized_id:
        raise AppError("缺少有效的 message_id", "invalid", 400)

    detail_url = (
        f"{settings.gmail_api_base_url}/users/me/messages/"
        f"{urllib.parse.quote(normalized_id)}?format=full"
    )
    detail_payload = _gmail_get_json(settings, access_token, detail_url)
    return _gmail_message_to_record(detail_payload)


def render_google_oauth_result_page(
    success: bool,
    message: str,
    *,
    return_origin: str | None = None,
    payload: dict[str, object] | None = None,
    status_code: int = 200,
) -> tuple[str, int, dict[str, str]]:
    data = {
        "type": "google_oauth_result",
        "success": success,
        "message": message,
    }
    if payload:
        data.update(payload)

    serialized_payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    serialized_origin = json.dumps(return_origin, ensure_ascii=False) if return_origin else "null"
    title = "Gmail 授权完成" if success else "Gmail 授权失败"
    description = html.escape(message)

    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }}
    .wrap {{
      max-width: 520px;
      margin: 56px auto;
      padding: 0 24px;
    }}
    .card {{
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: 0 10px 40px rgba(15, 23, 42, 0.06);
    }}
    h1 {{
      font-size: 22px;
      margin: 0 0 12px;
    }}
    p {{
      margin: 0;
      line-height: 1.7;
      color: #475569;
    }}
    .hint {{
      margin-top: 16px;
      font-size: 13px;
      color: #64748b;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>{html.escape(title)}</h1>
      <p>{description}</p>
      <p class="hint">如果弹窗没有自动关闭，请返回原页面查看提示后手动关闭此窗口。</p>
    </div>
  </div>
  <script>
    (function () {{
      const payload = {serialized_payload};
      const targetOrigin = {serialized_origin};
      if (window.opener && targetOrigin) {{
        try {{
          window.opener.postMessage(payload, targetOrigin);
        }} catch (error) {{
          console.error(error);
        }}
      }}
      window.setTimeout(function () {{
        try {{
          window.close();
        }} catch (error) {{
          console.error(error);
        }}
      }}, 500);
    }})();
  </script>
</body>
</html>"""
    return page, status_code, {"Content-Type": "text/html; charset=utf-8"}
