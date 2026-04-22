# 服务器部署说明

这套后端建议部署到一台 Ubuntu / Debian 服务器上。

## 推荐规格

- 系统：Ubuntu 22.04 LTS
- 机型：`t3.small` 或 `t3.medium`
- 磁盘：20GB 起
- 安全组：
  - `22/tcp`：你的管理 IP
  - `80/tcp`：公开
  - `443/tcp`：如果后面加 HTTPS，也公开

## 部署文件

- `provision-ubuntu-ec2.sh`：在 EC2 上安装 Python/nginx、写 systemd、启服务
- `push-to-ec2.sh`：从本地 rsync 代码到 EC2，再远程执行 provision
- `jemail-backend.service`：systemd 模板
- `nginx-api.conf`：nginx 反向代理模板

## 本地推送示例

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
npm run build

cd /Volumes/SSD/Email\ Tool/jemail-backend
bash deploy/push-to-ec2.sh /path/to/aws-key.pem ubuntu@your-ec2-ip api.example.com https://app.example.com
```

脚本会同时同步两部分内容：

- `jemail-backend/` -> `/opt/jemail-backend`
- `_figma_source/dist` -> `/opt/jemail-backend/frontend-dist`

部署后 Flask 会通过 `JEMAIL_FRONTEND_DIR=/opt/jemail-backend/frontend-dist` 同源托管新的 React 前端。

## 部署后检查

```bash
sudo systemctl status jemail-backend
curl http://127.0.0.1:8788/healthz
```

## 说明

这套脚本不负责创建 EC2 实例本身，只负责把现有代码部署到已经创建好的 Ubuntu EC2 上。
