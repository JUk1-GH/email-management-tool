# jemail Contributor Guide

这份文件给新的 AI 代理或新接手开发者快速建立上下文。

## 先看什么

如果你刚进入仓库，优先按这个顺序理解项目：

1. `README.md`
2. `docs/architecture.md`
3. `docs/development.md`
4. `jemail-app/main.js`
5. `jemail-backend/backend/app.py`

## 当前项目边界

当前生产主线只有两部分：

- `jemail-app/`
- `jemail-backend/`

不要把下面这些当成当前生产代码：

- `outlook-manager/`：早期原型
- 根目录 `docker-compose.yml` 和 `.env.example`：早期 Nextcloud 尝试
- `server-backups/`：备份数据，不参与当前开发

## 一句话架构

这是一个“前端本地存账号，后端按需拉邮件”的系统：

- 账号和分组主要保存在浏览器 `IndexedDB`
- 后端不维护长期账号数据库
- 后端收到 `refresh_token` 后再去微软换 `access_token`
- 邮件读取主链是 `IMAP XOAUTH2`
- `Graph` 是兼容分支，不是当前主成功路径

## 代码地图

### 前端

- `jemail-app/index.html`
  - 页面骨架和本地 vendor 资源加载
- `jemail-app/main.js`
  - Vue 3 主逻辑
  - 账号导入、分组、批量复制、邮件读取、接口调用
- `jemail-app/db.js`
  - 浏览器 `IndexedDB` 封装
  - `accounts` 和 `emails` 两个 object store
- `jemail-app/config.js`
  - 运行时接口地址覆盖入口

### 后端

- `jemail-backend/backend/app.py`
  - Flask 入口
  - `POST /detect-permission`
  - `POST /api/emails/refresh`
  - 同源静态文件托管
- `jemail-backend/backend/microsoft.py`
  - 微软 refresh token 换 access token
  - Graph 探测和 Graph 拉信
- `jemail-backend/backend/mail.py`
  - IMAP XOAUTH2 登录和邮件提取
- `jemail-backend/backend/models.py`
  - 请求校验和返回结构
- `jemail-backend/backend/config.py`
  - 环境变量配置

## 核心数据流

### 账号导入

前端支持文本和 Excel 两种输入。

常见文本格式：

```text
邮箱地址----密码----Client ID----刷新令牌
```

账号导入后：

- 写入浏览器本地 `IndexedDB`
- 保持原始导入顺序
- 可加分组
- 不会自动同步到服务器文件

### 权限检测

前端调用：

```text
POST /detect-permission
```

入参只包含：

- `client_id`
- `refresh_token`

后端会：

1. 先换 access token
2. 探测 Graph 是否可用
3. 返回 `graph` / `imap` / `o2`

### 邮件刷新

前端调用：

```text
POST /api/emails/refresh
```

后端会：

1. 再次用 refresh token 换 access token
2. 按 `token_type` 决定优先策略
3. 优先尝试 `IMAP` 或 `Graph`
4. 必要时在两者之间回退
5. 返回统一邮件结构

## 改动时最容易踩的坑

### 1. 误以为账号在服务器端

不是。账号主数据默认在浏览器本地。

如果你改账号模型、导入格式或分组逻辑，要同步检查：

- `jemail-app/db.js`
- `jemail-app/main.js`

### 2. 误以为 Graph 是主链

不是。当前真实成功链路更偏 `IMAP XOAUTH2`。

如果你改：

- `backend/microsoft.py`
- `backend/mail.py`
- `backend/app.py`

要保证 `imap` 路径仍然稳定。

### 3. 误改接口形状

前端强依赖这两个接口：

- `POST /detect-permission`
- `POST /api/emails/refresh`

如果你改返回字段，要先同步前端。

### 4. 把遗留目录当现网

当前现网不是：

- `outlook-manager/`
- Nextcloud

而是 `jemail-app + jemail-backend`。

## 本地开发命令

后端启动：

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

测试：

```bash
cd /Volumes/SSD/Email\ Tool/jemail-backend
.venv/bin/python -m unittest discover -s tests -v
```

## 部署方式

仓库里当前主要保留两种说明：

- 本地部署
- 自行部署

## 提交前检查

1. 不要提交 `.env`、令牌、私钥、备份
2. 如果改后端接口，跑单测
3. 如果改前端接口调用，至少做一次真实浏览器联调
4. 如果改部署脚本，更新 `docs/deployment.md`
