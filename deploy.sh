#!/usr/bin/env bash
#
# 前端构建 + 部署脚本
# ---------------------------------------------------------------------------
# 本项目线上前端由系统 Nginx 直接发布静态文件目录 WEBROOT(不是 Vite dev
# server,5000 端口的 dev server 未被使用)。改完前端代码后必须重新构建并把产物
# 拷到 WEBROOT 才会在 www.herkulesgroup-china.com 生效。
#
# 用法:
#   ./deploy.sh          # 构建前端并部署
#
set -euo pipefail

FRONTEND_DIR="/home/ubuntu/calendar-app/frontend"
WEBROOT="/var/www/herkulesgroup"
DIST="$FRONTEND_DIR/dist"

echo "==> [1/3] 构建前端 (vite build)"
cd "$FRONTEND_DIR"
npm run build

if [ ! -f "$DIST/index.html" ]; then
  echo "✗ 构建失败:未找到 $DIST/index.html" >&2
  exit 1
fi

echo "==> [2/3] 部署到 $WEBROOT (替换 assets + index.html,保留 brand 等其它目录)"
sudo rm -rf "$WEBROOT/assets"
sudo cp -r "$DIST/assets" "$WEBROOT/assets"
sudo cp "$DIST/index.html" "$WEBROOT/index.html"
sudo chown -R www-data:www-data "$WEBROOT/assets" "$WEBROOT/index.html"

echo "==> [3/3] 校验线上引用"
echo "    index.html 引用:"
grep -oE 'assets/[^"]+' "$WEBROOT/index.html" | sed 's/^/      /'

echo
echo "✓ 部署完成。浏览器请硬刷新 (Ctrl/Cmd+Shift+R) 后查看。"
