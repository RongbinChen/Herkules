// Unified command search — powers the /customer /project /report command box.
// One endpoint, three modes; each returns lightweight cards that link into the
// existing hub pages (customer detail, project tracking, visit reports).
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { listProjectThreads } from '../services/chinabidding.js';

const router = express.Router();
router.use(authenticateToken);

const TYPES = new Set(['customer', 'project', 'report']);

router.get('/', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 12, 30);
    if (!TYPES.has(type)) return res.status(400).json({ error: 'type must be customer | project | report' });
    if (!q) return res.json({ type, results: [] });

    if (type === 'customer') {
      const customers = await prisma.customer.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        orderBy: { name: 'asc' },
        take: limit,
        select: {
          id: true, name: true, status: true, tier: true, address: true,
          _count: { select: { projectLinks: true, visitReports: true } },
        },
      });
      return res.json({
        type,
        results: customers.map((c) => ({
          id: c.id, name: c.name, status: c.status, tier: c.tier, address: c.address,
          projectCount: c._count.projectLinks, reportCount: c._count.visitReports,
        })),
      });
    }

    if (type === 'project') {
      // Reuse the thread aggregation (carries tracking + linked customers).
      const threads = await listProjectThreads(req.user.userId, { q });
      return res.json({
        type,
        results: threads.slice(0, limit).map((t) => ({
          threadKey: t.threadKey,
          projectName: t.projectName,
          purchaser: t.purchaser,
          region: t.region,
          equipmentType: t.equipmentType,
          bidStage: t.currentStage,
          deadline: t.deadline,
          winner: t.winner,
          tracking: t.tracking ? { ourStatus: t.tracking.ourStatus } : null,
          customers: t.customers || [],
        })),
      });
    }

    // type === 'report'
    const reports = await prisma.visitReport.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { rawNotes: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { visitDate: 'desc' },
      take: limit,
      select: {
        id: true, title: true, visitDate: true, summary: true, status: true, threadKey: true,
        customer: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
      },
    });
    return res.json({ type, results: reports });
  } catch (error) {
    console.error('Error in unified search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
