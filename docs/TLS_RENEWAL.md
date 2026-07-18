# TLS 证书续期运维手册

**域名**: www.herkulesgroup-china.com
**证书**: Let's Encrypt (ECDSA)，90 天有效期
**修复日期**: 2026-07-17

## 现状（修复后）

- **认证方式**: `webroot`（HTTP-01 挑战，不抢占端口）
- **webroot 路径**: `/var/www/acme`
- **nginx 证书来源**: 直接指向 `/etc/letsencrypt/live/www.herkulesgroup-china.com/`（**不再用拷贝**）
- **续期后 hook**: `renew_hook = systemctl reload nginx`
- **自动续期**: `certbot.timer`（systemd，每天两次）
- **配置文件**: `/etc/letsencrypt/renewal/www.herkulesgroup-china.com.conf`

## 之前为什么会失败（Docker 残留）

现网是**裸 PM2 + systemd nginx**，但续期配置还是旧 Docker 时代的：

1. `pre_hook = docker stop calendar-proxy` → docker 未运行，续期第一步就报错
2. `authenticator = standalone` → 需独占 80 端口，但被 systemd nginx 占用 → `Could not bind TCP port 80`
3. `deploy-hook = renew-hook.sh` → 把证书拷到 `proxy/certs/`（Docker 路径，**错的**，nginx 实际读 `/etc/nginx/certs/`）并 `docker-compose restart proxy`（必失败）

结果：8/4 到期时续期必然失败 → 网站宕机。

## 修复做了什么

1. nginx `sites-enabled/herkulesgroup`：
   - 80 端口 server 增加 `location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }`（在 301 重定向之前）
   - 443 端口 `ssl_certificate` / `ssl_certificate_key` 改为直接指向 `/etc/letsencrypt/live/...`（消除易碎的拷贝环节）
2. renewal.conf：`authenticator = webroot` + `webroot_map` + `renew_hook = systemctl reload nginx`，删除所有 docker hooks 与 standalone。
3. 建立 `/var/www/acme/.well-known/acme-challenge/` 目录（root:root 755）。

## 验证命令

```bash
# 干跑续期（走 staging，不消耗真证书/限额）
sudo certbot renew --dry-run --no-random-sleep-on-renew

# 手动真实续期（未到期会跳过；加 --force-renewal 强制，注意每周限 5 次/域名）
sudo certbot renew --no-random-sleep-on-renew

# 看当前对外服务的证书有效期
echo | openssl s_client -connect www.herkulesgroup-china.com:443 \
  -servername www.herkulesgroup-china.com 2>/dev/null | openssl x509 -noout -dates

# 看自动续期 timer
systemctl list-timers certbot.timer --no-pager
```

## 遗留（无害，未删除）

- `renew-hook.sh`、`proxy/certs/`、`/etc/nginx/certs/*.pem`：旧 Docker 拷贝方案的产物，现已不被引用。保留不影响运行（遵循"整理时不删除文件"约定）。
- 备份：本次修改前的原配置备份在 `/home/ubuntu/tls-fix-backup-20260717-060445/`
  （renewal.conf / nginx site / renew-hook.sh 各一份）。

## 关键提醒

- **不要**再把 `authenticator` 改回 `standalone`（会和 systemd nginx 抢 80 端口）。
- `renew_hook` 键名必须是 `renew_hook`（不是 `deploy_hook`）——certbot 真实续期时会重写 conf 并丢弃无法识别的键。
- `/var/www/acme` 目录必须保留且 nginx 可读，否则续期挑战会 404。
