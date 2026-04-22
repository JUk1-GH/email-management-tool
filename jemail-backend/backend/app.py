from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_from_directory

from .config import Settings, load_settings
from .db import (
    initialize_database,
    list_cloud_account_secrets,
    list_cloud_accounts,
    login_user,
    logout_session,
    register_user,
    resolve_session,
    sync_cloud_account_secrets,
    sync_cloud_accounts,
    touch_cloud_pull,
)
from .errors import AppError
from .google import (
    build_google_authorization_url,
    exchange_google_authorization_code,
    exchange_google_refresh_token,
    fetch_gmail_message_detail,
    fetch_gmail_messages,
    fetch_gmail_profile,
    parse_google_oauth_state,
    render_google_oauth_result_page,
    validate_return_origin,
)
from .mail import fetch_imap_messages
from .microsoft import exchange_refresh_token, fetch_graph_messages, probe_graph_access
from .models import (
    CloudAccountsSyncRequest,
    CloudSecretsSyncRequest,
    CloudSecretsUnlockRequest,
    DetectPermissionRequest,
    EmailDetailRequest,
    LoginRequest,
    RefreshEmailsRequest,
    RegisterRequest,
    TwoFactorCodeRequest,
)
from .twofa import generate_two_factor_code
from .turnstile import is_turnstile_enabled, verify_turnstile_token

AUTH_COOKIE_NAME = "jemail_session"


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or load_settings()
    initialize_database(settings)
    app = Flask(__name__, static_folder=None)
    app.config["JSON_AS_ASCII"] = False
    app.config["JEMAIL_SETTINGS"] = settings

    @app.after_request
    def add_security_headers(response):
        cors_origin = settings.cors_origin
        if cors_origin:
            response.headers["Access-Control-Allow-Origin"] = cors_origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Credentials"] = "true"

        if request.path.startswith("/api/oauth/google/callback"):
            script_src = "script-src 'self' 'unsafe-inline'"
        else:
            script_src = "script-src 'self'"

        turnstile_origin = "https://challenges.cloudflare.com"
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            f"{script_src} {turnstile_origin}; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https: http:; "
            "font-src 'self' data:; "
            f"connect-src 'self' {turnstile_origin}; "
            f"frame-src 'self' about: {turnstile_origin}; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "frame-ancestors 'none'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        return response

    def attach_auth_cookie(response, token: str):
        response.set_cookie(
            AUTH_COOKIE_NAME,
            token,
            max_age=settings.auth_session_ttl_days * 24 * 60 * 60,
            secure=True,
            httponly=True,
            samesite="Lax",
            path="/",
        )
        return response

    def clear_auth_cookie(response):
        response.delete_cookie(AUTH_COOKIE_NAME, path="/", secure=True, httponly=True, samesite="Lax")
        return response

    def serve_frontend_asset(asset_path: str = "index.html"):
        frontend_dir = Path(app.config["JEMAIL_SETTINGS"].frontend_dir)
        target = frontend_dir / asset_path
        if asset_path != "index.html" and target.is_file():
            return send_from_directory(frontend_dir, asset_path)
        return send_from_directory(frontend_dir, "index.html")

    @app.errorhandler(AppError)
    def handle_app_error(error: AppError):
        response = jsonify(error.to_dict())
        retry_after = (error.details or {}).get("retry_after_seconds")
        if error.status_code == 429 and retry_after:
            response.headers["Retry-After"] = str(retry_after)
        return response, error.status_code

    def get_request_ip() -> str:
        forwarded_for = str(request.headers.get("X-Forwarded-For", "")).strip()
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return request.remote_addr or ""

    def get_request_user_agent() -> str:
        return str(getattr(request.user_agent, "string", "") or "")

    def get_bearer_token() -> str:
        authorization = str(request.headers.get("Authorization", "")).strip()
        token = ""
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if not token:
            token = str(request.cookies.get(AUTH_COOKIE_NAME, "")).strip()
        if not token:
            raise AppError("缺少登录凭证", "unauthorized", 401)
        return token

    def require_auth() -> tuple[str, dict[str, object]]:
        token = get_bearer_token()
        identity = resolve_session(settings, token)
        return token, identity

    def try_require_auth() -> tuple[str, dict[str, object]] | None:
        authorization = str(request.headers.get("Authorization", "")).strip()
        cookie_token = str(request.cookies.get(AUTH_COOKIE_NAME, "")).strip()
        if not authorization and not cookie_token:
            return None
        return require_auth()

    @app.get("/healthz")
    def healthz():
        return jsonify(
            {
                "success": True,
                "status": "ok",
                "frontend_dir": str(settings.frontend_dir),
                "db_path": str(settings.db_path),
                "mail_fetch_limit": settings.mail_fetch_limit,
            }
        )

    @app.route("/api/<path:_api_path>", methods=["OPTIONS"])
    @app.route("/detect-permission", methods=["OPTIONS"])
    def cors_preflight(_api_path: str | None = None):
        return ("", 204)

    @app.get("/api/auth/security-config")
    def auth_security_config():
        return jsonify(
            {
                "success": True,
                "turnstile_enabled": is_turnstile_enabled(settings),
                "turnstile_site_key": settings.turnstile_site_key
                if is_turnstile_enabled(settings)
                else "",
            }
        )

    @app.post("/api/auth/register")
    def auth_register():
        payload = RegisterRequest.from_dict(request.get_json(silent=True))
        verify_turnstile_token(settings, payload.captcha_token, get_request_ip())
        result = register_user(
            settings,
            payload.email,
            payload.password,
            payload.display_name,
            user_agent=get_request_user_agent(),
            ip_address=get_request_ip(),
        )
        response = jsonify(
            {
                "success": True,
                "message": "注册成功",
                **result,
            }
        )
        return attach_auth_cookie(response, str(result["token"]))

    @app.post("/api/auth/login")
    def auth_login():
        payload = LoginRequest.from_dict(request.get_json(silent=True))
        verify_turnstile_token(settings, payload.captcha_token, get_request_ip())
        result = login_user(
            settings,
            payload.email,
            payload.password,
            user_agent=get_request_user_agent(),
            ip_address=get_request_ip(),
        )
        response = jsonify(
            {
                "success": True,
                "message": "登录成功",
                **result,
            }
        )
        return attach_auth_cookie(response, str(result["token"]))

    @app.get("/api/auth/me")
    def auth_me():
        _, identity = require_auth()
        return jsonify(
            {
                "success": True,
                "message": "当前登录状态有效",
                **identity,
            }
        )

    @app.post("/api/auth/logout")
    def auth_logout():
        token = get_bearer_token()
        logout_session(settings, token)
        response = jsonify({"success": True, "message": "已退出登录"})
        return clear_auth_cookie(response)

    @app.get("/api/cloud/accounts")
    def cloud_accounts_list():
        _, identity = require_auth()
        user_id = int(identity["user"]["id"])
        accounts = list_cloud_accounts(settings, user_id)
        last_cloud_pull_at = touch_cloud_pull(settings, user_id)
        return jsonify(
            {
                "success": True,
                "message": f"成功获取 {len(accounts)} 条云端账号资料",
                "data": accounts,
                "meta": {
                    "count": len(accounts),
                    "last_cloud_pull_at": last_cloud_pull_at,
                },
            }
        )

    @app.post("/api/cloud/accounts/sync")
    def cloud_accounts_sync():
        _, identity = require_auth()
        payload = CloudAccountsSyncRequest.from_dict(request.get_json(silent=True))
        result = sync_cloud_accounts(
            settings,
            int(identity["user"]["id"]),
            payload.accounts,
            replace_missing=payload.replace_missing,
        )
        return jsonify(
            {
                "success": True,
                "message": f"云端账号资料同步完成，共写入 {result['upserted']} 条记录",
                "data": result,
            }
        )

    @app.post("/api/cloud/secrets/sync")
    def cloud_secrets_sync():
        _, identity = require_auth()
        payload = CloudSecretsSyncRequest.from_dict(request.get_json(silent=True))
        result = sync_cloud_account_secrets(
            settings,
            int(identity["user"]["id"]),
            payload.accounts,
        )
        return jsonify(
            {
                "success": True,
                "message": f"完整账号资料已加密同步，共写入 {result['upserted']} 条",
                "data": result,
            }
        )

    @app.post("/api/cloud/secrets/unlock")
    def cloud_secrets_unlock():
        _, identity = require_auth()
        payload = CloudSecretsUnlockRequest.from_dict(request.get_json(silent=True))
        secrets_payload = list_cloud_account_secrets(
            settings,
            int(identity["user"]["id"]),
            payload.emails,
        )
        return jsonify(
            {
                "success": True,
                "message": f"已获取 {len(secrets_payload)} 条完整账号资料",
                "data": secrets_payload,
                "meta": {"count": len(secrets_payload)},
            }
        )

    @app.post("/api/twofa/code")
    def generate_twofa_code():
        auth_payload = try_require_auth()
        payload = TwoFactorCodeRequest.from_dict(request.get_json(silent=True))

        secret_value = payload.twofa_secret
        source = "payload"
        if not secret_value:
            if auth_payload is None:
                raise AppError(
                    "缺少 2FA secret；请先补齐“两步验证”字段，或登录后从云端完整资料生成",
                    "invalid",
                    400,
                )
            _, identity = auth_payload
            secrets_payload = list_cloud_account_secrets(
                settings,
                int(identity["user"]["id"]),
                [payload.email_address],
            )
            if not secrets_payload:
                raise AppError("云端没有找到这条账号的 2FA secret", "not_found", 404)
            secret_value = str(secrets_payload[0].get("twofa_secret", "") or "").strip()
            if not secret_value:
                raise AppError("这条账号没有保存 2FA secret", "invalid", 400)
            source = "cloud"

        result = generate_two_factor_code(secret_value)
        return jsonify(
            {
                "success": True,
                "message": "已生成当前 2FA 动态码",
                "data": {
                    "email_address": payload.email_address,
                    "code": result.code,
                    "digits": result.digits,
                    "period": result.period,
                    "algorithm": result.algorithm,
                    "expires_in": result.expires_in,
                    "valid_until": result.valid_until,
                    "source": source,
                },
            }
        )

    @app.post("/detect-permission")
    def detect_permission():
        payload = DetectPermissionRequest.from_dict(request.get_json(silent=True))
        token_bundle = exchange_refresh_token(settings, payload.client_id, payload.refresh_token)

        if probe_graph_access(settings, token_bundle.access_token):
            token_type = "graph"
        else:
            # detect-permission 只收到 client_id + refresh_token，没有邮箱地址，
            # 无法像 refresh 接口那样真正完成 IMAP 登录，所以这里以 Graph
            # 探测结果为准，未命中时默认交给后端 IMAP 路径处理。
            token_type = "imap" if not token_bundle.is_probably_graph_token else "o2"

        return jsonify(
            {
                "success": True,
                "token_type": token_type,
                "use_local_ip": False,
                "meta": {
                    "token_endpoint": token_bundle.token_endpoint,
                    "rotated_refresh_token": bool(token_bundle.refresh_token),
                },
            }
        )

    @app.post("/api/emails/refresh")
    def refresh_emails():
        payload = RefreshEmailsRequest.from_dict(request.get_json(silent=True))
        if payload.provider == "google":
            token_bundle = exchange_google_refresh_token(settings, payload.refresh_token)
            emails = fetch_gmail_messages(
                settings,
                token_bundle.access_token,
                payload.folder,
                settings.mail_fetch_limit,
            )
            return jsonify(
                {
                    "success": True,
                    "message": f"成功刷新 {len(emails)} 封邮件",
                    "data": emails,
                    "meta": {
                        "strategy": "gmail_api",
                        "provider": "google",
                        "rotated_refresh_token": token_bundle.refresh_token or "",
                    },
                }
            )

        token_bundle = exchange_refresh_token(settings, payload.client_id, payload.refresh_token)
        preferred_type = payload.token_type.lower()
        strategies = ["imap", "graph"] if preferred_type != "graph" else ["graph", "imap"]

        errors: list[str] = []
        last_error: AppError | None = None
        for strategy in strategies:
            try:
                if strategy == "graph":
                    emails = fetch_graph_messages(
                        settings,
                        token_bundle.access_token,
                        payload.folder,
                        settings.mail_fetch_limit,
                    )
                else:
                    emails = fetch_imap_messages(
                        settings,
                        payload.email_address,
                        token_bundle.access_token,
                        payload.folder,
                        settings.mail_fetch_limit,
                    )
                return jsonify(
                    {
                        "success": True,
                        "message": f"成功刷新 {len(emails)} 封邮件",
                        "data": emails,
                        "meta": {
                            "strategy": strategy,
                            "provider": "microsoft",
                            "rotated_refresh_token": token_bundle.refresh_token or "",
                        },
                    }
                )
            except AppError as exc:
                errors.append(f"{strategy}: {exc.message}")
                last_error = exc

        if last_error is None:
            raise AppError("没有可用的邮件获取策略", "invalid", 500)

        raise AppError(
            last_error.message,
            last_error.error_type,
            last_error.status_code,
            {"attempts": errors},
        )

    @app.post("/api/emails/detail")
    def email_detail():
        payload = EmailDetailRequest.from_dict(request.get_json(silent=True))
        if payload.provider == "google":
            token_bundle = exchange_google_refresh_token(settings, payload.refresh_token)
            email = fetch_gmail_message_detail(
                settings,
                token_bundle.access_token,
                payload.message_id,
            )
            return jsonify(
                {
                    "success": True,
                    "message": "成功获取邮件详情",
                    "data": email,
                    "meta": {
                        "strategy": "gmail_api_detail",
                        "provider": "google",
                        "rotated_refresh_token": token_bundle.refresh_token or "",
                    },
                }
            )

        raise AppError("当前只支持 Gmail 邮件详情单独拉取", "invalid", 400)

    @app.get("/api/oauth/google/start")
    def google_oauth_start():
        account_email = str(request.args.get("account_email", "")).strip()
        return_origin = str(request.args.get("return_origin", "")).strip()

        try:
            auth_url = build_google_authorization_url(settings, account_email, return_origin)
            return redirect(auth_url, code=302)
        except AppError as exc:
            safe_return_origin = None
            try:
                safe_return_origin = validate_return_origin(settings, return_origin)
            except AppError:
                safe_return_origin = None
            page, status_code, headers = render_google_oauth_result_page(
                False,
                exc.message,
                return_origin=safe_return_origin,
                payload={
                    "provider": "google",
                    "email_address": account_email,
                },
                status_code=exc.status_code,
            )
            return page, status_code, headers

    @app.get("/api/oauth/google/callback")
    def google_oauth_callback():
        raw_state = str(request.args.get("state", "")).strip()
        error_code = str(request.args.get("error", "")).strip()
        error_description = str(request.args.get("error_description", "")).strip()
        code = str(request.args.get("code", "")).strip()

        parsed_state = None
        if raw_state:
            try:
                parsed_state = parse_google_oauth_state(settings, raw_state)
            except AppError:
                parsed_state = None

        if error_code:
            message = error_description or "Google 授权未完成"
            page, status_code, headers = render_google_oauth_result_page(
                False,
                message,
                return_origin=parsed_state.return_origin if parsed_state else None,
                payload={
                    "provider": "google",
                    "email_address": parsed_state.account_email if parsed_state else "",
                    "error_code": error_code,
                },
                status_code=400,
            )
            return page, status_code, headers

        try:
            state = parse_google_oauth_state(settings, raw_state)
            if not code:
                raise AppError("Google OAuth 回调缺少 code", "invalid", 400)

            token_bundle = exchange_google_authorization_code(settings, code)
            profile = fetch_gmail_profile(settings, token_bundle.access_token)
            oauth_email = str(profile.get("emailAddress", "")).strip()
            if not oauth_email:
                raise AppError("Gmail profile 未返回邮箱地址", "invalid", 502)
            if oauth_email.lower() != state.account_email.lower():
                raise AppError(
                    "当前授权的 Google 账号与目标邮箱不一致，请使用同一邮箱完成绑定",
                    "invalid",
                    400,
                    {
                        "target_email": state.account_email,
                        "oauth_email": oauth_email,
                    },
                )
            if not token_bundle.refresh_token:
                raise AppError(
                    "Google OAuth 未返回 refresh token，请确认 consent screen、offline access 与 prompt=consent 配置正确",
                    "invalid",
                    502,
                )

            page, status_code, headers = render_google_oauth_result_page(
                True,
                "Gmail 授权成功，正在返回原页面",
                return_origin=state.return_origin,
                payload={
                    "provider": "google",
                    "email_address": state.account_email,
                    "oauth_email": oauth_email,
                    "client_id": settings.google_client_id,
                    "refresh_token": token_bundle.refresh_token,
                    "token_type": "gmail_api",
                    "expires_in": token_bundle.expires_in,
                    "oauth_updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            return page, status_code, headers
        except AppError as exc:
            page, status_code, headers = render_google_oauth_result_page(
                False,
                exc.message,
                return_origin=parsed_state.return_origin if parsed_state else None,
                payload={
                    "provider": "google",
                    "email_address": parsed_state.account_email if parsed_state else "",
                },
                status_code=exc.status_code,
            )
            return page, status_code, headers

    @app.get("/")
    def index():
        return serve_frontend_asset("index.html")

    @app.get("/<path:asset_path>")
    def frontend(asset_path: str):
        return serve_frontend_asset(asset_path)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8788")))
