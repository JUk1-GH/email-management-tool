# 部署与运维

## 部署方式

仓库内当前只保留两种常规部署方式说明：

1. 本地部署
2. 服务器部署

第一阶段数据库使用 SQLite，默认建议放在独立数据目录而不是代码目录。

## 本地部署

适合开发、联调和个人自用。

### 启动后端

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

### 启动新版前端

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run dev
```

## 服务器部署

适合一台 Linux 服务器同时托管前端和后端：

- `nginx` 负责对外 `80/443`
- `gunicorn` 负责运行 Flask
- Flask 同时托管新前端和 API
- SQLite 与加密 key 保存在独立数据目录

## 进程关系

```text
Browser
  -> nginx :80/:443
  -> gunicorn 127.0.0.1:8788
  -> Flask app
  -> SQLite (/var/lib/jemail/jemail.sqlite3)
  -> Fernet key (/var/lib/jemail/jemail_sensitive_fernet.key)
  -> Microsoft token endpoint / Outlook IMAP
```

## 服务器部署脚本

仓库内已经有现成部署材料：

- `jemail-backend/deploy/provision-ubuntu-ec2.sh`
- `jemail-backend/deploy/push-to-ec2.sh`
- `jemail-backend/deploy/jemail-backend.service`
- `jemail-backend/deploy/nginx-api.conf`

### 典型部署方式

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
npm run build

cd /Volumes/SSD/Email\ Tool/jemail-backend
bash deploy/push-to-ec2.sh /path/to/key.pem ubuntu@your-ec2-ip api.example.com https://app.example.com
```

当前 `push-to-ec2.sh` 会同时同步两部分内容：

- `jemail-backend/` 到远端 `/opt/jemail-backend`
- `_figma_source/dist` 到远端 `/opt/jemail-backend/frontend-dist`

服务器上的 Flask 会通过 `JEMAIL_FRONTEND_DIR=/opt/jemail-backend/frontend-dist` 同源托管新前端。

第一阶段额外约定：

- SQLite 数据库默认放在 `/var/lib/jemail/jemail.sqlite3`
- 完整凭据加密 key 默认放在 `/var/lib/jemail/jemail_sensitive_fernet.key`
- 部署脚本会保留远端 `.env`
- 部署脚本不会把数据库文件或加密 key 放进会被 `rsync --delete` 覆盖的代码目录

建议至少配置这些环境变量：

- `JEMAIL_DB_PATH=/var/lib/jemail/jemail.sqlite3`
- `JEMAIL_SENSITIVE_KEY_PATH=/var/lib/jemail/jemail_sensitive_fernet.key`
- `JEMAIL_AUTH_SESSION_TTL_DAYS=30`
- `JEMAIL_FRONTEND_DIR=/opt/jemail-backend/frontend-dist`

如果要上线 Gmail OAuth，还需要在服务器环境变量中配置：

- `JEMAIL_GOOGLE_CLIENT_ID`
- `JEMAIL_GOOGLE_CLIENT_SECRET`
- `JEMAIL_GOOGLE_REDIRECT_URI`
- `JEMAIL_GOOGLE_STATE_SECRET`

其中 `JEMAIL_GOOGLE_REDIRECT_URI` 必须和 Google Cloud Console 里的 OAuth Client redirect URI 完全一致。

## 服务器上需要关注的点

### systemd

服务名：

```text
jemail-backend.service
```

常用命令：

```bash
sudo systemctl status jemail-backend
sudo systemctl restart jemail-backend
sudo journalctl -u jemail-backend -n 200 --no-pager
```

### nginx

常用命令：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 健康检查

```bash
curl http://127.0.0.1:8788/healthz
```

第一阶段登录 / 同步可额外验证：

```bash
curl -X POST http://127.0.0.1:8788/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops-check@example.com","password":"password-123"}'
```

完整账号资料可额外验证：

1. 登录后调用 `/api/cloud/secrets/sync`
2. 确认 `/api/cloud/accounts` 不返回 `password`、`refresh_token`、`twofa_secret`
3. 调用 `/api/cloud/secrets/unlock` 时必须带 Bearer 登录态
4. 检查 `/var/lib/jemail/jemail_sensitive_fernet.key` 存在且不在代码目录

## HTTPS

如果服务器需要对外提供 HTTPS，建议至少恢复这几件事：

1. `80/443` 安全组放行
2. nginx 站点包含目标域名
3. `certbot` 重新签发证书
4. 确认外部域名能够正常返回 `200`

## 故障排查顺序

### 页面能开，但拉不到邮件

先查：

1. `/healthz`
2. 浏览器网络面板里的 `/detect-permission`
3. 浏览器网络面板里的 `/api/emails/refresh`
4. `journalctl -u jemail-backend`

如果是 Gmail 账号，再补查：

5. Google Cloud Console 是否已启用 Gmail API
6. OAuth consent screen 是否还是 Testing，测试账号是否已加入
7. redirect URI 是否与当前部署域名完全一致
8. refresh token 是否已因 Google Testing 模式在 7 天后失效

### 登录或云同步异常

优先查：

1. `/healthz` 里的 `db_path` 是否正确
2. 服务器上的 `JEMAIL_DB_PATH` 指向的目录是否可写
3. `/api/auth/login` 或 `/api/cloud/accounts` 的返回码
4. `journalctl -u jemail-backend`
5. 是否误把密码、refresh token 等敏感字段发到了 `/api/cloud/accounts/sync`
6. 如果是完整凭据功能，确认 `JEMAIL_SENSITIVE_KEY_PATH` 指向的 key 文件存在且服务用户可读

### Cloudflare 报 521

优先查：

1. 服务器是否监听 `443`
2. nginx 是否加载了 SSL 配置
3. EC2 安全组是否开放 `443`
4. 证书是否成功部署

### 页面数据突然没了

优先想浏览器本地存储，而不是服务器数据库。

因为账号和缓存邮件默认在浏览器 `IndexedDB`。

如果是“登录后列表没了”，再补查：

1. 是否只是换了浏览器导致本地敏感资料不在了
2. 当前设备是否只拉回了部分账号资料
3. 云端同步前是否真的执行过同步
4. 是否已经在设置页“完整账号资料”里执行过手动补拉
