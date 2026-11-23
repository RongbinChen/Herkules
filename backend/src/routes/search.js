// Unified command search — powers the /customer /project /report command box.
// One endpoint, three modes; each returns lightweight cards that link into the
// existing hub pages (customer detail, project tracking, visit reports).
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { listProjectThreads } from '../services/chinabidding.js';
import { withCanDelete } from '../services/visitReportAccess.js';
import { visibleWhere } from './hotProjects.js';
import {
  customerHref,
  reportHref,
  projectTrackingHref,
  tripHref,
  followUpHref,
  hotProjectHref,
} from '../services/assistantLinks.js';

const router = express.Router();
router.use(authenticateToken);

const TYPES = new Set(['customer', 'project', 'report', 'followup', 'trip', 'hot']);

router.get('/', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 12, 30);
    if (!TYPES.has(type)) return res.status(400).json({ error: 'type must be customer | project | report | followup | trip | hot' });
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
          href: customerHref(c.id),
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
          href: projectTrackingHref(t.threadKey),
        })),
      });
    }

    if (type === 'report') {
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
    return res.json({
      type,
      results: reports.map((report) => ({ ...withCanDelete(report, req.user), href: reportHref(report.id) })),
    });
    }

    if (type === 'followup') {
      const rows = await prisma.projectFollowUp.findMany({
        where: {
          AND: [
            { status: { in: ['ACTIVE', 'ON_HOLD'] } },
            {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { orderNo: { contains: q, mode: 'insensitive' } },
                { machineSerial: { contains: q, mode: 'insensitive' } },
                { customer: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true, title: true, orderNo: true, status: true, machineType: true,
          customer: { select: { id: true, name: true } },
          owner: { select: { name: true } },
        },
      });
      return res.json({
        type,
        results: rows.map((f) => ({
          id: f.id, title: f.title, orderNo: f.orderNo, status: f.status,
          machineType: f.machineType, customer: f.customer, owner: f.owner,
          href: followUpHref(f.id),
        })),
      });
    }

    if (type === 'trip') {
      const trips = await prisma.trip.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { stops: { some: { customer: { name: { contains: q, mode: 'insensitive' } } } } },
            { assignees: { some: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        },
        orderBy: { startTime: 'desc' },
        take: limit,
        select: {
          id: true, title: true, startTime: true, endTime: true,
          createdBy: { select: { name: true } },
          assignees: { select: { name: true } },
        },
      });
      return res.json({
        type,
        results: trips.map((t) => ({
          id: t.id, title: t.title, startTime: t.startTime, endTime: t.endTime,
          createdBy: t.createdBy, assignees: t.assignees, href: tripHref(t.id),
        })),
      });
    }

    if (type === 'hot') {
      const rows = await prisma.hotProject.findMany({
        where: {
          AND: [
            visibleWhere(req.user),
            { closedAt: null },
            {
              OR: [
                { customer: { contains: q, mode: 'insensitive' } },
                { requirements: { contains: q, mode: 'insensitive' } },
                { processor: { contains: q, mode: 'insensitive' } },
              ],
            },
          ],
        },
        orderBy: [{ priority: { sort: 'asc', nulls: 'last' } }, { sortNo: 'asc' }],
        take: limit,
        select: { id: true, category: true, customer: true, processor: true, machineType: true, priority: true },
      });
      return res.json({
        type,
        results: rows.map((h) => ({
          id: h.id, category: h.category, customer: h.customer, processor: h.processor,
          machineType: h.machineType, priority: h.priority, href: hotProjectHref(h.id),
        })),
      });
    }

    return res.status(400).json({ error: 'unknown type' });
  } catch (error) {
    console.error('Error in unified search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
