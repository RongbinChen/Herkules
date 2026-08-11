#!/usr/bin/env bash
# Pull the VPS's irreplaceable bytes down to the DGX, once a day.
#
# Two things live only on the VPS and would go with it:
#
#   1. /home/ubuntu/contract-files — uploaded contracts. scripts/backup-db.sh
#      dumps the database, which holds only the filename and metadata; the bytes
#      themselves have never been backed up anywhere.
#   2. /home/ubuntu/db-backups — the database dumps. They sit on the same disk as
#      the database they protect, and get pruned after RETENTION_DAYS. A backup
#      that dies with the thing it backs up is a copy, not a backup.
#
# Both are pulled, and pulling both is the point: contract files are stored under
# generated UUID names, so without the database that maps them back to a customer
# and an original filename, the directory is a pile of anonymous blobs.
#
# Direction is DGX → VPS, outbound only, over the SSH key that is already here.
# No new endpoint, and in particular nothing that would let a machine token read
# contract bytes — those stay behind the team PIN, which is the whole design.
#
# Usage:  bash backend/scripts/dgx-backup.sh
set -euo pipefail

VPS_HOST="${VPS_HOST:-ubuntu@35.76.38.203}"
SSH_KEY="${VPS_SSH_KEY:-/home/henner/calendar/LightsailDefaultKey-ap-northeast-1.pem}"
DEST="${BACKUP_DEST:-/home/henner/calendar/vps-backups}"

log() { echo "$(date '+%H:%M:%S') $*"; }
die() { echo "$(date '+%H:%M:%S') ✗ $*" >&2; exit 1; }

[ -f "$SSH_KEY" ] || die "找不到 SSH 私钥: $SSH_KEY"
mkdir -p "$DEST/contract-files" "$DEST/db-backups"

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes"

# Fail before copying rather than half-way through it.
$SSH_CMD "$VPS_HOST" true 2>/dev/null || die "连不上 VPS ($VPS_HOST)，本次备份中止"

# --- Contract files -----------------------------------------------------------
# No --delete, deliberately. If a contract is removed on the VPS — by mistake, by
# a disgruntled leaver, by a bug — the copy here has to survive it. A mirror that
# faithfully reproduces a deletion protects against disk failure and nothing else.
log "拉取合同文件…"
rsync -az --info=stats2 -e "$SSH_CMD" \
  "$VPS_HOST:/home/ubuntu/contract-files/" "$DEST/contract-files/" \
  | grep -E 'Number of (regular files transferred|files:)|Total transferred' || true

# --- Database dumps -----------------------------------------------------------
# Also no --delete: the VPS prunes after 30 days, and letting this copy keep the
# older ones is free off-site retention.
log "拉取数据库快照…"
rsync -az --info=stats2 -e "$SSH_CMD" \
  "$VPS_HOST:/home/ubuntu/db-backups/" "$DEST/db-backups/" \
  | grep -E 'Number of (regular files transferred|files:)|Total transferred' || true

# --- Report -------------------------------------------------------------------
FILES=$(find "$DEST/contract-files" -type f | wc -l)
DUMPS=$(find "$DEST/db-backups" -name '*.dump' | wc -l)
NEWEST=$(find "$DEST/db-backups" -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
SIZE=$(du -sh "$DEST" | cut -f1)

log "本地已存: 合同文件 $FILES 个, 数据库快照 $DUMPS 份, 合计 $SIZE"
[ -n "$NEWEST" ] && log "最新快照: $(basename "$NEWEST")"

# A dump older than two days means backup-db.sh has been failing on the VPS and
# nobody noticed — worth surfacing here, since this script is the one thing that
# looks at those files from outside.
if [ -n "$NEWEST" ] && [ -n "$(find "$NEWEST" -mtime +2)" ]; then
  log "⚠️  最新的数据库快照已超过 2 天，VPS 上的 backup-db.sh 可能没在跑"
  exit 1
fi

log "备份完成"
