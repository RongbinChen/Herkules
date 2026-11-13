// Who may delete a visit report.
//
// Read visibility is unchanged: every authenticated user can read every report.
// Delete is narrower, and it is decided here so the route, the list flag, and
// the tests cannot drift apart.
//
// | Actor | Read | Delete |
// | the credited author (authorId — the account that created the report, or the unique "From" person on an import) | yes | yes |
// | admin | yes | yes |
// | any other authenticated user (coordinator, dispatcher, engineer who did not upload it) | yes | no → 403 |
// | missing row, or an id the reader cannot see | no | 404 |
//
// Herkules has no coordinator/dispatcher/engineer role column. Those jobs are
// ordinary non-admin accounts; `isAdmin !== true` is what keeps them out.
import path from 'path';

export const DELETE_FORBIDDEN = 'Only the uploader or an admin can delete this report';
export const NOT_FOUND = 'Not found';

export function visitReportAuthorId(report) {
  if (!report || typeof report !== 'object') return null;
  if (Number.isInteger(report.authorId)) return report.authorId;
  if (Number.isInteger(report.author?.id)) return report.author.id;
  return null;
}

// Uploader (the credited author) or an admin. `isAdmin` must be boolean true —
// a truthy string or a role name never grants delete.
export function canDeleteVisitReport(report, user) {
  if (!report || !user) return false;
  if (user.isAdmin === true) return true;
  const authorId = visitReportAuthorId(report);
  return authorId != null && authorId === user.userId;
}

// 404 when the row is missing (the same lookup the read routes use, so a report
// you cannot see is indistinguishable from one that does not exist).
// 403 when the row is readable but this user may not delete it.
export function deleteAccess(report, user) {
  if (!report) return { ok: false, status: 404, error: NOT_FOUND };
  if (!canDeleteVisitReport(report, user)) {
    return { ok: false, status: 403, error: DELETE_FORBIDDEN };
  }
  return { ok: true, status: 204 };
}

export function withCanDelete(report, user) {
  return { ...report, canDelete: canDeleteVisitReport(report, user) };
}

// Route ids are positive integers. Anything else is "not found" — never a 500
// from Prisma receiving NaN, and never a hint that the id was merely forbidden.
export function parseReportId(raw) {
  const s = String(raw ?? '').trim();
  if (!/^[1-9]\d*$/.test(s)) return null;
  const id = Number(s);
  return Number.isSafeInteger(id) ? id : null;
}

// Attachment JSON is metadata. Image rows also name a blob via `storedName`:
// one path segment under VISIT_REPORT_STORAGE_DIR (see visitReportPhotos).
// Anything else (no root, no storedName, a path with a slash or `..`) is
// ignored so delete cannot be pointed at an arbitrary file.
export function storedAttachmentTargets(attachments, storageRoot) {
  if (!storageRoot || !Array.isArray(attachments)) return [];
  const root = path.resolve(storageRoot);
  const targets = [];
  for (const item of attachments) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.storedName === 'string' ? item.storedName.trim() : '';
    if (!name || name !== path.basename(name)) continue;
    const abs = path.resolve(root, name);
    if (abs === root || !abs.startsWith(root + path.sep)) continue;
    targets.push(abs);
  }
  return targets;
}

// Hard-delete, matching the existing visit-report route and the contract /
// bid-opening deletes: the row goes first, then stored blobs, best effort.
// Calendar reminders keep their rows; the schema sets visitReportId to null.
export async function deleteVisitReportRecord({
  report,
  user,
  storageRoot = null,
  removeRow,
  unlinkFile,
}) {
  const access = deleteAccess(report, user);
  if (!access.ok) return access;
  const files = storedAttachmentTargets(report.attachments, storageRoot);
  await removeRow(report.id);
  for (const file of files) {
    try {
      await unlinkFile(file);
    } catch {
      // The row is already gone. A leftover blob is harmless.
    }
  }
  return { ok: true, status: 204, removedFiles: files };
}

// HTTP shape used by DELETE /api/visit-reports/:id. Kept here so the status
// codes can be tested without booting Prisma.
export async function handleDeleteVisitReport(req, res, {
  findReport,
  removeRow,
  unlinkFile,
  storageRoot = null,
} = {}) {
  try {
    const id = parseReportId(req.params?.id);
    const existing = id == null ? null : await findReport(id);
    const outcome = await deleteVisitReportRecord({
      report: existing,
      user: req.user,
      storageRoot,
      removeRow,
      unlinkFile,
    });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).end();
  } catch (error) {
    console.error('Error deleting visit report:', error);
    return res.status(500).json({ error: 'Failed to delete visit report' });
  }
}
