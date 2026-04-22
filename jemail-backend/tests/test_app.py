from __future__ import annotations

import tempfile
import sqlite3
import unittest
import base64
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app
from backend.config import Settings
from backend.errors import AppError
from backend.google import GoogleTokenBundle, build_google_oauth_state, fetch_gmail_messages
from backend.microsoft import TokenBundle
from backend.twofa import generate_two_factor_code


class BackendAppTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        frontend_dir = Path(self.temp_dir.name)
        (frontend_dir / "index.html").write_text("<html><body>jemail</body></html>", encoding="utf-8")
        self.settings = Settings(
            frontend_dir=frontend_dir,
            db_path=frontend_dir / "test.sqlite3",
            sensitive_key_path=frontend_dir / "test-sensitive.key",
            cors_origin="http://127.0.0.1:5173",
            imap_host="outlook.office365.com",
            imap_port=993,
            imap_timeout=20,
            http_timeout=20,
            mail_fetch_limit=50,
            auth_session_ttl_days=30,
            login_max_failed_attempts=5,
            login_rate_window_minutes=15,
            login_lockout_minutes=15,
            live_token_url="https://login.live.com/oauth20_token.srf",
            microsoft_token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
            graph_base_url="https://graph.microsoft.com/v1.0",
            google_client_id="google-client-id",
            google_client_secret="google-client-secret",
            google_redirect_uri="http://127.0.0.1:8788/api/oauth/google/callback",
            google_auth_url="https://accounts.google.com/o/oauth2/v2/auth",
            google_token_url="https://oauth2.googleapis.com/token",
            gmail_api_base_url="https://gmail.googleapis.com/gmail/v1",
            google_state_secret="unit-test-secret",
            turnstile_site_key="",
            turnstile_secret_key="",
            turnstile_verify_url="https://challenges.cloudflare.com/turnstile/v0/siteverify",
        )
        self.app = create_app(self.settings)
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_detect_permission_prefers_graph(self) -> None:
        token_bundle = TokenBundle(
            access_token="a.b.c",
            refresh_token=None,
            expires_in=3600,
            token_endpoint=self.settings.live_token_url,
            raw={},
        )
        with patch("backend.app.exchange_refresh_token", return_value=token_bundle), patch(
            "backend.app.probe_graph_access", return_value=True
        ):
            response = self.client.post(
                "/detect-permission",
                json={"client_id": "client-1", "refresh_token": "refresh-1"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["token_type"], "graph")

    def test_refresh_emails_falls_back_to_imap(self) -> None:
        token_bundle = TokenBundle(
            access_token="opaque-token",
            refresh_token="rotated-token",
            expires_in=3600,
            token_endpoint=self.settings.live_token_url,
            raw={},
        )
        imap_payload = [
            {
                "id": "42",
                "subject": "Hello",
                "from_address": "sender@example.com",
                "from_name": "Sender",
                "received_time": "2026-04-17 02:00:00",
                "body_preview": "preview",
                "body": "<p>content</p>",
                "is_read": True,
            }
        ]
        with patch("backend.app.exchange_refresh_token", return_value=token_bundle), patch(
            "backend.app.fetch_graph_messages",
            side_effect=AppError("graph failed", "invalid", 502),
        ), patch("backend.app.fetch_imap_messages", return_value=imap_payload):
            response = self.client.post(
                "/api/emails/refresh",
                json={
                    "email_address": "user@outlook.com",
                    "client_id": "client-1",
                    "refresh_token": "refresh-1",
                    "folder": "inbox",
                    "token_type": "graph",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["meta"]["strategy"], "imap")
        self.assertEqual(len(payload["data"]), 1)
        self.assertEqual(payload["data"][0]["id"], "42")

    def test_invalid_refresh_payload_returns_400(self) -> None:
        response = self.client.post("/api/emails/refresh", json={"client_id": "x"})
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error_type"], "invalid")

    def test_refresh_emails_uses_google_provider_path(self) -> None:
        token_bundle = GoogleTokenBundle(
            access_token="google-access-token",
            refresh_token=None,
            expires_in=3600,
            token_endpoint=self.settings.google_token_url,
            raw={},
        )
        gmail_payload = [
            {
                "id": "gmail-1",
                "subject": "Hello Gmail",
                "from_address": "sender@gmail.com",
                "from_name": "Sender",
                "received_time": "2026-04-19 10:00:00",
                "body_preview": "preview",
                "body": "<p>gmail</p>",
                "body_html": "<p>gmail</p>",
                "is_read": False,
            }
        ]
        with patch("backend.app.exchange_google_refresh_token", return_value=token_bundle), patch(
            "backend.app.fetch_gmail_messages",
            return_value=gmail_payload,
        ) as fetch_gmail, patch("backend.app.exchange_refresh_token") as exchange_ms:
            response = self.client.post(
                "/api/emails/refresh",
                json={
                    "provider": "google",
                    "email_address": "user@gmail.com",
                    "refresh_token": "google-refresh-token",
                    "folder": "junkemail",
                    "token_type": "gmail_api",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["meta"]["strategy"], "gmail_api")
        self.assertEqual(payload["meta"]["provider"], "google")
        self.assertEqual(payload["data"][0]["id"], "gmail-1")
        fetch_gmail.assert_called_once()
        exchange_ms.assert_not_called()

    def test_google_oauth_start_returns_html_when_config_missing(self) -> None:
        broken_settings = Settings(
            frontend_dir=self.settings.frontend_dir,
            db_path=self.settings.db_path,
            sensitive_key_path=self.settings.sensitive_key_path,
            cors_origin="",
            imap_host=self.settings.imap_host,
            imap_port=self.settings.imap_port,
            imap_timeout=self.settings.imap_timeout,
            http_timeout=self.settings.http_timeout,
            mail_fetch_limit=self.settings.mail_fetch_limit,
            auth_session_ttl_days=self.settings.auth_session_ttl_days,
            login_max_failed_attempts=self.settings.login_max_failed_attempts,
            login_rate_window_minutes=self.settings.login_rate_window_minutes,
            login_lockout_minutes=self.settings.login_lockout_minutes,
            live_token_url=self.settings.live_token_url,
            microsoft_token_url=self.settings.microsoft_token_url,
            graph_base_url=self.settings.graph_base_url,
            google_client_id="",
            google_client_secret="",
            google_redirect_uri="",
            google_auth_url=self.settings.google_auth_url,
            google_token_url=self.settings.google_token_url,
            gmail_api_base_url=self.settings.gmail_api_base_url,
            google_state_secret="",
            turnstile_site_key=self.settings.turnstile_site_key,
            turnstile_secret_key=self.settings.turnstile_secret_key,
            turnstile_verify_url=self.settings.turnstile_verify_url,
        )
        app = create_app(broken_settings)
        client = app.test_client()

        response = client.get(
            "/api/oauth/google/start",
            query_string={
                "account_email": "user@gmail.com",
                "return_origin": "http://127.0.0.1:5173",
            },
        )

        self.assertEqual(response.status_code, 500)
        body = response.get_data(as_text=True)
        self.assertIn("Google OAuth 配置不完整", body)
        self.assertIn("Gmail 授权失败", body)

    def test_google_oauth_start_rejects_untrusted_return_origin(self) -> None:
        response = self.client.get(
            "/api/oauth/google/start",
            query_string={
                "account_email": "user@gmail.com",
                "return_origin": "https://evil.example.com",
            },
        )

        self.assertEqual(response.status_code, 400)
        body = response.get_data(as_text=True)
        self.assertIn("return_origin 不在允许列表中", body)

    def test_google_oauth_callback_success_returns_postmessage_html(self) -> None:
        state = build_google_oauth_state(
            self.settings,
            "user@gmail.com",
            "http://127.0.0.1:5173",
        )
        token_bundle = GoogleTokenBundle(
            access_token="google-access-token",
            refresh_token="google-refresh-token",
            expires_in=3600,
            token_endpoint=self.settings.google_token_url,
            raw={},
        )
        with patch("backend.app.exchange_google_authorization_code", return_value=token_bundle), patch(
            "backend.app.fetch_gmail_profile",
            return_value={"emailAddress": "user@gmail.com"},
        ):
            response = self.client.get(
                "/api/oauth/google/callback",
                query_string={"state": state, "code": "auth-code"},
            )

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn("window.opener.postMessage", body)
        self.assertIn('"token_type": "gmail_api"', body)
        self.assertIn('"email_address": "user@gmail.com"', body)

    def test_google_oauth_callback_rejects_email_mismatch(self) -> None:
        state = build_google_oauth_state(
            self.settings,
            "user@gmail.com",
            "http://127.0.0.1:5173",
        )
        token_bundle = GoogleTokenBundle(
            access_token="google-access-token",
            refresh_token="google-refresh-token",
            expires_in=3600,
            token_endpoint=self.settings.google_token_url,
            raw={},
        )
        with patch("backend.app.exchange_google_authorization_code", return_value=token_bundle), patch(
            "backend.app.fetch_gmail_profile",
            return_value={"emailAddress": "other@gmail.com"},
        ):
            response = self.client.get(
                "/api/oauth/google/callback",
                query_string={"state": state, "code": "auth-code"},
            )

        self.assertEqual(response.status_code, 400)
        body = response.get_data(as_text=True)
        self.assertIn("当前授权的 Google 账号与目标邮箱不一致", body)

    def test_fetch_gmail_messages_parses_html_plain_and_unread(self) -> None:
        calls: list[str] = []

        def fake_gmail_get_json(_settings, _access_token, url):
            calls.append(url)
            if "messages?" in url:
                return {"messages": [{"id": "m-1"}]}
            return {
                "id": "m-1",
                "internalDate": "1776573600000",
                "snippet": "Snippet preview",
                "labelIds": ["INBOX", "UNREAD"],
                "payload": {
                    "mimeType": "multipart/alternative",
                    "headers": [
                        {"name": "Subject", "value": "=?UTF-8?B?5rWL6K+V?="},
                        {"name": "From", "value": "Mailer <mailer@example.com>"},
                    ],
                    "parts": [
                        {
                            "mimeType": "text/plain",
                            "body": {"data": "UGxhaW4gYm9keQ"},
                        },
                        {
                            "mimeType": "text/html",
                            "body": {"data": "PHA-SFRNTCBib2R5PC9wPg"},
                        },
                    ],
                },
            }

        with patch("backend.google._gmail_get_json", side_effect=fake_gmail_get_json):
            emails = fetch_gmail_messages(
                self.settings,
                "google-access-token",
                "inbox",
                20,
            )

        self.assertEqual(len(emails), 1)
        self.assertEqual(emails[0]["subject"], "测试")
        self.assertEqual(emails[0]["from_address"], "mailer@example.com")
        self.assertEqual(emails[0]["body"], "")
        self.assertNotIn("body_html", emails[0])
        self.assertFalse(emails[0]["is_read"])
        self.assertIn("labelIds=INBOX", calls[0])

    def test_fetch_gmail_messages_uses_include_spam_trash_for_junk_folder(self) -> None:
        calls: list[str] = []

        def fake_gmail_get_json(_settings, _access_token, url):
            calls.append(url)
            if "messages?" in url:
                return {"messages": []}
            return {}

        with patch("backend.google._gmail_get_json", side_effect=fake_gmail_get_json):
            emails = fetch_gmail_messages(
                self.settings,
                "google-access-token",
                "junkemail",
                20,
            )

        self.assertEqual(emails, [])
        self.assertIn("labelIds=SPAM", calls[0])
        self.assertIn("includeSpamTrash=true", calls[0])

    def test_email_detail_uses_google_provider_path(self) -> None:
        token_bundle = GoogleTokenBundle(
            access_token="google-access-token",
            refresh_token="rotated-google-refresh-token",
            expires_in=3600,
            token_endpoint=self.settings.google_token_url,
            raw={},
        )
        gmail_detail = {
            "id": "gmail-1",
            "subject": "Hello Gmail",
            "from_address": "sender@gmail.com",
            "from_name": "Sender",
            "received_time": "2026-04-19 10:00:00",
            "body_preview": "preview",
            "body": "<p>gmail</p>",
            "body_html": "<p>gmail</p>",
            "is_read": False,
        }

        with patch("backend.app.exchange_google_refresh_token", return_value=token_bundle), patch(
            "backend.app.fetch_gmail_message_detail",
            return_value=gmail_detail,
        ) as fetch_detail:
            response = self.client.post(
                "/api/emails/detail",
                json={
                    "provider": "google",
                    "email_address": "user@gmail.com",
                    "refresh_token": "google-refresh-token",
                    "message_id": "gmail-1",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["meta"]["strategy"], "gmail_api_detail")
        self.assertEqual(payload["meta"]["provider"], "google")
        self.assertEqual(payload["meta"]["rotated_refresh_token"], "rotated-google-refresh-token")
        self.assertEqual(payload["data"]["id"], "gmail-1")
        fetch_detail.assert_called_once_with(
            self.settings,
            "google-access-token",
            "gmail-1",
        )

    def test_auth_register_and_me(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
                "display_name": "Owner",
            },
        )

        self.assertEqual(register_response.status_code, 200)
        register_payload = register_response.get_json()
        self.assertTrue(register_payload["success"])
        self.assertTrue(register_payload["token"])
        self.assertEqual(register_payload["user"]["email"], "owner@example.com")
        self.assertTrue(register_payload["profile"]["allow_sensitive_sync"])

        me_response = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {register_payload['token']}"},
        )

        self.assertEqual(me_response.status_code, 200)
        me_payload = me_response.get_json()
        self.assertEqual(me_payload["user"]["email"], "owner@example.com")
        self.assertEqual(me_payload["cloud_summary"]["account_count"], 0)

    def test_turnstile_config_and_auth_validation_when_enabled(self) -> None:
        enabled_settings = replace(
            self.settings,
            turnstile_site_key="site-key",
            turnstile_secret_key="secret-key",
        )
        app = create_app(enabled_settings)
        client = app.test_client()

        config_response = client.get("/api/auth/security-config")
        self.assertEqual(config_response.status_code, 200)
        config_payload = config_response.get_json()
        self.assertTrue(config_payload["turnstile_enabled"])
        self.assertEqual(config_payload["turnstile_site_key"], "site-key")

        missing_captcha_response = client.post(
            "/api/auth/register",
            json={
                "email": "captcha-owner@example.com",
                "password": "password-123",
            },
        )
        self.assertEqual(missing_captcha_response.status_code, 400)
        self.assertEqual(
            missing_captcha_response.get_json()["error_type"],
            "captcha_required",
        )

        with patch("backend.app.verify_turnstile_token") as verify_captcha:
            register_response = client.post(
                "/api/auth/register",
                json={
                    "email": "captcha-owner@example.com",
                    "password": "password-123",
                    "captcha_token": "captcha-token",
                },
            )

        self.assertEqual(register_response.status_code, 200)
        verify_captcha.assert_called_once_with(
            enabled_settings,
            "captcha-token",
            "127.0.0.1",
        )

    def test_login_rate_limit_blocks_repeated_bad_passwords(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        self.assertEqual(register_response.status_code, 200)

        for _ in range(self.settings.login_max_failed_attempts - 1):
            response = self.client.post(
                "/api/auth/login",
                json={
                    "email": "owner@example.com",
                    "password": "wrong-password",
                },
            )
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json()["error_type"], "invalid_credentials")

        limited_response = self.client.post(
            "/api/auth/login",
            json={
                "email": "owner@example.com",
                "password": "wrong-password",
            },
        )
        self.assertEqual(limited_response.status_code, 429)
        self.assertEqual(limited_response.get_json()["error_type"], "rate_limited")
        self.assertIn("Retry-After", limited_response.headers)

        correct_password_response = self.client.post(
            "/api/auth/login",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        self.assertEqual(correct_password_response.status_code, 429)

    def test_cloud_sync_rejects_sensitive_fields(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        token = register_response.get_json()["token"]

        response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "user@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "password": "should-not-pass",
                    }
                ],
                "replace_missing": True,
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error_type"], "invalid")
        self.assertIn("敏感字段", payload["message"])

    def test_cloud_sync_append_and_update_reports_no_deleted_accounts(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        token = register_response.get_json()["token"]

        first_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "first@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "status": "正常",
                        "import_sequence": 1,
                    }
                ],
                "replace_missing": True,
            },
        )
        self.assertEqual(first_response.status_code, 200)

        update_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "first@example.com",
                        "provider": "microsoft",
                        "group_name": "B",
                        "status": "正常",
                        "import_sequence": 1,
                    },
                    {
                        "email_address": "second@example.com",
                        "provider": "microsoft",
                        "group_name": "B",
                        "status": "正常",
                        "import_sequence": 2,
                    },
                ],
                "replace_missing": False,
            },
        )

        self.assertEqual(update_response.status_code, 200)
        payload = update_response.get_json()
        self.assertEqual(payload["data"]["upserted"], 2)
        self.assertEqual(payload["data"]["deleted"], 0)
        self.assertEqual(payload["data"]["total"], 2)

    def test_cloud_sync_replace_missing_reports_actual_deleted_count(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        token = register_response.get_json()["token"]

        seed_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "keep@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "status": "正常",
                        "import_sequence": 1,
                    },
                    {
                        "email_address": "delete-one@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "status": "正常",
                        "import_sequence": 2,
                    },
                    {
                        "email_address": "delete-two@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "status": "正常",
                        "import_sequence": 3,
                    },
                ],
                "replace_missing": True,
            },
        )
        self.assertEqual(seed_response.status_code, 200)

        replace_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "keep@example.com",
                        "provider": "microsoft",
                        "group_name": "A",
                        "status": "正常",
                        "import_sequence": 1,
                    }
                ],
                "replace_missing": True,
            },
        )

        self.assertEqual(replace_response.status_code, 200)
        payload = replace_response.get_json()
        self.assertEqual(payload["data"]["upserted"], 1)
        self.assertEqual(payload["data"]["deleted"], 2)
        self.assertEqual(payload["data"]["total"], 1)

    def test_cloud_secrets_use_auth_token_and_stay_out_of_plain_cloud_sync(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        token = register_response.get_json()["token"]

        sync_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "user@gmail.com",
                        "provider": "google",
                        "group_name": "Gmail",
                        "status": "未授权",
                        "oauth_status": "not_connected",
                        "import_sequence": 1,
                    }
                ],
                "replace_missing": True,
            },
        )
        self.assertEqual(sync_response.status_code, 200)

        secret_response = self.client.post(
            "/api/cloud/secrets/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "user@gmail.com",
                        "provider": "google",
                        "password": "mail-password",
                        "recovery_email": "recovery@example.com",
                        "twofa_secret": "totp-secret",
                    }
                ],
            },
        )
        self.assertEqual(secret_response.status_code, 200)
        self.assertEqual(secret_response.get_json()["data"]["upserted"], 1)

        plain_response = self.client.get(
            "/api/cloud/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(plain_response.status_code, 200)
        plain_account = plain_response.get_json()["data"][0]
        self.assertNotIn("password", plain_account)
        self.assertNotIn("twofa_secret", plain_account)

        cookie_unlock = self.client.post(
            "/api/cloud/secrets/unlock",
            json={},
        )
        self.assertEqual(cookie_unlock.status_code, 200)

        no_auth_unlock = self.app.test_client().post(
            "/api/cloud/secrets/unlock",
            json={},
        )
        self.assertEqual(no_auth_unlock.status_code, 401)

        unlock_response = self.client.post(
            "/api/cloud/secrets/unlock",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        self.assertEqual(unlock_response.status_code, 200)
        secret = unlock_response.get_json()["data"][0]
        self.assertEqual(secret["email_address"], "user@gmail.com")
        self.assertEqual(secret["password"], "mail-password")
        self.assertEqual(secret["recovery_email"], "recovery@example.com")
        self.assertEqual(secret["twofa_secret"], "totp-secret")

        with sqlite3.connect(self.settings.db_path) as conn:
            encrypted_payload = conn.execute(
                "SELECT encrypted_payload FROM cloud_account_secrets"
            ).fetchone()[0]
        self.assertNotIn("mail-password", encrypted_payload)
        self.assertNotIn("totp-secret", encrypted_payload)

    def test_cloud_sync_isolated_by_user(self) -> None:
        first = self.client.post(
            "/api/auth/register",
            json={"email": "first@example.com", "password": "password-123"},
        ).get_json()
        second = self.client.post(
            "/api/auth/register",
            json={"email": "second@example.com", "password": "password-123"},
        ).get_json()

        sync_response = self.client.post(
            "/api/cloud/accounts/sync",
            headers={"Authorization": f"Bearer {first['token']}"},
            json={
                "accounts": [
                    {
                        "email_address": "first-user@example.com",
                        "provider": "google",
                        "group_name": "Team A",
                        "status": "未授权",
                        "note": "cloud only",
                        "oauth_status": "not_connected",
                        "import_sequence": 1,
                    }
                ],
                "replace_missing": True,
            },
        )

        self.assertEqual(sync_response.status_code, 200)
        self.assertEqual(sync_response.get_json()["data"]["total"], 1)

        first_list = self.client.get(
            "/api/cloud/accounts",
            headers={"Authorization": f"Bearer {first['token']}"},
        )
        second_list = self.client.get(
            "/api/cloud/accounts",
            headers={"Authorization": f"Bearer {second['token']}"},
        )

        self.assertEqual(first_list.status_code, 200)
        self.assertEqual(second_list.status_code, 200)
        self.assertEqual(len(first_list.get_json()["data"]), 1)
        self.assertEqual(first_list.get_json()["data"][0]["email_address"], "first-user@example.com")
        self.assertEqual(second_list.get_json()["data"], [])

    def test_generate_two_factor_code_matches_rfc_6238_sha1_vector(self) -> None:
        secret = base64.b32encode(b"12345678901234567890").decode("ascii")
        otpauth = (
            f"otpauth://totp/JEmail:test@example.com"
            f"?secret={secret}&digits=8&period=30&algorithm=SHA1"
        )

        result = generate_two_factor_code(
            otpauth,
            now=datetime.fromtimestamp(59, timezone.utc),
        )

        self.assertEqual(result.code, "94287082")
        self.assertEqual(result.digits, 8)
        self.assertEqual(result.period, 30)
        self.assertEqual(result.algorithm, "SHA1")

    def test_generate_two_factor_code_endpoint_accepts_local_secret_payload(self) -> None:
        response = self.client.post(
            "/api/twofa/code",
            json={
                "email_address": "user@gmail.com",
                "twofa_secret": "JBSWY3DPEHPK3PXP",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["email_address"], "user@gmail.com")
        self.assertEqual(payload["data"]["source"], "payload")
        self.assertEqual(len(payload["data"]["code"]), 6)

    def test_generate_two_factor_code_endpoint_reads_cloud_secret_when_authenticated(self) -> None:
        register_response = self.client.post(
            "/api/auth/register",
            json={
                "email": "owner@example.com",
                "password": "password-123",
            },
        )
        token = register_response.get_json()["token"]

        self.client.post(
            "/api/cloud/secrets/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "accounts": [
                    {
                        "email_address": "user@gmail.com",
                        "provider": "google",
                        "twofa_secret": "JBSWY3DPEHPK3PXP",
                    }
                ],
            },
        )

        response = self.client.post(
            "/api/twofa/code",
            headers={"Authorization": f"Bearer {token}"},
            json={"email_address": "user@gmail.com"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["source"], "cloud")
        self.assertEqual(len(payload["data"]["code"]), 6)

    def test_generate_two_factor_code_endpoint_rejects_invalid_secret(self) -> None:
        response = self.client.post(
            "/api/twofa/code",
            json={
                "email_address": "user@gmail.com",
                "twofa_secret": "not@valid!",
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error_type"], "invalid")


if __name__ == "__main__":
    unittest.main()
