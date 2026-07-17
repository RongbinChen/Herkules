import express from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { randomBytes } from 'crypto';
import { geocodeAddress } from '../services/geocode.js';

const router = express.Router();

// Fill latitude/longitude from the address when coords weren't manually supplied.
// Best-effort — leaves existing coords unchanged if geocoding fails.
async function applyGeocode(data) {
  if (data.address && (data.latitude == null || data.longitude == null)) {
    try {
      const coords = await geocodeAddress(data.address);
      if (coords) {
        data.latitude = coords.latitude;
        data.longitude = coords.longitude;
      }
    } catch (err) {
      // DeepSeek down / out of balance — don't block saving the customer.
      console.warn('[customers] auto-geocode skipped:', err.message);
    }
  }
}

const customerSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'LOST']).optional(),
  tier: z.enum(['A', 'B', 'C']).optional(),
  tags: z.array(z.string()).optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().optional(),
        phone: z.string().optional(),
        title: z.string().optional(),
        email: z.string().optional(),
      }),
    )
    .optional(),
});

// Keep the flat contactName/contactPhone/email in sync with the first contact,
// so the list, map popups and share pages (which read those fields) show the
// primary contact.
function syncPrimaryContact(data) {
  if (Array.isArray(data.contacts)) {
    const primary = data.contacts.find((c) => c.name || c.phone || c.email) || {};
    data.contactName = primary.name || null;
    data.contactPhone = primary.phone || null;
    if (primary.email) data.email = primary.email;
  }
}

// On-demand geocode — called by the frontend "Update coordinates" button
router.post('/geocode', authenticateToken, async (req, res) => {
  const { address } = req.body;
  if (!address || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  try {
    const coords = await geocodeAddress(address.trim());
    if (!coords) {
      return res.status(404).json({ error: 'Could not determine coordinates for this address' });
    }
    res.json(coords);
  } catch (err) {
    // DeepSeek unavailable (out of balance / bad key / rate limit) — surface why.
    if (err.isDeepSeek) {
      return res.status(502).json({ error: err.message });
    }
    console.error('[customers] geocode error:', err.message);
    res.status(500).json({ error: 'Failed to geocode address' });
  }
});

// ── Customer share ───────────────────────────────────────────────────────────
// The public GET must be declared before "/:id" so "share" isn't parsed as an id.
const shareSchema = z.object({
  customerIds: z.array(z.number().int()).min(1),
  title: z.string().max(200).optional(),
});

// Create a share link from a (filtered) selection of customers.
router.post('/share', authenticateToken, async (req, res) => {
  try {
    const { customerIds, title } = shareSchema.parse(req.body);
    const share = await prisma.customerShare.create({
      data: { token: randomBytes(20).toString('hex'), title: title?.trim() || null, customerIds },
    });
    res.status(201).json({ token: share.token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// Public — anyone with the token sees the shared customer list (no auth). Contact
// phone / email / notes are intentionally stripped from the public payload.
router.get('/share/:token', async (req, res) => {
  try {
    const share = await prisma.customerShare.findUnique({ where: { token: req.params.token } });
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    const customers = await prisma.customer.findMany({
      where: { id: { in: share.customerIds } },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        status: true,
        tier: true,
        tags: true,
        contactName: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ title: share.title, createdAt: share.createdAt, count: customers.length, customers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load shared customers' });
  }
});

// Get all customers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { events: true } } },
    });
    res.json(customers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Get a single customer (with related events / visit history)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: parseInt(req.params.id, 10) },
      include: {
        events: {
          orderBy: { start: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// Create customer
router.post('/', authenticateToken, async (req, res) => {
  try {
    const data = customerSchema.parse(req.body);
    syncPrimaryContact(data);
    await applyGeocode(data);
    const customer = await prisma.customer.create({ data });
    res.status(201).json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update customer
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = customerSchema.parse(req.body);
    syncPrimaryContact(data);
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    await applyGeocode(data);
    const updated = await prisma.customer.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Delete customer (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin !== true) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = parseInt(req.params.id, 10);
    // Detach related events first — Event.customerId is a restrict FK, so a hard
    // delete would otherwise fail for any customer that has visit history.
    await prisma.event.updateMany({ where: { customerId: id }, data: { customerId: null } });
    await prisma.customer.delete({ where: { id } });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

export default router;
