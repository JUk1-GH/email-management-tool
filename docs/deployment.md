# 运行说明

这份文档只保留源码使用者需要的最小信息：

- 如何本地启动
- 需要哪些环境变量
- 如何验证功能是否正常

不再展开任何特定平台、供应商或个人服务器结构细节。

## 本地启动后端

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

默认访问地址：

```text
http://127.0.0.1:8788
```

## 本地联调新版前端

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run dev
```

## 常用环境变量

- `JEMAIL_DB_PATH`：SQLite 数据库文件路径
- `JEMAIL_SENSITIVE_KEY_PATH`：完整账号资料加密 key 文件路径
- `JEMAIL_AUTH_SESSION_TTL_DAYS`：登录会话有效天数
- `JEMAIL_LOGIN_MAX_FAILED_ATTEMPTS`：登录失败次数上限
- `JEMAIL_LOGIN_RATE_WINDOW_MINUTES`：登录失败统计窗口
- `JEMAIL_LOGIN_LOCKOUT_MINUTES`：触发限速后的锁定时间
- `JEMAIL_TURNSTILE_SITE_KEY`：Cloudflare Turnstile 前端 site key
- `JEMAIL_TURNSTILE_SECRET_KEY`：Cloudflare Turnstile 后端 secret key
- `JEMAIL_FRONTEND_DIR`：前端静态目录
- `JEMAIL_GOOGLE_CLIENT_ID`
- `JEMAIL_GOOGLE_CLIENT_SECRET`
- `JEMAIL_GOOGLE_REDIRECT_URI`
- `JEMAIL_GOOGLE_STATE_SECRET`
- `JEMAIL_CORS_ORIGIN`：如果前后端不在同一地址，可按需设置

## 本地验证

后端测试：

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
.venv/bin/python -m unittest discover -s tests -v
```

前端构建：

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
npm run build
```

健康检查：

```bash
curl http://127.0.0.1:8788/healthz
```

## 提示

- 如果只是作为个人邮箱管理工具使用，优先先跑通本地模式
- 如果要自行部署到服务器，请按自己的环境决定进程管理、反向代理、HTTPS 和域名配置
- 仓库提供了相关脚本目录，但不在公开文档里展开平台相关细节
