#!/usr/bin/env bash
#
# Daily PostgreSQL backup for calendar-app (Herkules CRM).
# - Dumps the DB in pg_dump custom format (-Fc): compressed + selective restore.
# - Reads DATABASE_URL from the app .env (no hardcoded password).
# - Retains backups for RETENTION_DAYS, prunes older ones.
# - Appends a line to backup.log for every run (success or failure).
#
# Restore a dump:
#   pg_restore --clean --if-exists -d "$DATABASE_URL" /home/ubuntu/db-backups/calendar_db-YYYYMMDD-HHMMSS.dump
#
set -euo pipefail

APP_DIR="/home/ubuntu/calendar-app"
BACKUP_DIR="/home/ubuntu/db-backups"
RETENTION_DAYS=30
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# Load DATABASE_URL from .env (everything after the first '=', quotes stripped).
DB_URL=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"')
if [ -z "${DB_URL:-}" ]; then
  log "ERROR: DATABASE_URL not found in $APP_DIR/.env"
  exit 1
fi

TS=$(date '+%Y%m%d-%H%M%S')
OUT="$BACKUP_DIR/calendar_db-$TS.dump"

if pg_dump "$DB_URL" -Fc -f "$OUT" 2>>"$LOG"; then
  SIZE=$(du -h "$OUT" | cut -f1)
  log "OK: $OUT ($SIZE)"
else
  log "ERROR: pg_dump failed for $OUT"
  rm -f "$OUT"
  exit 1
fi

# Prune dumps older than the retention window.
find "$BACKUP_DIR" -maxdepth 1 -name 'calendar_db-*.dump' -mtime "+$RETENTION_DAYS" -print -delete >> "$LOG" 2>&1 || true
