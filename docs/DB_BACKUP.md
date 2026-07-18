# 数据库备份运维手册

**建立日期**: 2026-07-17（架构审查 P1：此前无任何 DB 备份）

## 现状

- **数据库**: PostgreSQL 16（systemd 集群 `16/main`），监听 `127.0.0.1:5433`，库名 `calendar_db`。
- **备份脚本**: `/home/ubuntu/calendar-app/scripts/backup-db.sh`（在 repo 内）
- **备份存放**: `/home/ubuntu/db-backups/`（**在 repo 外**，不入 git）
- **格式**: `pg_dump -Fc`（自定义格式，压缩，支持选择性恢复）
- **保留**: 30 天，脚本自动 prune 更早的
- **日志**: `/home/ubuntu/db-backups/backup.log`（每次运行追加一行）
- **定时**: ubuntu 用户 crontab，`30 18 * * *`（18:30 UTC = **北京 02:30**）每日一次

脚本从 `.env` 的 `DATABASE_URL` 读取连接信息（不硬编码密码）。

## 手动备份

```bash
/home/ubuntu/calendar-app/scripts/backup-db.sh
tail /home/ubuntu/db-backups/backup.log
```

## 恢复

```bash
# 连接串（从 .env 取）
DB_URL=$(grep '^DATABASE_URL=' /home/ubuntu/calendar-app/.env | cut -d= -f2- | tr -d '"')

# 就地恢复（清空同名对象后导入，谨慎！）
pg_restore --clean --if-exists -d "$DB_URL" /home/ubuntu/db-backups/calendar_db-YYYYMMDD-HHMMSS.dump

# 或恢复到临时库先验证（推荐）
psql "${DB_URL%/*}/postgres" -c "CREATE DATABASE calendar_db_verify;"
pg_restore -d "${DB_URL%/*}/calendar_db_verify" <dump>
# 核对后：psql "${DB_URL%/*}/postgres" -c "DROP DATABASE calendar_db_verify;"
```

## 验证记录（建立时）

首次备份 173K；恢复到临时库 `calendar_db_restoretest` 后 `User=7`、表数=14 与原库一致；临时库已清理。备份确认可用。

## 注意 / 后续可选增强

- 备份目前**只在本机**。磁盘/机器损坏会同时丢库和备份。建议后续加**异地/对象存储**同步（rclone → S3/OSS 等）。
- 未加备份成功/失败的告警。可后续在脚本失败分支接入邮件/webhook 通知。
- crontab 曾在配置时被误清空并已完整恢复；如需再改，用 `crontab -l > f; 编辑 f; crontab f`，勿用可能报错的管道直接 `| crontab -`。
