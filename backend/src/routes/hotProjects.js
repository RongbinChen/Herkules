// Hot projects — the internal WAV "Open Projects" tracking list.
// Sensitive module: per-record visibility (TEAM | PRIVATE). PRIVATE records are
// visible to their owner and admins only; every read path below applies the
// same filter, and the AI assistant reuses visibleWhere() so it can never
// surface a record the asking user couldn't open themselves.
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// Visibility clause for one user.
export function visibleWhere(user) {
  if (user.isAdmin) return {};
  return { OR: [{ visibility: 'TEAM' }, { ownerId: user.userId }] };
}

const canManage = (project, user) => user.isAdmin || project.ownerId === user.userId;

const UPDATE_INCLUDE = {
  orderBy: [{ date: 'desc' }, { id: 'desc' }],
  include: { author: { select: { id: true, name: true } } },
};

// ── List (visibility-filtered) ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, q, priority } = req.query;
    const where = { AND: [visibleWhere(req.user)] };
    if (category === 'OPEN' || category === 'POTENTIAL') where.AND.push({ category });
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
        category: b.category === 'POTENTIAL' ? 'POTENTIAL' : 'OPEN',
        customer: String(b.customer).trim(),
        customerId: b.customerId ? parseInt(b.customerId) : null,
        dateOfReceipt: b.dateOfReceipt ? new Date(b.dateOfReceipt) : null,
        processor: b.processor || null,
        ownerId: b.ownerId ? parseInt(b.ownerId) : req.user.userId, // default: creator owns it
        forwardedOn: b.forwardedOn || null,
        requirements: b.requirements || null,
        deadline: b.deadline ? new Date(b.deadline) : null,
        priority: b.priority ? parseInt(b.priority) : null,
        visibility: b.visibility === 'PRIVATE' ? 'PRIVATE' : 'TEAM',
        createdById: req.user.userId,
      },
    });
    res.status(201).json(project);
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
        ...(b.category !== undefined ? { category: b.category === 'POTENTIAL' ? 'POTENTIAL' : 'OPEN' } : {}),
        ...(b.customer !== undefined ? { customer: String(b.customer).trim() } : {}),
        ...(b.customerId !== undefined ? { customerId: b.customerId ? parseInt(b.customerId) : null } : {}),
        ...(b.dateOfReceipt !== undefined ? { dateOfReceipt: b.dateOfReceipt ? new Date(b.dateOfReceipt) : null } : {}),
        ...(b.processor !== undefined ? { processor: b.processor || null } : {}),
        ...(b.ownerId !== undefined ? { ownerId: b.ownerId ? parseInt(b.ownerId) : null } : {}),
        ...(b.forwardedOn !== undefined ? { forwardedOn: b.forwardedOn || null } : {}),
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
