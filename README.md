# jemail

`jemail` 是一个个人邮箱管理工具源码，重点面向 `Outlook / Microsoft 365 / Gmail` 账号的批量导入、管理和查看。

## 核心功能

- 批量导入并管理 Outlook / Gmail 邮箱账号
- 接收并查看邮箱信息，支持收件箱和垃圾邮件
- 支持 Google 账号一键绑定，并生成 2FA 动态码
- 支持账号分组管理、筛选和批量操作
- 支持登录后同步完整账号资料，方便跨设备使用

## 项目定位

这个仓库是源码分享，不是邮件服务平台，也不是企业协作套件。

它更适合：

- 个人自用
- 自行修改
- 二次开发

## 当前主线代码

- `_figma_source/`：新版 React 前端
- `jemail-app/`：旧版 Vue 前端
- `jemail-backend/`：Flask 后端

当前实现重点：

- 浏览器本地管理邮箱账号和分组
- 后端按需刷新 Microsoft / Google 令牌并拉取邮件
- Gmail 走官方 OAuth + Gmail API
- 完整账号资料支持登录后同步和恢复

## 第一阶段已落地

- 注册 / 登录 / 退出登录
- SQLite 用户库
- 用户级会话鉴权与数据隔离
- 完整账号资料同步
- 新版 React 前端基础可用布局

### 会上云的数据

- 邮箱地址
- provider
- 分组
- 状态
- 备注
- oauth_status
- oauth_email
- oauth_updated_at
- 导入序号

### 默认不会进入普通同步接口的数据

- 邮箱密码
- Outlook refresh token
- Gmail refresh token
- 2FA / 辅助邮箱
- `client_id`
- 邮件正文和缓存邮件

这些字段如果需要跨设备管理，必须走“完整账号资料”接口：

- 后端表：`cloud_account_secrets`
- 加密方式：Fernet 对称加密
- key 文件：由 `JEMAIL_SENSITIVE_KEY_PATH` 指定，默认在数据库目录下
- 前端：设置页登录后可以直接拉取、同步或导出完整资料

### 本地模式 vs 云端模式

- 未登录：继续按原来方式只用本地 IndexedDB
- 已登录：可以把普通资料同步到云端，并在新设备登录后拉回本地查看列表
- 已登录：可以把完整凭据加密同步到服务器，或拉取回当前设备本地 IndexedDB
- 普通列表接口不会返回完整凭据；需要完整资料时走 `/api/cloud/secrets/unlock`

## 仓库结构

当前应该优先关注的目录：

- `jemail-app/`：当前前端，Vue 3 + Element Plus + IndexedDB，本地 vendor 资源，无构建步骤也能跑
- `jemail-backend/`：当前后端，Flask API + Microsoft token 交换 + IMAP/Graph 邮件读取
- `docs/`：项目说明、架构、开发和部署文档
- `AGENTS.md`：给 AI / 新接手开发者的快速项目地图

下面这些目录或文件是历史遗留，不是当前生产主线：

- `outlook-manager/`：更早期的轻量原型
- `docker-compose.yml`、根目录 `.env.example`：更早期的 Nextcloud 方案残留
- `server-backups/`：服务器拉回来的备份，不纳入 Git

## 本地开发

### 1. 启动后端

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

如果你要本地联调 Gmail OAuth，请在 `.env` 里额外填写：

```bash
JEMAIL_GOOGLE_CLIENT_ID=...
JEMAIL_GOOGLE_CLIENT_SECRET=...
JEMAIL_GOOGLE_REDIRECT_URI=http://127.0.0.1:8788/api/oauth/google/callback
JEMAIL_GOOGLE_STATE_SECRET=请填一个随机长字符串
```

如果你要启用第一阶段数据库和登录会话，建议同时填写：

```bash
JEMAIL_DB_PATH=/absolute/path/to/jemail.sqlite3
JEMAIL_SENSITIVE_KEY_PATH=/absolute/path/to/jemail_sensitive_fernet.key
JEMAIL_AUTH_SESSION_TTL_DAYS=30
JEMAIL_LOGIN_MAX_FAILED_ATTEMPTS=5
JEMAIL_LOGIN_RATE_WINDOW_MINUTES=15
JEMAIL_LOGIN_LOCKOUT_MINUTES=15
JEMAIL_TURNSTILE_SITE_KEY=
JEMAIL_TURNSTILE_SECRET_KEY=
```

默认监听：

```text
http://127.0.0.1:8788
```

当前本地联调推荐组合：

- 前端：`_figma_source/`
- 后端：`jemail-backend/`

### 2. 打开前端

后端启动后，直接访问：

```text
http://127.0.0.1:8788
```

因为默认情况下，Flask 会把 `jemail-app/` 当成静态目录一起托管。

如果你要联调新的 React 前端：

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run dev
```

React 前端默认从当前页面 origin 推断 API；如果你的接口地址不是当前页面 origin，可以通过 `jemail-app/config.js` 或运行时配置指定 `API_BASE`。

## 测试

后端测试：

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
.venv/bin/python -m unittest discover -s tests -v
```

前端没有独立打包步骤，主要依赖浏览器验证和接口联调。

新版 React 前端构建：

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run build
```

Gmail 最少验证：

1. 导入 `provider=google` 的库存账号
2. 列表显示“未授权”
3. 点击“绑定 Gmail”并完成 Google OAuth
4. 成功读取 `收件箱` 和 `垃圾邮件`

注意：

- Google OAuth consent screen 处于 Testing 状态时，refresh token 可能在 7 天后失效
- 这不是代码缺陷，而是 Google 测试模式限制

## 运行说明

仓库主要提供：

1. 本地运行方式
- 直接启动 Flask
- 旧版前端可由 Flask 托管
- 新版 React 前端可用 `npm run dev` 联调

2. 必要环境变量说明
- 数据库路径
- Google OAuth 配置
- 接口地址配置

具体服务器部署方式不在公开文档里展开，按你自己的环境处理即可。

## 进一步阅读

- [AI 接手说明](AGENTS.md)
- [架构说明](docs/architecture.md)
- [开发指南](docs/development.md)
- [运行说明](docs/deployment.md)
