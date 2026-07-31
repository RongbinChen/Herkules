-- One-time data migration: Trip.assigneeId (single FK) -> Trip.assignees
-- (implicit many-to-many via "_TripAssignees").
--
-- Run in the three steps below, IN ORDER, around `npx prisma db push`.
-- Running out of order (esp. skipping step 1) will silently lose the
-- existing single-assignee data, since `db push` drops the old column.
--
-- ── STEP 1 — run BEFORE deploying / before `prisma db push` ────────────────
-- While Trip.assigneeId still exists, copy current assignments into a
-- throwaway table. This table is NOT declared in schema.prisma, so
-- `prisma db push` will not touch it.

CREATE TABLE _trip_assignee_backup AS
  SELECT id AS trip_id, "assigneeId" AS user_id
  FROM "Trip"
  WHERE "assigneeId" IS NOT NULL;

-- ── STEP 2 — deploy the new backend code, then run ──────────────────────────
--   cd backend && npx prisma db push
-- This drops Trip.assigneeId and creates the implicit join table
-- "_TripAssignees" with columns "A" (Trip.id) and "B" (User.id) — Prisma's
-- default naming for an implicit many-to-many, ordered alphabetically by
-- model name (Trip < User).

-- ── STEP 3 — run AFTER `prisma db push` succeeds ────────────────────────────
-- Backfill the join table from the backup, then drop the backup table.

INSERT INTO "_TripAssignees" ("A", "B")
  SELECT trip_id, user_id FROM _trip_assignee_backup
  ON CONFLICT DO NOTHING;

DROP TABLE _trip_assignee_backup;
