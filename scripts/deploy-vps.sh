#!/usr/bin/env bash
#
# 生产部署脚本 — 在 VPS 上执行
# ---------------------------------------------------------------------------
# 由 GitHub Actions (.github/workflows/deploy.yml) 通过 ssh 调用，也可以手工跑:
#
#   ssh ubuntu@35.76.38.203 'bash ~/calendar-app/scripts/deploy-vps.sh'
#
# 线上架构不是 Docker(docker-compose.yml 只用于本地开发沙盒):
#   - 前端: vite build 产物拷到 WEBROOT, 由系统 Nginx 直接发布
#   - 后端: pm2 托管 node backend/src/index.js, Nginx 反代 /api/ 到 127.0.0.1:3001
#   - 数据库: 系统 PostgreSQL 16 (unix socket)
#
# 设计约束:
#   1. 全程不删除任何东西。前端产物文件名带 hash, 新旧共存, 回滚只需换回旧
#      index.html —— 它引用的旧 assets 仍在原地。
#   2. schema.prisma 有变更时直接中止。本项目没有 migration 文件(用 db push),
#      自动跑 schema 同步有丢生产数据的风险, 必须人工处理。
#   3. 有抓取任务正在跑时中止。部署会 pm2 reload, 会把跑到一半的抓取打断
#      (日报任务北京时间 06:00-09:00, 要跑约 3 小时)。急着上线时用
#      SKIP_SCRAPE_CHECK=1 跳过。
#   4. 任何一步失败自动回滚到部署前的 commit 和 index.html。
#
set -euo pipefail

APP_DIR="/home/ubuntu/calendar-app"
WEBROOT="/var/www/herkulesgroup"
BACKUP_DIR="/home/ubuntu/deploy-backups"
PM2_APP="calendar-backend"
HEALTH_URL="http://127.0.0.1:3001/api/health"
TARGET_REF="${1:-origin/main}"
SKIP_SCRAPE_CHECK="${SKIP_SCRAPE_CHECK:-0}"

# 与 backend/src/index.js 的僵尸任务清理保持一致: 超过这个时长的 RUNNING 行
# 视为上次重启留下的孤儿, 不该再挡住部署。
SCRAPE_STALE_HOURS=4

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗  %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "找不到 $APP_DIR"

# --------------------------------------------------------------------------
# 0. 前置检查
# --------------------------------------------------------------------------
log "[0/9] 前置检查"

if [ -n "$(git status --porcelain)" ]; then
  git status --short
  die "工作区有未提交的改动。VPS 上可能有人正在开发, 先处理干净再部署。"
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || die "当前在 $CURRENT_BRANCH 分支, 只在 main 上部署。"

git fetch --quiet origin main

OLD_SHA="$(git rev-parse HEAD)"
NEW_SHA="$(git rev-parse "$TARGET_REF")"
echo "    当前: ${OLD_SHA:0:7}  $(git log -1 --format=%s "$OLD_SHA")"
echo "    目标: ${NEW_SHA:0:7}  $(git log -1 --format=%s "$NEW_SHA")"

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  warn "代码无变更, 仍会重新构建并重启(手动重跑部署时这是预期行为)。"
fi

# --------------------------------------------------------------------------
# 1. 数据库 schema 守门
# --------------------------------------------------------------------------
log "[1/9] 检查数据库 schema 是否变更"

if ! git diff --quiet "$OLD_SHA" "$NEW_SHA" -- backend/prisma/schema.prisma; then
  echo
  git diff --stat "$OLD_SHA" "$NEW_SHA" -- backend/prisma/schema.prisma
  echo
  die "backend/prisma/schema.prisma 有变更, 已中止部署。
    本项目没有 migration 文件, schema 同步靠 'prisma db push', 自动执行可能丢数据。
    请先 ssh 上来人工确认并处理:
      1. 备份: bash $APP_DIR/scripts/backup-db.sh
      2. 看清 diff: git diff $OLD_SHA $NEW_SHA -- backend/prisma/schema.prisma
      3. 手工同步(确认不会丢数据后): cd backend && npx prisma db push
      4. 再重跑本脚本"
fi
echo "    schema.prisma 无变更 ✓"

# --------------------------------------------------------------------------
# 2. 抓取任务守门
# --------------------------------------------------------------------------
# 部署最后会 pm2 reload, 抓取是在后端进程里跑的, 一重启就断。日报任务约 3 小时
# (北京时间 06:00-09:00, 即前一天 22:00 至当天 01:00 UTC), 这个窗口里部署会白白
# 废掉一整天的抓取。
log "[2/9] 检查是否有抓取任务在跑"

if [ "$SKIP_SCRAPE_CHECK" = "1" ]; then
  warn "SKIP_SCRAPE_CHECK=1, 跳过检查(正在跑的抓取任务会被打断)"
else
  # 读 .env 只为拿 DATABASE_URL; 用子 shell 隔离, 不污染部署脚本自身的环境。
  RUNNING_JOBS="$(
    (
      set -a; . "$APP_DIR/.env"; set +a
      psql "$DATABASE_URL" -tAc \
        "SELECT count(*) FROM \"ScrapeJob\"
          WHERE status = 'RUNNING'
            AND \"startedAt\" > now() - interval '$SCRAPE_STALE_HOURS hours';"
    ) 2>/dev/null | tr -d '[:space:]'
  )"

  if ! [[ "$RUNNING_JOBS" =~ ^[0-9]+$ ]]; then
    # 查不到就放行 —— 这道闸是排期卫生, 不是数据安全(那是第 1 步的职责),
    # 不该因为 psql 连不上就把所有部署都堵死。
    warn "无法查询 ScrapeJob 状态, 跳过本项检查"
  elif [ "$RUNNING_JOBS" -gt 0 ]; then
    echo
    (
      set -a; . "$APP_DIR/.env"; set +a
      psql "$DATABASE_URL" -c \
        "SELECT id, \"triggeredBy\", \"startedAt\"
           FROM \"ScrapeJob\"
          WHERE status = 'RUNNING'
            AND \"startedAt\" > now() - interval '$SCRAPE_STALE_HOURS hours'
          ORDER BY \"startedAt\";" 2>/dev/null
    ) || true
    die "有 $RUNNING_JOBS 个抓取任务正在跑, 已中止部署。
    部署会 pm2 reload, 跑到一半的抓取会被打断, 当天的数据就白抓了。
    日报任务每天北京时间 06:00 启动, 约 3 小时跑完(22:00-01:00 UTC)。
    可选做法:
      1. 等它跑完, 再到 Actions 页面点 'Run workflow' 重跑部署(推荐)
      2. 确实要立刻上线, 二选一:
         - Actions 页面手动触发, 把 skip_scrape_check 勾成 true
         - ssh 上来跑: SKIP_SCRAPE_CHECK=1 bash $APP_DIR/scripts/deploy-vps.sh $TARGET_REF"
  else
    echo "    没有进行中的抓取任务 ✓"
  fi
fi

# --------------------------------------------------------------------------
# 3. 拉取代码
# --------------------------------------------------------------------------
log "[3/9] 拉取代码"
git merge --ff-only "$NEW_SHA"

# 失败后回滚到部署前状态
ROLLBACK_INDEX=""
rollback() {
  warn "部署失败, 正在回滚 ..."
  git -C "$APP_DIR" reset --hard "$OLD_SHA" >/dev/null 2>&1 || true
  if [ -n "$ROLLBACK_INDEX" ] && [ -f "$ROLLBACK_INDEX" ]; then
    sudo cp "$ROLLBACK_INDEX" "$WEBROOT/index.html"
    sudo chown www-data:www-data "$WEBROOT/index.html"
    echo "    已还原 index.html (旧 assets 未被删除, 页面可正常工作)"
  fi
  pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 || true
  die "已回滚到 ${OLD_SHA:0:7}"
}
trap rollback ERR

# --------------------------------------------------------------------------
# 4. 依赖
# --------------------------------------------------------------------------
log "[4/9] 同步依赖"

for pkg in backend frontend; do
  if ! git diff --quiet "$OLD_SHA" "$NEW_SHA" -- "$pkg/package-lock.json" "$pkg/package.json"; then
    echo "    $pkg: 依赖有变更, 执行 npm ci"
    (cd "$pkg" && npm ci --no-audit --no-fund)
  else
    echo "    $pkg: 依赖无变更, 跳过"
  fi
done

# --------------------------------------------------------------------------
# 5. Prisma client
# --------------------------------------------------------------------------
log "[5/9] 生成 Prisma client"
(cd backend && npx prisma generate >/dev/null)
echo "    完成 ✓"

# --------------------------------------------------------------------------
# 6. 构建前端
# --------------------------------------------------------------------------
log "[6/9] 构建前端 (vite build)"
(cd frontend && npm run build)
[ -f frontend/dist/index.html ] || die "构建失败: 未找到 frontend/dist/index.html"

# --------------------------------------------------------------------------
# 7. 备份当前线上产物
# --------------------------------------------------------------------------
log "[7/9] 备份当前线上 index.html"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ROLLBACK_INDEX="$BACKUP_DIR/index-${STAMP}-${OLD_SHA:0:7}.html"
cp "$WEBROOT/index.html" "$ROLLBACK_INDEX"
echo "    $ROLLBACK_INDEX"

# --------------------------------------------------------------------------
# 8. 发布前端
# --------------------------------------------------------------------------
log "[8/9] 发布前端到 $WEBROOT"
# 只做增量拷贝: 新产物文件名带 hash, 不会覆盖旧文件, 也不删除任何东西。
# 旧 assets 保留是有意为之 —— 回滚时旧 index.html 依然能加载到它引用的资源。
sudo cp -r frontend/dist/assets/. "$WEBROOT/assets/"
sudo cp frontend/dist/index.html "$WEBROOT/index.html"
sudo chown -R www-data:www-data "$WEBROOT/assets" "$WEBROOT/index.html"
echo "    index.html 引用:"
grep -oE 'assets/[^"]+' "$WEBROOT/index.html" | sed 's/^/      /'

# --------------------------------------------------------------------------
# 9. 重启后端 + 健康检查
# --------------------------------------------------------------------------
log "[9/9] 重启后端并健康检查"
pm2 reload "$PM2_APP" --update-env

for i in $(seq 1 15); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "    健康检查通过 ✓ ($(curl -fsS "$HEALTH_URL"))"
    break
  fi
  [ "$i" -eq 15 ] && die "健康检查失败: $HEALTH_URL 15 秒内没有返回 200"
  sleep 1
done

trap - ERR

echo
printf '\033[1;32m✓ 部署完成\033[0m  %s → %s\n' "${OLD_SHA:0:7}" "${NEW_SHA:0:7}"
echo "  https://www.herkulesgroup-china.com  (浏览器硬刷新 Ctrl/Cmd+Shift+R)"
echo "  回滚用的旧 index.html: $ROLLBACK_INDEX"
