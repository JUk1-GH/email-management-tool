from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from urllib.error import HTTPError, URLError

from .config import Settings
from .errors import AppError, classify_microsoft_error, extract_error_text
from .models import EmailRecord


@dataclass(frozen=True)
class TokenBundle:
    access_token: str
    refresh_token: str | None
    expires_in: int
    token_endpoint: str
    raw: dict[str, object]

    @property
    def is_probably_graph_token(self) -> bool:
        return self.access_token.count(".") == 2


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


def exchange_refresh_token(settings: Settings, client_id: str, refresh_token: str) -> TokenBundle:
    errors: list[str] = []
    payload = {
        "client_id": client_id,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    for token_url in (settings.live_token_url, settings.microsoft_token_url):
        try:
            token_data = _post_form_json(token_url, payload, settings.http_timeout)
            access_token = str(token_data.get("access_token", "")).strip()
            if not access_token:
                errors.append(f"{token_url}: {extract_error_text(token_data)}")
                continue
            return TokenBundle(
                access_token=access_token,
                refresh_token=str(token_data.get("refresh_token") or "") or None,
                expires_in=int(token_data.get("expires_in", 3600) or 3600),
                token_endpoint=token_url,
                raw=token_data,
            )
        except HTTPError as exc:
            response_body = exc.read()
            error_type, message = classify_microsoft_error(response_body)
            errors.append(f"{token_url}: {extract_error_text(response_body)}")
            if exc.code in (400, 401):
                continue
            raise AppError(message, error_type, 502, {"provider_response": extract_error_text(response_body)}) from exc
        except URLError as exc:
            errors.append(f"{token_url}: {exc.reason}")

    raise AppError(
        "无法用 refresh token 换取 access token",
        "invalid",
        401,
        {"attempts": errors, "client_id": client_id},
    )


def probe_graph_access(settings: Settings, access_token: str, folder: str = "inbox") -> bool:
    if access_token.count(".") != 2:
        return False

    try:
        folder_name = "junkemail" if folder == "junkemail" else "inbox"
        query = urllib.parse.urlencode({"$top": "1", "$select": "id"})
        url = f"{settings.graph_base_url}/me/mailFolders/{folder_name}/messages?{query}"
        request = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=settings.http_timeout) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return isinstance(payload.get("value"), list)
    except Exception:
        return False


def fetch_graph_messages(
    settings: Settings,
    access_token: str,
    folder: str,
    limit: int,
) -> list[dict[str, object]]:
    folder_name = "junkemail" if folder == "junkemail" else "inbox"
    query = urllib.parse.urlencode(
        {
            "$top": str(limit),
            "$select": "id,subject,from,receivedDateTime,bodyPreview,body,isRead",
        }
    )
    url = f"{settings.graph_base_url}/me/mailFolders/{folder_name}/messages?{query}"
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.http_timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        response_body = exc.read()
        error_type, message = classify_microsoft_error(response_body)
        raise AppError(message, error_type, 502, {"provider_response": extract_error_text(response_body)}) from exc
    except URLError as exc:
        raise AppError(f"Graph API 请求失败: {exc.reason}", "invalid", 502) from exc

    records: list[dict[str, object]] = []
    for item in payload.get("value", []):
        from_addr = (item.get("from") or {}).get("emailAddress") or {}
        record = EmailRecord(
            id=str(item.get("id") or ""),
            subject=str(item.get("subject") or "(无主题)"),
            from_address=str(from_addr.get("address") or ""),
            from_name=str(from_addr.get("name") or ""),
            received_time=str(item.get("receivedDateTime") or ""),
            body_preview=str(item.get("bodyPreview") or ""),
            body=str(((item.get("body") or {}).get("content")) or ""),
            is_read=bool(item.get("isRead")),
        )
        records.append(record.to_dict())
    return records
