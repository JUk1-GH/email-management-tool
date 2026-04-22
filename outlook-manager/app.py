import email
import html
import imaplib
import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for


IMAP_HOST = os.environ.get("OUTLOOK_IMAP_HOST", "outlook.office365.com")
IMAP_PORT = int(os.environ.get("OUTLOOK_IMAP_PORT", "993"))
ACCOUNTS_FILE = os.environ.get("OUTLOOK_MANAGER_ACCOUNTS_FILE", "/opt/outlook-manager/accounts.txt")
APP_PASSWORD = os.environ.get("OUTLOOK_MANAGER_PASSWORD", "")
SECRET_KEY = os.environ.get("OUTLOOK_MANAGER_SECRET", "change-me")


app = Flask(__name__)
app.secret_key = SECRET_KEY


@dataclass
class Account:
    email: str
    password: str
    client_id: str
    refresh_token: str


TOKEN_CACHE: dict[str, dict[str, object]] = {}


def load_accounts() -> dict[str, Account]:
    accounts: dict[str, Account] = {}
    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            parts = line.split("----")
            if len(parts) != 4:
                continue
            account = Account(
                email=parts[0],
                password=parts[1],
                client_id=parts[2],
                refresh_token=parts[3],
            )
            accounts[account.email] = account
    return accounts


def save_accounts(accounts: dict[str, Account]) -> None:
    lines = []
    for email_addr in sorted(accounts.keys()):
        account = accounts[email_addr]
        lines.append("----".join([account.email, account.password, account.client_id, account.refresh_token]))
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def require_login(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not APP_PASSWORD:
            return "OUTLOOK_MANAGER_PASSWORD is not configured.", 500
        if session.get("logged_in"):
            return view(*args, **kwargs)
        return redirect(url_for("login", next=request.path))

    return wrapped


def exchange_access_token(account: Account) -> str:
    cached = TOKEN_CACHE.get(account.email)
    now = time.time()
    if cached and now < cached["expires_at"]:
        return cached["access_token"]  # type: ignore[return-value]

    payload = urllib.parse.urlencode(
        {
            "client_id": account.client_id,
            "refresh_token": account.refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request("https://login.live.com/oauth20_token.srf", data=payload, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        token_data = json.loads(resp.read().decode())

    access_token = token_data["access_token"]
    expires_in = int(token_data.get("expires_in", 3600))
    new_refresh = token_data.get("refresh_token")
    if new_refresh and new_refresh != account.refresh_token:
        account.refresh_token = new_refresh
        accounts = load_accounts()
        if account.email in accounts:
            accounts[account.email].refresh_token = new_refresh
            save_accounts(accounts)
    TOKEN_CACHE[account.email] = {
        "access_token": access_token,
        "expires_at": now + max(expires_in - 120, 60),
    }
    return access_token


def xoauth2_string(user: str, access_token: str) -> bytes:
    return f"user={user}\x01auth=Bearer {access_token}\x01\x01".encode()


def with_imap(account: Account) -> imaplib.IMAP4_SSL:
    access_token = exchange_access_token(account)
    client = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=20)
    client.authenticate("XOAUTH2", lambda _: xoauth2_string(account.email, access_token))
    return client


def decode_text(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode(errors="ignore")
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def parse_list_line(line: bytes) -> dict[str, str]:
    text = line.decode(errors="ignore")
    mailbox = text.rsplit(' "/" ', 1)[-1].strip('"')
    return {"name": mailbox}


def format_date(raw_date: str) -> str:
    if not raw_date:
        return ""
    try:
        return parsedate_to_datetime(raw_date).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return raw_date


def fetch_folders(account: Account) -> list[dict[str, str]]:
    client = with_imap(account)
    try:
        typ, data = client.list()
        if typ != "OK" or not data:
            return []
        folders = [parse_list_line(line) for line in data if line]
        folders.sort(key=lambda item: (item["name"].upper() != "INBOX", item["name"].lower()))
        return folders
    finally:
        client.logout()


def fetch_messages(account: Account, folder: str, limit: int = 30) -> list[dict[str, str]]:
    client = with_imap(account)
    try:
        client.select(f'"{folder}"', readonly=True)
        typ, data = client.uid("search", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            return []
        uids = data[0].split()[-limit:]
        uids.reverse()
        messages: list[dict[str, str]] = []
        for uid in uids:
            typ, msg_data = client.uid(
                "fetch",
                uid,
                "(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] FLAGS RFC822.SIZE)",
            )
            if typ != "OK" or not msg_data:
                continue
            header_block = b""
            for item in msg_data:
                if isinstance(item, tuple):
                    header_block += item[1]
            parsed = email.message_from_bytes(header_block)
            messages.append(
                {
                    "uid": uid.decode(),
                    "from": decode_text(parsed.get("From")),
                    "to": decode_text(parsed.get("To")),
                    "subject": decode_text(parsed.get("Subject")) or "(No subject)",
                    "date": format_date(parsed.get("Date", "")),
                }
            )
        return messages
    finally:
        client.logout()


def fetch_message_detail(account: Account, folder: str, uid: str) -> dict[str, str]:
    client = with_imap(account)
    try:
        client.select(f'"{folder}"', readonly=True)
        typ, data = client.uid("fetch", uid, "(RFC822)")
        if typ != "OK" or not data:
            return {"html": "", "text": ""}
        raw = b""
        for item in data:
            if isinstance(item, tuple):
                raw += item[1]
        msg = email.message_from_bytes(raw)
        html_body = ""
        text_body = ""
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                disposition = str(part.get("Content-Disposition", ""))
                if "attachment" in disposition.lower():
                    continue
                payload = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "utf-8"
                try:
                    decoded = payload.decode(charset, errors="ignore")
                except Exception:
                    decoded = payload.decode(errors="ignore")
                if ctype == "text/html" and not html_body:
                    html_body = decoded
                elif ctype == "text/plain" and not text_body:
                    text_body = decoded
        else:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="ignore")
            except Exception:
                decoded = payload.decode(errors="ignore")
            if msg.get_content_type() == "text/html":
                html_body = decoded
            else:
                text_body = decoded

        if not html_body and text_body:
            html_body = "<pre>" + html.escape(text_body) + "</pre>"
        return {"html": html_body, "text": text_body}
    finally:
        client.logout()


@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        if request.form.get("password") == APP_PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("index"))
        error = "密码不正确"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@require_login
def index():
    accounts = load_accounts()
    account_list = sorted(accounts.keys())
    return render_template("index.html", account_emails=account_list)


@app.route("/api/accounts")
@require_login
def api_accounts():
    accounts = load_accounts()
    return jsonify(
        [
            {
                "email": email_addr,
                "folder_count": None,
            }
            for email_addr in sorted(accounts.keys())
        ]
    )


@app.route("/api/folders")
@require_login
def api_folders():
    email_addr = request.args.get("account", "")
    accounts = load_accounts()
    account = accounts[email_addr]
    return jsonify(fetch_folders(account))


@app.route("/api/messages")
@require_login
def api_messages():
    email_addr = request.args.get("account", "")
    folder = request.args.get("folder", "INBOX")
    limit = int(request.args.get("limit", "30"))
    accounts = load_accounts()
    account = accounts[email_addr]
    return jsonify(fetch_messages(account, folder, limit=limit))


@app.route("/api/message")
@require_login
def api_message():
    email_addr = request.args.get("account", "")
    folder = request.args.get("folder", "INBOX")
    uid = request.args.get("uid", "")
    accounts = load_accounts()
    account = accounts[email_addr]
    return jsonify(fetch_message_detail(account, folder, uid))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8787, debug=False)
