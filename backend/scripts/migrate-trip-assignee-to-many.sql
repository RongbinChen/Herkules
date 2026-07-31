-- One-time data migration: Trip.assigneeId (single FK) -> Trip.assignees
-- (implicit many-to-many via "_TripAssignees").
--
-- `prisma db push` DROPS the old assigneeId column, so existing assignments
-- must be carried across by hand. Run the steps below IN ORDER, in psql,
-- against the production database:
--
--   cd ~/calendar-app && set -a && . ./.env && set +a && psql "$DATABASE_URL"
--
-- The backup lives in a CSV file on disk, not in a table inside the database.
-- An earlier draft parked it in an undeclared table and assumed `db push` would
-- leave it alone — but `db push` reconciles the whole database against
-- schema.prisma, so a table missing from the schema is exactly the kind of
-- thing it may drop. A file outside the database sidesteps the question.

-- ── STEP 0 — full backup first ─────────────────────────────────────────────
--   bash ~/calendar-app/scripts/backup-db.sh

-- ── STEP 1 — BEFORE `prisma db push` ───────────────────────────────────────
-- Export current assignments while Trip.assigneeId still exists.

\copy (SELECT id, "assigneeId" FROM "Trip" WHERE "assigneeId" IS NOT NULL) TO '/home/ubuntu/trip-assignees-backup.csv' CSV

-- Check the file before going further. If it is empty and you expected rows,
-- STOP and find out why:
--   \! wc -l /home/ubuntu/trip-assignees-backup.csv

-- ── STEP 2 — deploy the new code, then run ─────────────────────────────────
--   cd ~/calendar-app/backend && npx prisma db push --accept-data-loss
--
-- --accept-data-loss is required because dropping assigneeId destroys data.
-- Never put that flag on an automated path; this migration is a one-off.
--
-- db push drops Trip.assigneeId and creates the implicit join table
-- "_TripAssignees" with columns "A" (Trip.id) and "B" (User.id) — Prisma names
-- them alphabetically by model, and Trip < User.

-- ── STEP 3 — AFTER `prisma db push` succeeds ───────────────────────────────
-- Restore the assignments into the join table.

\copy "_TripAssignees" ("A", "B") FROM '/home/ubuntu/trip-assignees-backup.csv' CSV

-- ── STEP 4 — verify ────────────────────────────────────────────────────────
-- Every row exported in step 1 should come back here.

SELECT t.id AS trip_id, t.title, u.name AS assignee
  FROM "_TripAssignees" ta
  JOIN "Trip" t ON t.id = ta."A"
  JOIN "User" u ON u.id = ta."B"
 ORDER BY t.id;

-- Keep /home/ubuntu/trip-assignees-backup.csv. It is tiny, and it is the only
-- record of the pre-migration state outside the full pg_dump.
