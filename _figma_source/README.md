
  # Upgrade UI Design

  This is a code bundle for Upgrade UI Design. The original project is available at https://www.figma.com/design/adK4jyv27zy8W5ExXm4S8t/Upgrade-UI-Design.

  ## Running the code

  This project may fail under the Node.js runtime bundled inside `Codex.app` on macOS, especially when the repo lives on an external SSD. The common symptom is:

  `code signature not valid for use in process` or `different Team IDs`

  The bundled wrapper scripts automatically pick a Homebrew or nvm Node when one is available, so use these commands from the project root:

  Run `./scripts/npm.sh install` to install dependencies.

  Run `npm run dev` to start the development server.

  Run `npm run build` to create the production bundle.

  ## Gmail OAuth 本地联调

  这个 React 前端现在支持两类账号入口：

  - Outlook / Microsoft 库存账号
  - Gmail 库存账号与 OAuth 绑定账号

  Gmail 本地联调时，请同时启动 `jemail-backend`，并确保后端 `.env` 已配置：

  - `JEMAIL_GOOGLE_CLIENT_ID`
  - `JEMAIL_GOOGLE_CLIENT_SECRET`
  - `JEMAIL_GOOGLE_REDIRECT_URI`
  - `JEMAIL_GOOGLE_STATE_SECRET`

  本地常用回调地址：

  `http://127.0.0.1:8788/api/oauth/google/callback`

  导入 Gmail 库存账号时，推荐使用显式 provider 格式：

  `google----邮箱地址----密码----辅助邮箱----2FA----分组`

  授权成功后，账号会切到 `gmail_api` 协议并可读取收件箱 / 垃圾邮件。

  注意：如果 Google OAuth consent screen 仍处于 Testing，refresh token 可能在 7 天后失效。

  If you want to force a specific Node binary, set `JEMAIL_NODE_BIN` first, for example:

  `JEMAIL_NODE_BIN=/opt/homebrew/bin/node npm run dev`
  
