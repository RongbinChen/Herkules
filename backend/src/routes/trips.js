import express from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const stopInputSchema = z.object({
  customerId: z.number().int(),
  order: z.number().int().optional(),
  plannedArrival: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const tripSchema = z
  .object({
    title: z.string().min(1),
    notes: z.string().optional(),
    startTime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid startTime'),
    endTime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid endTime'),
    assigneeId: z.number().int().nullable().optional(),
    hidePhoneOnShare: z.boolean().optional(),
    // Provide either customerIds (auto-ordered by distance) OR explicit stops
    // (manual order + arrival times). stops wins when both are present.
    customerIds: z.array(z.number().int()).optional(),
    stops: z.array(stopInputSchema).optional(),
  })
  .refine((d) => (d.customerIds && d.customerIds.length) || (d.stops && d.stops.length), {
    message: 'Provide at least one customer (customerIds or stops)',
  });

// ── Geographic helpers ───────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hasCoords = (c) =>
  typeof c.latitude === 'number' && typeof c.longitude === 'number';

// Order customers into a short visiting route via nearest-neighbour, starting
// from the first selected customer with coordinates. Customers without
// coordinates are appended at the end (can't be routed).
function orderByNearestNeighbour(customers) {
  const located = customers.filter(hasCoords);
  const unlocated = customers.filter((c) => !hasCoords(c));
  if (located.length <= 2) return [...located, ...unlocated];

  const remaining = [...located];
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const current = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...ordered, ...unlocated];
}

// Suggest an arrival time per stop by spreading them evenly across the window.
function plannedArrivalFor(index, count, start, end) {
  if (count <= 1) return start;
  const span = end.getTime() - start.getTime();
  return new Date(start.getTime() + (span * index) / count);
}

function shareToken() {
  return randomBytes(20).toString('hex');
}

// Build stop rows by auto-ordering a set of customer ids (nearest-neighbour)
// and spreading arrival times evenly across the window.
async function buildAutoStops(customerIds, start, end) {
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, latitude: true, longitude: true },
  });
  const ordered = orderByNearestNeighbour(customers);
  return ordered.map((c, i) => ({
    customerId: c.id,
    order: i,
    plannedArrival: plannedArrivalFor(i, ordered.length, start, end),
  }));
}

// Build stop rows from an explicit, user-arranged list: honour the given order
// and arrival times. Reindex order to 0..n-1, drop ids that no longer exist.
async function buildManualStops(stops) {
  const ids = stops.map((s) => s.customerId);
  const existing = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const valid = new Set(existing.map((c) => c.id));
  const sorted = stops
    .filter((s) => valid.has(s.customerId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map((s, i) => ({
    customerId: s.customerId,
    order: i,
    plannedArrival:
      s.plannedArrival && !Number.isNaN(Date.parse(s.plannedArrival))
        ? new Date(s.plannedArrival)
        : null,
    notes: s.notes ?? null,
  }));
}

// Pick the right builder: explicit stops (manual) take precedence.
async function buildStops(data, start, end) {
  if (data.stops && data.stops.length) return buildManualStops(data.stops);
  return buildAutoStops(data.customerIds, start, end);
}

const stopInclude = {
  stops: {
    orderBy: { order: 'asc' },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          address: true,
          contactName: true,
          contactPhone: true,
          latitude: true,
          longitude: true,
          status: true,
          tier: true,
        },
      },
    },
  },
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
};

// ── Public share endpoint (NO auth) ──────────────────────────────────────────
// Defined before the authenticated routes. Anyone with the token can view the
// itinerary without logging in.
router.get('/share/:token', async (req, res) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { shareToken: req.params.token },
      select: {
        id: true,
        title: true,
        notes: true,
        startTime: true,
        endTime: true,
        hidePhoneOnShare: true,
        assignee: { select: { name: true } },
        stops: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            plannedArrival: true,
            notes: true,
            customer: {
              select: {
                id: true,
                name: true,
                address: true,
                contactName: true,
                contactPhone: true,
                latitude: true,
                longitude: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    // Strip contact phone from the public payload when the trip opts to hide it.
    if (trip.hidePhoneOnShare) {
      trip.stops.forEach((s) => {
        if (s.customer) s.customer.contactPhone = null;
      });
    }
    res.json(trip);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load shared trip' });
  }
});

// ── Authenticated CRUD ───────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const trips = await prisma.trip.findMany({
      orderBy: { startTime: 'desc' },
      include: {
        assignee: { select: { id: true, name: true } },
        _count: { select: { stops: true } },
      },
    });
    res.json(trips);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: parseInt(req.params.id, 10) },
      include: stopInclude,
    });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    res.json(trip);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const data = tripSchema.parse(req.body);
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (end <= start) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }
    const stops = await buildStops(data, start, end);
    if (stops.length === 0) {
      return res.status(400).json({ error: 'No valid customers selected' });
    }
    const trip = await prisma.trip.create({
      data: {
        title: data.title,
        notes: data.notes,
        startTime: start,
        endTime: end,
        assigneeId: data.assigneeId ?? null,
        hidePhoneOnShare: data.hidePhoneOnShare ?? false,
        createdById: req.user.userId,
        shareToken: shareToken(),
        stops: { create: stops },
      },
      include: stopInclude,
    });
    res.status(201).json(trip);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = tripSchema.parse(req.body);
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (end <= start) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }
    const existing = await prisma.trip.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    const stops = await buildStops(data, start, end);
    // Rebuild stops to reflect the new selection / ordering.
    const trip = await prisma.$transaction(async (tx) => {
      await tx.tripStop.deleteMany({ where: { tripId: id } });
      return tx.trip.update({
        where: { id },
        data: {
          title: data.title,
          notes: data.notes,
          startTime: start,
          endTime: end,
          assigneeId: data.assigneeId ?? null,
          hidePhoneOnShare: data.hidePhoneOnShare ?? false,
          stops: { create: stops },
        },
        include: stopInclude,
      });
    });
    res.json(trip);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update trip' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.trip.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ message: 'Trip deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete trip' });
  }
});

export default router;
