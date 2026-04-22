from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import parse_qs, urlparse

from .errors import AppError

SUPPORTED_TOTP_ALGORITHMS: dict[str, Callable[[], "hashlib._Hash"]] = {
    "SHA1": hashlib.sha1,
    "SHA256": hashlib.sha256,
    "SHA512": hashlib.sha512,
}

BASE32_ALLOWED_RE = re.compile(r"^[A-Z2-7]+=*$")


@dataclass(frozen=True)
class TwoFactorCodeResult:
    code: str
    digits: int
    period: int
    algorithm: str
    expires_in: int
    valid_until: str


def _parse_positive_int(raw_value: str, field_name: str, default: int) -> int:
    value = str(raw_value or "").strip()
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise AppError(f"{field_name} 必须是整数", "invalid", 400) from exc
    if parsed <= 0:
        raise AppError(f"{field_name} 必须大于 0", "invalid", 400)
    return parsed


def _parse_totp_input(raw_secret: str) -> tuple[str, int, int, str]:
    value = str(raw_secret or "").strip()
    if not value:
      raise AppError("缺少 2FA secret", "invalid", 400)

    secret = value
    digits = 6
    period = 30
    algorithm = "SHA1"

    if value.lower().startswith("otpauth://"):
        parsed = urlparse(value)
        if parsed.scheme.lower() != "otpauth" or parsed.netloc.lower() != "totp":
            raise AppError("当前只支持标准 TOTP otpauth 链接", "invalid", 400)

        query = parse_qs(parsed.query)
        secret = str(query.get("secret", [""])[0]).strip()
        digits = _parse_positive_int(
            str(query.get("digits", ["6"])[0]),
            "TOTP digits",
            6,
        )
        period = _parse_positive_int(
            str(query.get("period", ["30"])[0]),
            "TOTP period",
            30,
        )
        algorithm = str(query.get("algorithm", ["SHA1"])[0]).strip().upper() or "SHA1"

    normalized_secret = re.sub(r"[\s-]+", "", secret).upper()
    if not normalized_secret:
        raise AppError("2FA secret 不能为空", "invalid", 400)
    if not BASE32_ALLOWED_RE.match(normalized_secret):
        raise AppError("2FA secret 不是有效的 Base32 / TOTP 格式", "invalid", 400)
    if algorithm not in SUPPORTED_TOTP_ALGORITHMS:
        raise AppError(f"不支持的 TOTP 算法: {algorithm}", "invalid", 400)
    if digits > 10:
        raise AppError("TOTP digits 过大", "invalid", 400)
    if period > 300:
        raise AppError("TOTP period 过大", "invalid", 400)

    return normalized_secret, digits, period, algorithm


def generate_two_factor_code(
    raw_secret: str,
    *,
    now: datetime | None = None,
) -> TwoFactorCodeResult:
    secret, digits, period, algorithm = _parse_totp_input(raw_secret)
    now = now or datetime.now(timezone.utc)
    timestamp = int(now.timestamp())
    counter = timestamp // period

    padding = "=" * ((8 - len(secret) % 8) % 8)
    try:
        key = base64.b32decode(secret + padding, casefold=True)
    except (binascii.Error, ValueError) as exc:
        raise AppError("2FA secret 解码失败，请检查 Base32 内容", "invalid", 400) from exc

    digest = hmac.new(
        key,
        struct.pack(">Q", counter),
        SUPPORTED_TOTP_ALGORITHMS[algorithm],
    ).digest()
    offset = digest[-1] & 0x0F
    binary_code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    code = str(binary_code % (10**digits)).zfill(digits)

    expires_in = period - (timestamp % period)
    if expires_in <= 0:
        expires_in = period
    valid_until = datetime.fromtimestamp(timestamp + expires_in, timezone.utc).isoformat()

    return TwoFactorCodeResult(
        code=code,
        digits=digits,
        period=period,
        algorithm=algorithm,
        expires_in=expires_in,
        valid_until=valid_until,
    )
