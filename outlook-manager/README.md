# Outlook Manager

这是一个专门给这批 Outlook 邮箱做的轻量网页管理工具：

- 从账号清单批量导入
- 使用 `refresh_token` 动态换取 `access_token`
- 通过 IMAP `XOAUTH2` 读取邮件
- 支持多账号、文件夹、邮件列表和正文查看

## 环境变量

- `OUTLOOK_MANAGER_PASSWORD`：后台登录密码
- `OUTLOOK_MANAGER_SECRET`：Flask session secret
- `OUTLOOK_MANAGER_ACCOUNTS_FILE`：账号清单文件路径
- `OUTLOOK_IMAP_HOST`：默认 `outlook.office365.com`
- `OUTLOOK_IMAP_PORT`：默认 `993`

## 账号文件格式

每行一个账号，使用 `----` 分隔，共四段：

```text
email@example.com----password----client_id----refresh_token
```

## 本地运行

```bash
export OUTLOOK_MANAGER_PASSWORD=change-me
export OUTLOOK_MANAGER_SECRET=change-me-too
export OUTLOOK_MANAGER_ACCOUNTS_FILE=/path/to/accounts.txt
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```
