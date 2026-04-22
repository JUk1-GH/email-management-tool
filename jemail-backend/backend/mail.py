from __future__ import annotations

import email
import html
import imaplib
import re
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime

from .config import Settings
from .errors import AppError, classify_mail_error
from .models import EmailRecord


def xoauth2_string(user: str, access_token: str) -> bytes:
    return f"user={user}\x01auth=Bearer {access_token}\x01\x01".encode("utf-8")


def decode_header_value(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode(errors="ignore")
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def format_received_time(raw_date: str) -> str:
    if not raw_date:
        return ""
    try:
        return parsedate_to_datetime(raw_date).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return raw_date


def html_preview(text: str, limit: int = 160) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text or "")
    cleaned = re.sub(r"\s+", " ", html.unescape(cleaned)).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def extract_message_body(message: Message) -> tuple[str, str]:
    html_body = ""
    text_body = ""

    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in disposition.lower():
                continue
            payload = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="ignore")
            except Exception:
                decoded = payload.decode(errors="ignore")
            if content_type == "text/html" and not html_body:
                html_body = decoded
            elif content_type == "text/plain" and not text_body:
                text_body = decoded
    else:
        payload = message.get_payload(decode=True) or b""
        charset = message.get_content_charset() or "utf-8"
        try:
            decoded = payload.decode(charset, errors="ignore")
        except Exception:
            decoded = payload.decode(errors="ignore")
        if message.get_content_type() == "text/html":
            html_body = decoded
        else:
            text_body = decoded

    if not html_body and text_body:
        html_body = "<pre>" + html.escape(text_body) + "</pre>"
    return html_body, text_body


def parse_mailbox_name(list_line: bytes) -> str:
    text = list_line.decode(errors="ignore")
    return text.rsplit(' "/" ', 1)[-1].strip('"')


def resolve_mailbox_name(client: imaplib.IMAP4_SSL, requested_folder: str) -> str:
    target = (requested_folder or "inbox").lower()
    if target == "inbox":
        return "INBOX"

    typ, data = client.list()
    if typ != "OK" or not data:
        return "INBOX"

    folders = [parse_mailbox_name(line) for line in data if line]
    exact_candidates = ["Junk", "Junk Email", "JunkEmail", "Spam", "Bulk Mail"]
    lower_map = {folder.lower(): folder for folder in folders}
    for candidate in exact_candidates:
        if candidate.lower() in lower_map:
            return lower_map[candidate.lower()]
    for folder in folders:
        lowered = folder.lower()
        if "junk" in lowered or "spam" in lowered:
            return folder
    return "INBOX"


def probe_imap_access(settings: Settings, email_address: str, access_token: str) -> bool:
    client = None
    try:
        client = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, timeout=settings.imap_timeout)
        client.authenticate("XOAUTH2", lambda _: xoauth2_string(email_address, access_token))
        typ, _ = client.select("INBOX", readonly=True)
        return typ == "OK"
    except Exception:
        return False
    finally:
        try:
            client.logout()
        except Exception:
            pass


def fetch_imap_messages(
    settings: Settings,
    email_address: str,
    access_token: str,
    requested_folder: str,
    limit: int,
) -> list[dict[str, object]]:
    client = None
    try:
        client = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, timeout=settings.imap_timeout)
        client.authenticate("XOAUTH2", lambda _: xoauth2_string(email_address, access_token))
        mailbox_name = resolve_mailbox_name(client, requested_folder)
        typ, _ = client.select(f'"{mailbox_name}"', readonly=True)
        if typ != "OK":
            raise AppError(f"无法打开邮箱文件夹: {mailbox_name}", "invalid", 502)

        typ, data = client.uid("search", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            return []

        uids = data[0].split()[-limit:]
        uids.reverse()

        records: list[dict[str, object]] = []
        for uid in uids:
            typ, msg_data = client.uid("fetch", uid, "(BODY.PEEK[] FLAGS)")
            if typ != "OK" or not msg_data:
                continue

            raw_message = b""
            flag_chunks: list[bytes] = []
            for item in msg_data:
                if isinstance(item, tuple):
                    raw_message += item[1]
                    if isinstance(item[0], bytes):
                        flag_chunks.append(item[0])
                elif isinstance(item, bytes):
                    flag_chunks.append(item)

            if not raw_message:
                continue

            parsed = email.message_from_bytes(raw_message)
            html_body, text_body = extract_message_body(parsed)
            preview = html_preview(text_body or html_body)
            from_header = decode_header_value(parsed.get("From"))
            from_name, from_address = parseaddr(from_header)
            subject = decode_header_value(parsed.get("Subject")) or "(无主题)"
            flags_blob = b" ".join(flag_chunks)

            record = EmailRecord(
                id=uid.decode("utf-8", errors="ignore"),
                subject=subject,
                from_address=from_address,
                from_name=decode_header_value(from_name),
                received_time=format_received_time(parsed.get("Date", "")),
                body_preview=preview,
                body=html_body,
                is_read=b"\\Seen" in flags_blob,
            )
            records.append(record.to_dict())

        return records
    except AppError:
        raise
    except Exception as exc:
        error_type, message = classify_mail_error(str(exc))
        raise AppError(message, error_type, 502) from exc
    finally:
        try:
            client.logout()
        except Exception:
            pass
