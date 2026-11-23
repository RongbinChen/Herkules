import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DELETE_FORBIDDEN,
  NOT_FOUND,
  canDeleteVisitReport,
  deleteAccess,
  deleteVisitReportRecord,
  handleDeleteVisitReport,
  parseReportId,
  removeVisitReportAndReminders,
  storedAttachmentTargets,
  withCanDelete,
} from '../src/services/visitReportAccess.js';

const report = {
  id: 10,
  title: 'COSCO visit',
  authorId: 7,
  author: { id: 7, name: 'Ada' },
  attachments: [{ name: 'whiteboard.jpg', kind: 'image' }],
};

const uploader = { userId: 7, isAdmin: false };
const admin = { userId: 1, isAdmin: true };
const coordinator = { userId: 3, isAdmin: false };
const dispatcher = { userId: 4, isAdmin: false };
const otherEngineer = { userId: 9, isAdmin: false };

test('uploader and admin may delete; other roles may not', () => {
  assert.equal(canDeleteVisitReport(report, uploader), true);
  assert.equal(canDeleteVisitReport(report, admin), true);
  assert.equal(canDeleteVisitReport(report, { userId: 7, isAdmin: true }), true);
  assert.equal(canDeleteVisitReport(report, coordinator), false);
  assert.equal(canDeleteVisitReport(report, dispatcher), false);
  assert.equal(canDeleteVisitReport(report, otherEngineer), false);
  // A role name or a truthy non-boolean never counts as admin.
  assert.equal(canDeleteVisitReport(report, { userId: 3, isAdmin: 'true', role: 'coordinator' }), false);
  assert.equal(canDeleteVisitReport(report, { userId: 3, isAdmin: 1, role: 'dispatcher' }), false);
  assert.equal(canDeleteVisitReport(report, null), false);
  assert.equal(canDeleteVisitReport(null, admin), false);
});

test('author can be read from the nested author when authorId is absent', () => {
  const nested = { id: 10, author: { id: 7, name: 'Ada' } };
  assert.equal(canDeleteVisitReport(nested, uploader), true);
  assert.equal(canDeleteVisitReport(nested, otherEngineer), false);
});

test('readable but not deletable is 403; missing is 404', () => {
  assert.deepEqual(deleteAccess(report, coordinator), { ok: false, status: 403, error: DELETE_FORBIDDEN });
  assert.deepEqual(deleteAccess(report, dispatcher), { ok: false, status: 403, error: DELETE_FORBIDDEN });
  assert.deepEqual(deleteAccess(report, otherEngineer), { ok: false, status: 403, error: DELETE_FORBIDDEN });
  assert.deepEqual(deleteAccess(null, admin), { ok: false, status: 404, error: NOT_FOUND });
  assert.deepEqual(deleteAccess(undefined, uploader), { ok: false, status: 404, error: NOT_FOUND });
  assert.deepEqual(deleteAccess(report, uploader), { ok: true, status: 204 });
  assert.deepEqual(deleteAccess(report, admin), { ok: true, status: 204 });
});

test('list and detail payloads carry canDelete without dropping report fields', () => {
  const mine = withCanDelete(report, uploader);
  const theirs = withCanDelete(report, coordinator);
  assert.equal(mine.canDelete, true);
  assert.equal(theirs.canDelete, false);
  assert.equal(mine.title, 'COSCO visit');
  assert.equal(mine.author.name, 'Ada');
  assert.deepEqual(theirs.attachments, report.attachments);
});

test('report ids that are not positive integers are not found', () => {
  assert.equal(parseReportId('12'), 12);
  assert.equal(parseReportId(' 8 '), 8);
  assert.equal(parseReportId('0'), null);
  assert.equal(parseReportId('-3'), null);
  assert.equal(parseReportId('12abc'), null);
  assert.equal(parseReportId('1.5'), null);
  assert.equal(parseReportId(''), null);
  assert.equal(parseReportId(null), null);
  assert.equal(parseReportId(undefined), null);
});

test('metadata-only attachments name no file; storedName stays inside the storage root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vr-files-'));
  try {
    assert.deepEqual(storedAttachmentTargets(report.attachments, root), []);
    assert.deepEqual(storedAttachmentTargets([{ name: 'a.docx', kind: 'document' }], null), []);
    assert.deepEqual(storedAttachmentTargets('nope', root), []);

    await writeFile(path.join(root, 'blob.bin'), 'photo-bytes');
    await writeFile(path.join(root, '..', 'outside.bin'), 'secret');
    const named = [
      { name: 'whiteboard.jpg', kind: 'image' },
      { storedName: 'blob.bin' },
      { storedName: '../outside.bin' },
      { storedName: 'nested/blob.bin' },
      { storedName: '..' },
      { storedName: '' },
    ];
    assert.deepEqual(storedAttachmentTargets(named, root), [path.join(root, 'blob.bin')]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(path.join(tmpdir(), 'outside.bin'), { force: true });
  }
});

test('delete removes the row and stored files for the uploader, and touches nothing for other roles', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vr-del-'));
  const blob = path.join(root, 'blob.bin');
  await writeFile(blob, 'bytes');
  const rows = new Map([
    [10, {
      ...report,
      attachments: [{ name: 'whiteboard.jpg', kind: 'image' }, { storedName: 'blob.bin' }],
    }],
  ]);
  const unlinked = [];
  const removeRow = async (id) => { rows.delete(id); };
  const unlinkFile = async (file) => { unlinked.push(file); const { unlink } = await import('node:fs/promises'); await unlink(file); };

  try {
    const denied = await deleteVisitReportRecord({
      report: rows.get(10),
      user: coordinator,
      storageRoot: root,
      removeRow,
      unlinkFile,
    });
    assert.equal(denied.status, 403);
    assert.equal(rows.has(10), true);
    assert.deepEqual(unlinked, []);
    assert.equal(existsSync(blob), true);

    const missing = await deleteVisitReportRecord({
      report: null,
      user: admin,
      storageRoot: root,
      removeRow,
      unlinkFile,
    });
    assert.equal(missing.status, 404);
    assert.equal(rows.has(10), true);

    const ok = await deleteVisitReportRecord({
      report: rows.get(10),
      user: uploader,
      storageRoot: root,
      removeRow,
      unlinkFile,
    });
    assert.equal(ok.status, 204);
    assert.equal(rows.has(10), false);
    assert.deepEqual(unlinked, [blob]);
    assert.equal(existsSync(blob), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

test('DELETE responds 204 for the uploader, 403 for another role, 404 when missing', async () => {
  const rows = new Map([[10, { ...report }]]);
  const deps = {
    findReport: async (id) => rows.get(id) || null,
    removeRow: async (id) => { rows.delete(id); },
    unlinkFile: async () => {},
    storageRoot: null,
  };

  const forbidden = mockRes();
  await handleDeleteVisitReport({ params: { id: '10' }, user: coordinator }, forbidden, deps);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.body.error, DELETE_FORBIDDEN);
  assert.equal(rows.has(10), true);

  const missing = mockRes();
  await handleDeleteVisitReport({ params: { id: '999' }, user: admin }, missing, deps);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, NOT_FOUND);

  const garbage = mockRes();
  await handleDeleteVisitReport({ params: { id: 'nope' }, user: uploader }, garbage, deps);
  assert.equal(garbage.statusCode, 404);

  const ok = mockRes();
  await handleDeleteVisitReport({ params: { id: '10' }, user: uploader }, ok, deps);
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.ended, true);
  assert.equal(rows.has(10), false);

  const adminDelete = mockRes();
  rows.set(11, { id: 11, authorId: 7, attachments: null });
  await handleDeleteVisitReport({ params: { id: '11' }, user: dispatcher }, adminDelete, deps);
  assert.equal(adminDelete.statusCode, 403);
  rows.set(11, { id: 11, authorId: 7, attachments: null });
  const asAdmin = mockRes();
  await handleDeleteVisitReport({ params: { id: '11' }, user: admin }, asAdmin, deps);
  assert.equal(asAdmin.statusCode, 204);
  assert.equal(rows.has(11), false);
});

test('an admin can delete another person\'s report, and a failed unlink still keeps the row gone', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vr-admin-'));
  const rows = new Map([[10, { ...report, attachments: [{ storedName: 'missing.bin' }] }]]);
  try {
    const outcome = await deleteVisitReportRecord({
      report: rows.get(10),
      user: admin,
      storageRoot: root,
      removeRow: async (id) => { rows.delete(id); },
      unlinkFile: async () => { throw new Error('already gone'); },
    });
    assert.equal(outcome.ok, true);
    assert.equal(rows.has(10), false);
    assert.deepEqual(outcome.removedFiles, [path.join(root, 'missing.bin')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


// In-memory Prisma stand-in: $transaction rolls back both tables if either
// write throws. Fixtures are anonymized (no real contacts).
function memoryDb({ failOn } = {}) {
  const events = [
    { id: 101, title: 'Keep contact', visitReportId: 10, category: 'REMINDER' },
    { id: 102, title: 'Prepare proposal', visitReportId: 10, category: 'REMINDER' },
    { id: 103, title: 'Workshop meeting', visitReportId: null, category: 'MEETING' },
    { id: 104, title: 'Other report reminder', visitReportId: 11, category: 'REMINDER' },
  ];
  const reports = [
    { id: 10, title: 'Plant visit' },
    { id: 11, title: 'Other visit' },
  ];
  const txOf = (store) => ({
    event: {
      deleteMany: async ({ where }) => {
        if (failOn === 'reminders') throw new Error('reminder delete failed');
        const before = store.events.length;
        store.events = store.events.filter((e) => e.visitReportId !== where.visitReportId);
        return { count: before - store.events.length };
      },
    },
    visitReport: {
      delete: async ({ where }) => {
        if (failOn === 'report') throw new Error('report delete failed');
        const i = store.reports.findIndex((r) => r.id === where.id);
        if (i < 0) throw new Error('not found');
        const [removed] = store.reports.splice(i, 1);
        return removed;
      },
    },
  });
  const store = { events, reports };
  return {
    store,
    $transaction: async (fn) => {
      const snap = {
        events: store.events.map((e) => ({ ...e })),
        reports: store.reports.map((r) => ({ ...r })),
      };
      try {
        return await fn(txOf(store));
      } catch (err) {
        store.events = snap.events;
        store.reports = snap.reports;
        throw err;
      }
    },
  };
}

test('deleting a report also deletes reminders linked by visitReportId, and nothing else', async () => {
  const db = memoryDb();
  await removeVisitReportAndReminders(db, 10);
  assert.equal(db.store.reports.some((r) => r.id === 10), false);
  assert.equal(db.store.reports.some((r) => r.id === 11), true);
  assert.deepEqual(db.store.events.map((e) => e.id).sort(), [103, 104]);
});

test('a failed reminder delete leaves the report and its reminders in place', async () => {
  const db = memoryDb({ failOn: 'reminders' });
  await assert.rejects(() => removeVisitReportAndReminders(db, 10), /reminder delete failed/);
  assert.equal(db.store.reports.some((r) => r.id === 10), true);
  assert.deepEqual(db.store.events.map((e) => e.id).sort(), [101, 102, 103, 104]);
});

test('a failed report delete rolls back reminder deletions', async () => {
  const db = memoryDb({ failOn: 'report' });
  await assert.rejects(() => removeVisitReportAndReminders(db, 10), /report delete failed/);
  assert.equal(db.store.reports.some((r) => r.id === 10), true);
  assert.deepEqual(db.store.events.map((e) => e.id).sort(), [101, 102, 103, 104]);
});

test('a 403 or missing report does not delete linked reminders', async () => {
  const events = new Map([
    [101, { id: 101, visitReportId: 10 }],
    [103, { id: 103, visitReportId: null }],
  ]);
  const rows = new Map([[10, { ...report }]]);
  const removeRow = async (id) => {
    for (const [eid, ev] of [...events]) {
      if (ev.visitReportId === id) events.delete(eid);
    }
    rows.delete(id);
  };

  const denied = await deleteVisitReportRecord({
    report: rows.get(10),
    user: coordinator,
    removeRow,
    unlinkFile: async () => {},
  });
  assert.equal(denied.status, 403);
  assert.equal(rows.has(10), true);
  assert.equal(events.has(101), true);

  const missing = await deleteVisitReportRecord({
    report: null,
    user: admin,
    removeRow,
    unlinkFile: async () => {},
  });
  assert.equal(missing.status, 404);
  assert.equal(events.has(101), true);

  const ok = await deleteVisitReportRecord({
    report: rows.get(10),
    user: uploader,
    removeRow,
    unlinkFile: async () => {},
  });
  assert.equal(ok.status, 204);
  assert.equal(rows.has(10), false);
  assert.equal(events.has(101), false);
  assert.equal(events.has(103), true);
});
