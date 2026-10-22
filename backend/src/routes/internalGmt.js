// Read-only customer list for GMT service dispatch.
// Machine auth via GMT_CUSTOMER_SYNC_TOKEN (X-GMT-Token). No user session.
import express from 'express';
import { timingSafeEqual } from 'crypto';
import { prisma } from '../index.js';

const router = express.Router();

function requireGmtToken(req, res, next) {
  const expected = process.env.GMT_CUSTOMER_SYNC_TOKEN;
  if (!expected || expected.length < 16) {
    console.warn('[gmt-sync] request but GMT_CUSTOMER_SYNC_TOKEN is not configured');
    return res.status(503).json({ error: 'gmt sync not configured' });
  }
  const got = String(req.get('X-GMT-Token') || '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn(`[gmt-sync] rejected: bad token from ${req.ip}`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Slim payload for the GMT「客户现场」dropdown. Herkules remains source of truth;
// GMT only reads and snapshots onto its own Site rows.
router.get('/customers', requireGmtToken, async (_req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { status: { in: ['LEAD', 'ACTIVE', 'INACTIVE'] } },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        contactName: true,
        contactPhone: true,
        status: true,
        tier: true,
      },
    });
    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        address: c.address || '',
        contactName: c.contactName || '',
        contactPhone: c.contactPhone || '',
        status: c.status,
        tier: c.tier,
      })),
    });
  } catch (error) {
    console.error('[gmt-sync] customers failed:', error);
    res.status(500).json({ error: 'Failed to list customers' });
  }
});

export default router;
