// Project follow-up — CRUD for the record, its milestones, its contacts and
// its running log.
//
// No per-record visibility rule here, unlike Hot Projects: an order in
// execution is the company's business and everyone touching it (sales,
// finance, service) needs to see the dates. Editing is narrower — the owner,
// the person who created it, or an admin.
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireUnlock } from './contracts.js';
import {
  MILESTONES, MILESTONE_BY_KIND, MILESTONE_KINDS, chinaDay, reminderDue,
  reminderRecipients,
} from '../services/followUps.js';
import { milestoneReminderMail } from '../services/followUpMail.js';
import { summariseContractFile, DgxOfflineError } from '../services/contractSummary.js';

const router = express.Router();
router.use(authenticateToken);

const canManage = (f, user) =>
  user.isAdmin || f.ownerId === user.userId || f.createdById === user.userId;

const FULL_INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  customer: { select: { id: true, name: true, contacts: true, contactName: true, contactPhone: true, email: true } },
  hotProject: { select: { id: true, customer: true, category: true } },
  milestones: {
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    include: { owner: { select: { id: true, name: true } } },
  },
  contacts: { orderBy: { id: 'asc' } },
  // Count only. The filenames live behind the contracts module's team PIN and
  // are served by the unlock-gated endpoint below — putting them in this
  // payload would hand every logged-in user the one thing the PIN exists to
  // withhold.
  _count: { select: { contractFiles: true } },
  updates: {
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  },
};

const toDate = (v) => (v ? new Date(v) : null);

// The next thing that has to happen — what the list view leads with. Done
// milestones and undated ones are not "next" by any reading.
function nextMilestone(f) {
  const open = (f.milestones || []).filter((m) => !m.doneAt && m.dueDate);
  if (!open.length) return null;
  return open.reduce((a, b) => (new Date(a.dueDate) <= new Date(b.dueDate) ? a : b));
}

// ── The milestone catalogue, so the client never hardcodes the enum ──────────
router.get('/catalogue', (_req, res) => res.json(MILESTONES));

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, q, ownerId } = req.query;
    const where = { AND: [] };
    // Default view is the live work; finished and cancelled orders are still
    // reachable, but they are not what someone opens this page to see.
    where.AND.push(status ? { status } : { status: { in: ['ACTIVE', 'ON_HOLD'] } });
    if (ownerId) where.AND.push({ ownerId: parseInt(ownerId) });
    if (q) {
      where.AND.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { orderNo: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { contacts: { some: { name: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    const rows = await prisma.projectFollowUp.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        milestones: { select: { id: true, kind: true, label: true, dueDate: true, doneAt: true } },
        _count: { select: { contacts: true, updates: true } },
      },
    });
    const today = chinaDay();
    const decorated = rows.map((f) => {
      const next = nextMilestone(f);
      const open = f.milestones.filter((m) => !m.doneAt && m.dueDate);
      return {
        ...f,
        next: next && { ...next, meta: MILESTONE_BY_KIND.get(next.kind) || null },
        // Anything already past its date and not ticked off. This is the number
        // the list sorts on — an order with a slipped date outranks one that is
        // merely busy.
        overdueCount: open.filter((m) => chinaDay(m.dueDate) < today).length,
        doneCount: f.milestones.filter((m) => m.doneAt).length,
        totalDated: f.milestones.filter((m) => m.dueDate).length,
      };
    });
    // Overdue first, then by how soon the next date lands, then undated.
    decorated.sort((a, b) => {
      if ((b.overdueCount > 0) !== (a.overdueCount > 0)) return b.overdueCount - a.overdueCount;
      const ad = a.next?.dueDate ? new Date(a.next.dueDate).getTime() : Infinity;
      const bd = b.next?.dueDate ? new Date(b.next.dueDate).getTime() : Infinity;
      return ad - bd || b.id - a.id;
    });
    res.json(decorated);
  } catch (error) {
    console.error('Error listing follow-ups:', error);
    res.status(500).json({ error: 'Failed to list follow-ups' });
  }
});

// ── Detail ───────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({
      where: { id: parseInt(req.params.id) },
      include: FULL_INCLUDE,
    });
    if (!f) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...f,
      milestones: f.milestones.map((m) => ({ ...m, meta: MILESTONE_BY_KIND.get(m.kind) || null })),
      canManage: canManage(f, req.user),
    });
  } catch (error) {
    console.error('Error fetching follow-up:', error);
    res.status(500).json({ error: 'Failed to fetch follow-up' });
  }
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.title || '').trim()) return res.status(400).json({ error: 'title is required' });
    const f = await prisma.projectFollowUp.create({
      data: {
        title: String(b.title).trim(),
        orderNo: b.orderNo || null,
        customerId: b.customerId ? parseInt(b.customerId) : null,
        hotProjectId: b.hotProjectId ? parseInt(b.hotProjectId) : null,
        ownerId: b.ownerId ? parseInt(b.ownerId) : req.user.userId,
        machineType: b.machineType || null,
        contractValue: b.contractValue || null,
        notes: b.notes || null,
        createdById: req.user.userId,
      },
    });
    res.status(201).json(f);
  } catch (error) {
    console.error('Error creating follow-up:', error);
    res.status(500).json({ error: 'Failed to create follow-up' });
  }
});

// ── Edit ─────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.projectFollowUp.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canManage(existing, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });
    const b = req.body || {};
    const f = await prisma.projectFollowUp.update({
      where: { id: existing.id },
      data: {
        ...(b.title !== undefined ? { title: String(b.title).trim() } : {}),
        ...(b.orderNo !== undefined ? { orderNo: b.orderNo || null } : {}),
        ...(b.customerId !== undefined ? { customerId: b.customerId ? parseInt(b.customerId) : null } : {}),
        ...(b.hotProjectId !== undefined ? { hotProjectId: b.hotProjectId ? parseInt(b.hotProjectId) : null } : {}),
        ...(b.ownerId !== undefined ? { ownerId: b.ownerId ? parseInt(b.ownerId) : null } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(b.machineType !== undefined ? { machineType: b.machineType || null } : {}),
        ...(b.contractValue !== undefined ? { contractValue: b.contractValue || null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      },
    });
    res.json(f);
  } catch (error) {
    console.error('Error updating follow-up:', error);
    res.status(500).json({ error: 'Failed to update follow-up' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.projectFollowUp.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canManage(existing, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可删除' });
    await prisma.projectFollowUp.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting follow-up:', error);
    res.status(500).json({ error: 'Failed to delete follow-up' });
  }
});

// ── Milestones ───────────────────────────────────────────────────────────────
// Upsert by kind: a record has at most one of each milestone type, so the
// client sends the kind and the date and does not track row ids.
router.put('/:id/milestones/:kind', async (req, res) => {
  try {
    const followUpId = parseInt(req.params.id);
    const kind = req.params.kind;
    if (!MILESTONE_KINDS.has(kind)) return res.status(400).json({ error: 'unknown milestone kind' });
    const f = await prisma.projectFollowUp.findUnique({ where: { id: followUpId } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });

    const b = req.body || {};
    const data = {
      ...(b.dueDate !== undefined ? { dueDate: toDate(b.dueDate) } : {}),
      ...(b.label !== undefined ? { label: b.label || null } : {}),
      ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      ...(b.ownerId !== undefined ? { ownerId: b.ownerId ? parseInt(b.ownerId) : null } : {}),
      ...(b.remindDaysBefore !== undefined
        ? { remindDaysBefore: (b.remindDaysBefore || []).map(Number).filter((n) => Number.isFinite(n) && n > 0) }
        : {}),
      ...(b.done !== undefined ? { doneAt: b.done ? new Date() : null } : {}),
    };
    // Moving a date forward must re-arm the reminder: without this a milestone
    // pushed from "today" to next month keeps today's stamp and stays silent
    // until the stamp happens to differ, which is exactly when nobody is
    // watching it any more.
    if (b.dueDate !== undefined || b.done === false) data.lastRemindedOn = null;

    const existing = await prisma.followUpMilestone.findFirst({ where: { followUpId, kind } });
    const row = existing
      ? await prisma.followUpMilestone.update({ where: { id: existing.id }, data })
      : await prisma.followUpMilestone.create({
        data: {
          followUpId,
          kind,
          remindDaysBefore: MILESTONE_BY_KIND.get(kind)?.lead ?? [14, 7, 1],
          ...data,
        },
      });
    res.json({ ...row, meta: MILESTONE_BY_KIND.get(kind) || null });
  } catch (error) {
    console.error('Error saving milestone:', error);
    res.status(500).json({ error: 'Failed to save milestone' });
  }
});

router.delete('/:id/milestones/:kind', async (req, res) => {
  try {
    const followUpId = parseInt(req.params.id);
    const f = await prisma.projectFollowUp.findUnique({ where: { id: followUpId } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });
    const existing = await prisma.followUpMilestone.findFirst({ where: { followUpId, kind: req.params.kind } });
    if (existing) await prisma.followUpMilestone.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting milestone:', error);
    res.status(500).json({ error: 'Failed to delete milestone' });
  }
});

// Send one milestone's reminder now, to the same people the sweep would mail.
// Exists because "did this actually reach anyone?" is otherwise a question you
// can only answer by waiting until tomorrow morning.
router.post('/:id/milestones/:kind/notify', async (req, res) => {
  try {
    const followUpId = parseInt(req.params.id);
    const m = await prisma.followUpMilestone.findFirst({
      where: { followUpId, kind: req.params.kind },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        followUp: {
          include: {
            owner: { select: { id: true, name: true, email: true } },
            customer: { select: { name: true } },
          },
        },
      },
    });
    if (!m) return res.status(404).json({ error: 'Not found' });
    if (!canManage(m.followUp, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可发送' });
    if (!m.dueDate) return res.status(400).json({ error: '该节点还没有日期' });

    const person = m.owner || m.followUp.owner;
    if (!person?.email) return res.status(400).json({ error: '该节点没有指派到有邮箱的人' });

    const { cc, bcc } = await reminderRecipients(person.email);
    // A manual send reports the real standing of the date, not a fixed
    // "reminder" wording — asking for it the day after it slipped should say
    // so. reminderDue() returns null when nothing is due, so fall back.
    const due = reminderDue({ ...m, lastRemindedOn: null }) || { urgency: 'upcoming', delta: 0 };
    const ok = await milestoneReminderMail({
      to: person.email, cc, bcc,
      milestone: m, followUp: m.followUp,
      meta: MILESTONE_BY_KIND.get(m.kind), due,
    });
    res.json({ sent: ok, to: person.email, cc, bcc: bcc ? '(bcc)' : null });
  } catch (error) {
    console.error('Error sending milestone notification:', error);
    res.status(500).json({ error: 'Failed to send' });
  }
});

// ── Linked contracts (behind the contracts module's team PIN) ────────────────
// The link itself is ordinary data; the files are not. Both endpoints below run
// through requireUnlock, so what comes back is scoped to the team whose PIN was
// entered — a WRC unlock never lists an HRC file, here or anywhere else.

router.get('/:id/contracts', requireUnlock, async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        contractFiles: {
          where: { team: req.contractTeam },
          select: {
            id: true, filename: true, docType: true, size: true, note: true,
            createdAt: true, customerId: true,
            uploadedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!f) return res.status(404).json({ error: 'Not found' });
    res.json(f.contractFiles);
  } catch (error) {
    console.error('Error listing linked contracts:', error);
    res.status(500).json({ error: 'Failed to list contracts' });
  }
});

// Candidates to link: the customer's files, in the unlocked team. Same query
// the Contracts page would run for that customer, so nothing new is exposed.
router.get('/:id/contracts/available', requireUnlock, async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { customerId: true },
    });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!f.customerId) return res.json([]);
    const rows = await prisma.contractFile.findMany({
      where: { customerId: f.customerId, team: req.contractTeam },
      select: { id: true, filename: true, docType: true, size: true, note: true, createdAt: true },
      orderBy: [{ docType: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(rows);
  } catch (error) {
    console.error('Error listing available contracts:', error);
    res.status(500).json({ error: 'Failed to list contracts' });
  }
});

// Replace the set of linked files. Only files that belong to this follow-up's
// customer AND sit in the unlocked team can be linked — a crafted id list can
// neither reach another customer's paperwork nor another team's.
router.put('/:id/contracts', requireUnlock, async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });

    const wanted = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map(Number).filter(Boolean) : [];
    const allowed = f.customerId
      ? await prisma.contractFile.findMany({
        where: { id: { in: wanted }, customerId: f.customerId, team: req.contractTeam },
        select: { id: true },
      })
      : [];

    // `set` only touches links this team can see. Files linked under the other
    // team's PIN stay put — this request has no business dropping them, and
    // silently unlinking what the caller cannot see is how data disappears.
    const keepOtherTeams = await prisma.contractFile.findMany({
      where: { followUps: { some: { id: f.id } }, team: { not: req.contractTeam } },
      select: { id: true },
    });

    await prisma.projectFollowUp.update({
      where: { id: f.id },
      data: { contractFiles: { set: [...allowed, ...keepOtherTeams].map(({ id }) => ({ id })) } },
    });
    res.json({ linked: allowed.length });
  } catch (error) {
    console.error('Error linking contracts:', error);
    res.status(500).json({ error: 'Failed to link contracts' });
  }
});

// ── Prefill from the selected contracts ──────────────────────────────────────
// The machine model and the contract value are written in the documents this
// order runs on, and the contracts module already reads them: its key-terms
// summary asks a commercial contract for `amount` and `contractNo`, and a
// technical agreement for `machine`. So this is not a new extraction — it is
// the existing one, read from the angle of a form that needs three of its
// answers.
//
// Two consequences worth knowing. A cached summary comes back instantly; an
// unread one spends about a minute of GPU per file, which is why the client
// asks for this explicitly rather than on every keystroke. And what comes back
// is a *suggestion*: the caller decides whether it lands in the field, because
// the person filing the order has seen the paperwork and the model has only
// read it.
const SUGGEST_FROM = {
  // form field ← summary field key, by document type, in order of preference
  contractValue: [['COMMERCIAL', 'amount']],
  machineType: [['TECHNICAL', 'machine']],
  orderNo: [['COMMERCIAL', 'contractNo'], ['TECHNICAL', 'contractNo']],
};

router.post('/prefill', requireUnlock, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.json({ suggestions: {}, sources: [] });
    // Team scope first: an id the caller's unlock does not cover is not read.
    const files = await prisma.contractFile.findMany({
      where: { id: { in: ids }, team: req.contractTeam },
      select: { id: true, filename: true, docType: true },
    });

    const byDocType = new Map();
    const sources = [];
    for (const f of files) {
      try {
        const summary = await summariseContractFile({ fileId: f.id, team: req.contractTeam });
        sources.push({
          fileId: f.id, filename: f.filename, docType: f.docType,
          ok: !summary?.reason, reason: summary?.reason || null, cached: summary?.cached === true,
        });
        if (summary?.fields?.length && !byDocType.has(f.docType)) byDocType.set(f.docType, summary.fields);
      } catch (err) {
        // One unreadable file must not cost the answers the others hold. The
        // DGX being offline is the common case and is reported, not thrown.
        const offline = err instanceof DgxOfflineError;
        sources.push({
          fileId: f.id, filename: f.filename, docType: f.docType,
          ok: false, reason: offline ? 'dgx-offline' : 'failed', cached: false,
        });
      }
    }

    const suggestions = {};
    for (const [formField, prefs] of Object.entries(SUGGEST_FROM)) {
      for (const [docType, key] of prefs) {
        const field = byDocType.get(docType)?.find((x) => x.key === key);
        // '—' is how the summariser says "asked, not found" — a real answer,
        // but not one worth putting in a form field.
        const value = String(field?.value ?? '').trim();
        if (value && value !== '—') {
          suggestions[formField] = { value, from: docType, label: field.label };
          break;
        }
      }
    }
    res.json({ suggestions, sources });
  } catch (error) {
    console.error('Error prefilling from contracts:', error);
    res.status(500).json({ error: 'Failed to read the contracts' });
  }
});

// ── Contacts ─────────────────────────────────────────────────────────────────
router.post('/:id/contacts', async (req, res) => {
  try {
    const followUpId = parseInt(req.params.id);
    const f = await prisma.projectFollowUp.findUnique({ where: { id: followUpId } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required' });
    const row = await prisma.followUpContact.create({
      data: {
        followUpId,
        name: String(b.name).trim(),
        role: b.role || null,
        company: b.company || null,
        title: b.title || null,
        phone: b.phone || null,
        email: b.email || null,
        wechat: b.wechat || null,
        notes: b.notes || null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.put('/:id/contacts/:contactId', async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });
    const b = req.body || {};
    const row = await prisma.followUpContact.update({
      where: { id: parseInt(req.params.contactId) },
      data: {
        ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
        ...(b.role !== undefined ? { role: b.role || null } : {}),
        ...(b.company !== undefined ? { company: b.company || null } : {}),
        ...(b.title !== undefined ? { title: b.title || null } : {}),
        ...(b.phone !== undefined ? { phone: b.phone || null } : {}),
        ...(b.email !== undefined ? { email: b.email || null } : {}),
        ...(b.wechat !== undefined ? { wechat: b.wechat || null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      },
    });
    res.json(row);
  } catch (error) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/:id/contacts/:contactId', async (req, res) => {
  try {
    const f = await prisma.projectFollowUp.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(f, req.user)) return res.status(403).json({ error: '只有负责人、创建人或管理员可编辑' });
    await prisma.followUpContact.delete({ where: { id: parseInt(req.params.contactId) } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ── Running log (anyone who can see the record) ──────────────────────────────
router.post('/:id/updates', async (req, res) => {
  try {
    const followUpId = parseInt(req.params.id);
    const f = await prisma.projectFollowUp.findUnique({ where: { id: followUpId } });
    if (!f) return res.status(404).json({ error: 'Not found' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'content is required' });
    const row = await prisma.followUpUpdate.create({
      data: { followUpId, content, authorId: req.user.userId },
      include: { author: { select: { id: true, name: true } } },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('Error adding follow-up update:', error);
    res.status(500).json({ error: 'Failed to add update' });
  }
});

router.delete('/:id/updates/:updateId', async (req, res) => {
  try {
    const row = await prisma.followUpUpdate.findUnique({ where: { id: parseInt(req.params.updateId) } });
    if (!row || row.followUpId !== parseInt(req.params.id)) return res.status(404).json({ error: 'Not found' });
    if (!req.user.isAdmin && row.authorId !== req.user.userId) {
      return res.status(403).json({ error: '只有编辑人本人或管理员可删除' });
    }
    await prisma.followUpUpdate.delete({ where: { id: row.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting follow-up update:', error);
    res.status(500).json({ error: 'Failed to delete update' });
  }
});

export default router;
