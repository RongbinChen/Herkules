// Hot projects — the internal WAV "Open Projects" tracking list.
// Sensitive module: per-record visibility (TEAM | PRIVATE). PRIVATE records are
// visible to their owner and admins only; every read path below applies the
// same filter, and the AI assistant reuses visibleWhere() so it can never
// surface a record the asking user couldn't open themselves.
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { callDeepSeek } from '../services/deepseek.js';
import { newProjectMail, projectUpdateMail } from '../services/hotProjectMail.js';

const router = express.Router();

// Mirrors the HotProjectCategory enum. Anything unrecognised falls back to OPEN
// rather than erroring — the sheet these records come from has always been the
// source of truth for which list a project sits in.
const CATEGORIES = new Set(['OPEN', 'POTENTIAL', 'REVAMP']);
const toCategory = (v) => (CATEGORIES.has(v) ? v : 'OPEN');
router.use(authenticateToken);

// Visibility clause for one user.
export function visibleWhere(user) {
  if (user.isAdmin) return {};
  return { OR: [{ visibility: 'TEAM' }, { ownerId: user.userId }] };
}

const canManage = (project, user) => user.isAdmin || project.ownerId === user.userId;

const UPDATE_INCLUDE = {
  // nulls last: imported entries whose "Updated on" date could not be parsed
  // are the oldest material here, not the newest — Postgres would sort them
  // first on a plain DESC and they would pose as the latest update.
  orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
  include: { author: { select: { id: true, name: true } } },
};

// When a project last moved. Falls back through the update's own creation time
// (imported rows have no parsed date) to the project row, so every project has
// a comparable timestamp and none of them sink to the bottom for lack of one.
const lastActivityAt = (project) => {
  const latest = project.updates?.[0];
  return new Date(latest?.date || latest?.createdAt || project.updatedAt || project.createdAt).getTime() || 0;
};

// Everyone with admin rights hears about movement on this list, the author
// included — the mail doubles as their own record that it went out, and to
// whom. Wording lives in services/hotProjectMail.js so a one-off script can
// send the identical mail.
async function adminRecipients() {
  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { email: true } });
  return admins.map((a) => a.email).filter(Boolean).join(',');
}

async function notifyNewProject(project, createdById) {
  // The JWT carries no display name, so the creator is looked up rather than
  // read off req.user. This runs after the response, so the query is free.
  const [to, creator] = await Promise.all([
    adminRecipients(),
    createdById
      ? prisma.user.findUnique({ where: { id: createdById }, select: { name: true } }).catch(() => null)
      : null,
  ]);
  return newProjectMail({ to, project, creatorName: creator?.name });
}

async function notifyProjectUpdate(project, update) {
  return projectUpdateMail({
    to: await adminRecipients(),
    project,
    content: update.content,
    authorName: update.author?.name,
  });
}

// ── List (visibility-filtered) ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, q, priority } = req.query;
    const where = { AND: [visibleWhere(req.user)] };
    if (CATEGORIES.has(category)) where.AND.push({ category });
    if (priority) where.AND.push({ priority: parseInt(priority) });
    if (q) {
      where.AND.push({
        OR: [
          { customer: { contains: q, mode: 'insensitive' } },
          { requirements: { contains: q, mode: 'insensitive' } },
          { processor: { contains: q, mode: 'insensitive' } },
          { updates: { some: { content: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    const projects = await prisma.hotProject.findMany({
      where,
      orderBy: [{ priority: { sort: 'asc', nulls: 'last' } }, { sortNo: 'asc' }, { id: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        customerRef: { select: { id: true, name: true } },
        updates: { ...UPDATE_INCLUDE, take: 1 }, // latest update as list snippet
        _count: { select: { updates: true } },
      },
    });
    // Most recently updated first. This is a sort on a related row's date,
    // which the query layer cannot order by, so it happens here — the list is
    // one team's open projects, not a paginated feed, so sorting it in memory
    // costs nothing. The database ordering above still decides ties.
    projects.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
    res.json(projects);
  } catch (error) {
    console.error('Error listing hot projects:', error);
    res.status(500).json({ error: 'Failed to list hot projects' });
  }
});

// ── Detail (with full update timeline) ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.hotProject.findFirst({
      where: { id: parseInt(req.params.id), ...visibleWhere(req.user) },
      include: {
        owner: { select: { id: true, name: true } },
        customerRef: { select: { id: true, name: true } },
        updates: UPDATE_INCLUDE,
      },
    });
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json({ ...project, canManage: canManage(project, req.user) });
  } catch (error) {
    console.error('Error fetching hot project:', error);
    res.status(500).json({ error: 'Failed to fetch hot project' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.customer || '').trim()) return res.status(400).json({ error: 'customer is required' });
    const project = await prisma.hotProject.create({
      data: {
        category: toCategory(b.category),
        customer: String(b.customer).trim(),
        customerId: b.customerId ? parseInt(b.customerId) : null,
        dateOfReceipt: b.dateOfReceipt ? new Date(b.dateOfReceipt) : null,
        processor: b.processor || null,
        ownerId: b.ownerId ? parseInt(b.ownerId) : req.user.userId, // default: creator owns it
        forwardedOn: b.forwardedOn || null,
        machineType: b.machineType || null,
        requirements: b.requirements || null,
        deadline: b.deadline ? new Date(b.deadline) : null,
        priority: b.priority ? parseInt(b.priority) : null,
        visibility: b.visibility === 'PRIVATE' ? 'PRIVATE' : 'TEAM',
        createdById: req.user.userId,
      },
      include: { owner: { select: { name: true } } },
    });
    res.status(201).json(project);
    // After the response: adding a project should never wait on SMTP.
    notifyNewProject(project, req.user.userId);
  } catch (error) {
    console.error('Error creating hot project:', error);
    res.status(500).json({ error: 'Failed to create hot project' });
  }
});

// ── Edit fields (owner or admin) ──────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.hotProject.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canManage(existing, req.user)) return res.status(403).json({ error: '只有负责人或管理员可编辑' });
    const b = req.body || {};
    const project = await prisma.hotProject.update({
      where: { id: existing.id },
      data: {
        ...(b.category !== undefined ? { category: toCategory(b.category) } : {}),
        ...(b.customer !== undefined ? { customer: String(b.customer).trim() } : {}),
        ...(b.customerId !== undefined ? { customerId: b.customerId ? parseInt(b.customerId) : null } : {}),
        ...(b.dateOfReceipt !== undefined ? { dateOfReceipt: b.dateOfReceipt ? new Date(b.dateOfReceipt) : null } : {}),
        ...(b.processor !== undefined ? { processor: b.processor || null } : {}),
        ...(b.ownerId !== undefined ? { ownerId: b.ownerId ? parseInt(b.ownerId) : null } : {}),
        ...(b.forwardedOn !== undefined ? { forwardedOn: b.forwardedOn || null } : {}),
        ...(b.machineType !== undefined ? { machineType: b.machineType || null } : {}),
        ...(b.requirements !== undefined ? { requirements: b.requirements || null } : {}),
        ...(b.deadline !== undefined ? { deadline: b.deadline ? new Date(b.deadline) : null } : {}),
        ...(b.priority !== undefined ? { priority: b.priority ? parseInt(b.priority) : null } : {}),
        ...(b.visibility !== undefined ? { visibility: b.visibility === 'PRIVATE' ? 'PRIVATE' : 'TEAM' } : {}),
      },
    });
    res.json(project);
  } catch (error) {
    console.error('Error updating hot project:', error);
    res.status(500).json({ error: 'Failed to update hot project' });
  }
});

// ── Append a status update (anyone who can view the record) ───────────────────
router.post('/:id/updates', async (req, res) => {
  try {
    const project = await prisma.hotProject.findFirst({
      where: { id: parseInt(req.params.id), ...visibleWhere(req.user) },
      include: { owner: { select: { name: true } } },
    });
    if (!project) return res.status(404).json({ error: 'Not found' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'content is required' });
    const update = await prisma.hotProjectUpdate.create({
      data: {
        projectId: project.id,
        content,
        date: req.body?.date ? new Date(req.body.date) : new Date(),
        authorId: req.user.userId,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    res.status(201).json(update);
    // After the response: the person filing an update should never wait on SMTP.
    notifyProjectUpdate(project, update);
  } catch (error) {
    console.error('Error adding hot project update:', error);
    res.status(500).json({ error: 'Failed to add update' });
  }
});

// ── Delete an update (its author or admin) ────────────────────────────────────
router.delete('/:id/updates/:updateId', async (req, res) => {
  try {
    const update = await prisma.hotProjectUpdate.findUnique({ where: { id: parseInt(req.params.updateId) } });
    if (!update || update.projectId !== parseInt(req.params.id)) return res.status(404).json({ error: 'Not found' });
    if (!req.user.isAdmin && update.authorId !== req.user.userId) {
      return res.status(403).json({ error: '只有编辑人本人或管理员可删除' });
    }
    await prisma.hotProjectUpdate.delete({ where: { id: update.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting hot project update:', error);
    res.status(500).json({ error: 'Failed to delete update' });
  }
});

// ── AI summary of the status-update history (visibility-filtered, ephemeral) ──
router.post('/:id/summarize', async (req, res) => {
  try {
    const project = await prisma.hotProject.findFirst({
      where: { id: parseInt(req.params.id), ...visibleWhere(req.user) },
      include: {
        updates: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { author: { select: { name: true } } } },
        customerRef: { select: { name: true } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.updates.length) return res.json({ summary: '' });

    const text = [
      `Customer: ${project.customerRef?.name || project.customer || '-'}`,
      `Requirements / machine: ${project.requirements || '-'}${project.machineType ? ` (${project.machineType})` : ''}`,
      'Status updates, oldest first:',
      ...project.updates.map((u) =>
        `${u.date ? u.date.toISOString().slice(0, 10) : '(undated)'} [${u.author?.name || '-'}]: ${u.content}`),
    ].join('\n');

    // Match the summary's language to the updates (they're mostly English).
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const directive = cjk > latin
      ? '请用中文输出。'
      : 'Write the summary in English (the updates are in English).';
    const reply = await callDeepSeek(
      [
        {
          role: 'system',
          content: '你是销售团队助理。根据一个销售项目的跟进记录，输出简明现状总结：当前状态与阶段、关键进展/变化、竞争对手情况（如有）、下一步与时间点。3-5 句话或短要点，不要复述全部历史，只讲现在最有用的。',
        },
        { role: 'user', content: `${directive}\n\n${text.slice(0, 8000)}` },
      ],
      600,
    );
    res.json({ summary: String(reply || '').trim() });
  } catch (error) {
    console.error('Error summarizing hot project:', error);
    res.status(500).json({ error: 'AI summary failed, please retry' });
  }
});

// ── Delete a project (owner or admin) ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.hotProject.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canManage(existing, req.user)) return res.status(403).json({ error: '只有负责人或管理员可删除' });
    await prisma.hotProject.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting hot project:', error);
    res.status(500).json({ error: 'Failed to delete hot project' });
  }
});

export default router;
