from __future__ import annotations

import json
import re
from dataclasses import dataclass


@dataclass
class AppError(Exception):
    message: str
    error_type: str = "invalid"
    status_code: int = 400
    details: dict[str, object] | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "success": False,
            "message": self.message,
            "error_type": self.error_type,
        }
        if self.details:
            payload["details"] = self.details
        return payload


def extract_error_text(payload: object) -> str:
    if payload is None:
        return ""
    if isinstance(payload, bytes):
        return payload.decode("utf-8", errors="ignore")
    if isinstance(payload, str):
        return payload
    try:
        return json.dumps(payload, ensure_ascii=False)
    except TypeError:
        return str(payload)


def classify_microsoft_error(payload: object) -> tuple[str, str]:
    text = extract_error_text(payload).lower()

    if not text:
        return "invalid", "微软认证失败"
    if "locked" in text or "temporarily blocked" in text or "account has been locked" in text:
        return "locked", "账号已被 Microsoft 锁定"
    if "banned" in text or "suspended" in text or "disabled" in text or "blocked" in text:
        return "banned", "账号已被 Microsoft 封禁或禁用"
    if "700082" in text or "expired" in text or "expiration" in text:
        return "expired", "刷新令牌已过期"
    if "invalid_grant" in text or "invalid token" in text or "bad token" in text or "unauthorized" in text:
        return "invalid", "刷新令牌无效"
    return "invalid", "微软认证失败"


def classify_mail_error(payload: object) -> tuple[str, str]:
    text = extract_error_text(payload).lower()

    if re.search(r"locked|temporarily blocked|account has been locked", text):
        return "locked", "账号已被 Microsoft 锁定"
    if re.search(r"banned|suspended|disabled|blocked", text):
        return "banned", "账号已被 Microsoft 封禁或禁用"
    if re.search(r"expired|700082", text):
        return "expired", "刷新令牌已过期"
    if re.search(r"authentication failed|authfailed|logondenied|invalid|not authenticated", text):
        return "invalid", "账号认证失败"
    return "invalid", "邮件获取失败"


def classify_google_error(
    payload: object,
    default_message: str = "Google 认证失败",
) -> tuple[str, str]:
    text = extract_error_text(payload)
    lowered = text.lower()

    if "access_denied" in lowered:
        return "invalid", "Google 授权被拒绝"
    if "invalid_client" in lowered or "unauthorized_client" in lowered:
        return "invalid", "Google OAuth 客户端配置无效"
    if "invalid_scope" in lowered:
        return "invalid", "Google OAuth scope 配置无效"
    if "redirect_uri_mismatch" in lowered:
        return "invalid", "Google OAuth redirect URI 不匹配"
    if "invalid_grant" in lowered:
        if "expired" in lowered:
            return "expired", "Google refresh token 已过期"
        if "revoked" in lowered:
            return "invalid", "Google refresh token 已被撤销，请重新绑定 Gmail"
        return "invalid", "Google refresh token 无效"
    if "insufficient authentication scopes" in lowered or "insufficientpermissions" in lowered:
        return "invalid", "Gmail API 权限不足，请重新授权 Gmail"
    if "gmail api has not been used" in lowered or "api has not been used" in lowered:
        return "invalid", "Google Cloud 项目尚未启用 Gmail API"
    if "quota" in lowered or "rate limit" in lowered or '"code": 429' in lowered:
        return "invalid", "Gmail API 调用频率过高，请稍后再试"
    if "backend error" in lowered or '"code": 500' in lowered or '"code": 503' in lowered:
        return "invalid", "Gmail API 暂时不可用，请稍后再试"
    return "invalid", default_message
