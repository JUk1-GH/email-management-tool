# 开发指南

## 适合谁看

这份文档面向两类人：

- 继续开发这个项目的人
- 需要快速接手的 AI 代理

## 本地启动

### 后端

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

默认地址：

```text
http://127.0.0.1:8788
```

### 前端

默认不需要额外启动 dev server。

因为 Flask 会把 `jemail-app/` 作为静态目录一起托管，所以直接访问：

```text
http://127.0.0.1:8788
```

如果你一定要独立起静态站点，也可以用任意静态文件服务器，但要确认：

- `jemail-app/config.js` 的 `API_BASE`
- 后端的 `JEMAIL_CORS_ORIGIN`

当前实际本地联调推荐前端是 `_figma_source/`：

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run dev
```

云端同步建议联调顺序：

1. 未登录状态验证本地导入、分组、邮件读取仍正常
2. 注册或登录一个测试用户
3. 执行“同步上云”
4. 清空当前浏览器站点数据或换一个浏览器
5. 登录同一用户并执行“拉取云端”
6. 确认账号普通资料被恢复，但敏感凭据没有自动回填
7. 在设置页“完整账号资料”执行“加密同步本机完整资料”或“拉取并显示完整资料”
8. 确认完整凭据进入当前浏览器 IndexedDB，列表和导出都能看到

## 环境变量

推荐在 `jemail-backend/.env` 中配置：

- `JEMAIL_CORS_ORIGIN`
- `JEMAIL_MAIL_FETCH_LIMIT`
- `PORT`
- `JEMAIL_FRONTEND_DIR`
- `JEMAIL_DB_PATH`
- `JEMAIL_SENSITIVE_KEY_PATH`
- `JEMAIL_AUTH_SESSION_TTL_DAYS`
- `JEMAIL_IMAP_TIMEOUT`
- `JEMAIL_HTTP_TIMEOUT`
- `JEMAIL_GOOGLE_CLIENT_ID`
- `JEMAIL_GOOGLE_CLIENT_SECRET`
- `JEMAIL_GOOGLE_REDIRECT_URI`
- `JEMAIL_GOOGLE_STATE_SECRET`

完整示例见：

- `jemail-backend/.env.example`

## 常见开发入口

### 改前端样式或交互

优先看：

- `_figma_source/src/app/App.tsx`
- `_figma_source/src/components/`
- `_figma_source/src/stores/`

### 改账号导入、分组、本地存储

优先看：

- `_figma_source/src/lib/db.ts`
- `_figma_source/src/stores/account-store.ts`
- `_figma_source/src/components/dialogs/ImportDialog.tsx`

### 改登录系统或云同步

优先看：

- `_figma_source/src/stores/auth-store.ts`
- `_figma_source/src/components/auth/AuthPanel.tsx`
- `jemail-backend/backend/db.py`
- `jemail-backend/backend/app.py`

### 改权限检测或邮件拉取

优先看：

- `jemail-backend/backend/app.py`
- `jemail-backend/backend/google.py`
- `jemail-backend/backend/microsoft.py`
- `jemail-backend/backend/mail.py`
- `jemail-backend/backend/models.py`

## 测试

### 后端单测

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
.venv/bin/python -m unittest discover -s tests -v
```

### 手工联调

建议最少验证下面几条：

1. 页面能打开
2. 文本导入账号成功
3. 注册 / 登录成功
4. “同步上云”成功
5. “拉取云端”成功
6. `POST /detect-permission` 返回成功
7. `POST /api/emails/refresh` 能拿到邮件
8. `inbox` 和 `junkemail` 两个文件夹至少验证一个

如果你改了 Gmail 相关逻辑，再补这几条：

1. Google Cloud Console 已启用 Gmail API
2. OAuth consent screen 已配置，测试账号已加入 Test Users
3. `JEMAIL_GOOGLE_REDIRECT_URI` 与 Google OAuth Client 配置完全一致
4. `provider=google` 且无 token 的账号显示“未授权”
5. 点击“绑定 Gmail”后能成功回写 refresh token
6. Gmail `收件箱` 和 `垃圾邮件` 都能打开

注意：

- Google OAuth Testing 模式下 refresh token 可能 7 天后失效
- 这是 Google 的测试模式限制，不是代码自动续期失败

## 改动原则

### 保持接口兼容

前端直接依赖两个接口：

- `/detect-permission`
- `/api/emails/refresh`

如果你要改返回结构，必须同步前端。

### 不要把账号主数据改成“默认存服务器”

当前产品心智是：

- 账号清单默认在浏览器本地
- 后端普通同步只负责“用户登录 + 普通资料同步”
- 高敏感凭据如果要上云，必须走 `cloud_account_secrets` 加密表
- `/api/cloud/accounts` 和 `/api/cloud/accounts/sync` 仍然不能接受或返回敏感字段

如果要引入服务端持久化，属于产品级变化，不能当普通重构处理。

### 不要误删 vendor 资源

`jemail-app/libs/` 下的文件现在是前端运行必需品。

## 推荐工作流

1. 先确认要改的是当前主线目录，不是遗留目录
2. 改动后跑后端单测
3. 用真实浏览器做一轮手工联调
4. 如果改了部署、域名或运行方式，同步更新文档
