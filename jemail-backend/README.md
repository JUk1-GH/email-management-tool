# jemail Backend

给 `jemail-app` 配套的新后端，目标是：

- 同域托管前端静态文件，或作为独立 API 服务使用
- 提供 `POST /detect-permission`
- 提供 `POST /api/emails/refresh`
- 提供 Google OAuth 开始和回调接口
- 用 Outlook `refresh_token` 动态换 `access_token`
- 优先走 IMAP XOAUTH2 拉邮件，必要时兼容 Microsoft Graph
- 用 Google OAuth + Gmail API 读取 Gmail 收件箱与垃圾邮件

## 目录

```text
jemail-backend/
├── app.py
├── requirements.txt
└── backend/
    ├── app.py
    ├── config.py
    ├── errors.py
    ├── google.py
    ├── mail.py
    ├── microsoft.py
    └── models.py
```

## 快速启动

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

默认会把 `/Volumes/SSD/Email Tool/jemail-app` 当成前端目录并托管到同源。

如果你采用前后端分离结构，也可以只把它当纯 API 服务运行。

## 环境变量

- `JEMAIL_FRONTEND_DIR`：前端静态目录
- `JEMAIL_CORS_ORIGIN`：允许跨域的前端来源，例如 `https://app.example.com`
- `JEMAIL_IMAP_HOST`：默认 `outlook.office365.com`
- `JEMAIL_IMAP_PORT`：默认 `993`
- `JEMAIL_IMAP_TIMEOUT`：默认 `20`
- `JEMAIL_HTTP_TIMEOUT`：默认 `20`
- `JEMAIL_MAIL_FETCH_LIMIT`：默认 `50`
- `JEMAIL_LIVE_TOKEN_URL`：默认 `https://login.live.com/oauth20_token.srf`
- `JEMAIL_MS_TOKEN_URL`：默认 `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- `JEMAIL_GRAPH_BASE_URL`：默认 `https://graph.microsoft.com/v1.0`
- `JEMAIL_GOOGLE_CLIENT_ID`
- `JEMAIL_GOOGLE_CLIENT_SECRET`
- `JEMAIL_GOOGLE_REDIRECT_URI`
- `JEMAIL_GOOGLE_AUTH_URL`：默认 `https://accounts.google.com/o/oauth2/v2/auth`
- `JEMAIL_GOOGLE_TOKEN_URL`：默认 `https://oauth2.googleapis.com/token`
- `JEMAIL_GMAIL_API_BASE_URL`：默认 `https://gmail.googleapis.com/gmail/v1`
- `JEMAIL_GOOGLE_STATE_SECRET`：Google OAuth state 签名密钥；不填时回退到 `JEMAIL_GOOGLE_CLIENT_SECRET`

## 接口

### `POST /detect-permission`

这条接口只给 Microsoft / Outlook 账号使用。

请求：

```json
{
  "client_id": "xxx",
  "refresh_token": "xxx"
}
```

响应：

```json
{
  "success": true,
  "token_type": "imap",
  "use_local_ip": false
}
```

### `POST /api/emails/refresh`

请求：

```json
{
  "provider": "microsoft",
  "email_address": "user@outlook.com",
  "client_id": "xxx",
  "refresh_token": "xxx",
  "folder": "inbox",
  "token_type": "imap"
}
```

Gmail 请求示例：

```json
{
  "provider": "google",
  "email_address": "user@gmail.com",
  "refresh_token": "xxx",
  "folder": "junkemail",
  "token_type": "gmail_api"
}
```

### `GET /api/oauth/google/start`

查询参数：

- `account_email`
- `return_origin`

用途：

- 生成签名 state
- 302 跳转 Google OAuth

### `GET /api/oauth/google/callback`

用途：

- 用授权码换 Google token
- 校验 Gmail profile 对应的邮箱
- 通过 popup `postMessage` 把 `refresh_token`、`client_id`、`token_type=gmail_api` 回传给前端

## Google Cloud Console 需要配置什么

1. 创建 OAuth Client，类型选 Web application
2. 启用 Gmail API
3. 配置 OAuth consent screen
4. 如果应用处于 Testing，把实际联调邮箱加入 Test Users
5. Authorized redirect URI 填后端回调地址，例如：

```text
http://127.0.0.1:8788/api/oauth/google/callback
```

注意：

- Google OAuth Testing 模式下 refresh token 可能 7 天后失效
- Gmail 绑定和读取只走官方 OAuth + Gmail API，不走 Gmail IMAP XOAUTH2

响应：

```json
{
  "success": true,
  "message": "成功刷新 20 封邮件",
  "data": [
    {
      "id": "123",
      "subject": "Hello",
      "from_address": "sender@example.com",
      "from_name": "Sender",
      "received_time": "2026-04-17 01:23:45",
      "body_preview": "预览文本",
      "body": "<html>...</html>",
      "is_read": true
    }
  ]
}
```

失败时会返回：

```json
{
  "success": false,
  "message": "刷新令牌已过期",
  "error_type": "expired"
}
```

## 服务器部署

- 前端和后端可以放在同一台服务器
- 也可以把前端放在静态托管，后端单独作为 API 服务

配套脚本和模板在 `deploy/` 目录里。
