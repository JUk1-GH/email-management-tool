from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from .config import Settings
from .errors import AppError


def is_turnstile_enabled(settings: Settings) -> bool:
    return bool(settings.turnstile_site_key and settings.turnstile_secret_key)


def verify_turnstile_token(
    settings: Settings,
    token: str,
    remote_ip: str = "",
) -> None:
    if not is_turnstile_enabled(settings):
        return

    captcha_token = str(token or "").strip()
    if not captcha_token:
        raise AppError("请先完成人机验证", "captcha_required", 400)

    form_data = {
        "secret": settings.turnstile_secret_key,
        "response": captcha_token,
    }
    if remote_ip:
        form_data["remoteip"] = remote_ip

    request = urllib.request.Request(
        settings.turnstile_verify_url,
        data=urllib.parse.urlencode(form_data).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=settings.http_timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise AppError("人机验证服务暂时不可用，请稍后再试", "captcha_unavailable", 502) from exc

    if not bool(payload.get("success")):
        raise AppError(
            "人机验证失败，请重试",
            "captcha_failed",
            400,
            {"error_codes": payload.get("error-codes", [])},
        )
