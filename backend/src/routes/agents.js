import express from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const agentSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  contactPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  region: z.string().optional(),
  notes: z.string().optional(),
});

// Get all agents
router.get('/', authenticateToken, async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { events: true } } },
    });
    res.json(agents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Get a single agent (with related events)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: parseInt(req.params.id, 10) },
      include: {
        events: {
          orderBy: { start: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Create agent
router.post('/', authenticateToken, async (req, res) => {
  try {
    const data = agentSchema.parse(req.body);
    const agent = await prisma.agent.create({ data });
    res.status(201).json(agent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// Update agent
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = agentSchema.parse(req.body);
    const existing = await prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const updated = await prisma.agent.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Delete agent (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin !== true) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = parseInt(req.params.id, 10);
    // Detach related events first — Event.agentId is a restrict FK, so a hard
    // delete would otherwise fail for any agent linked to events.
    await prisma.event.updateMany({ where: { agentId: id }, data: { agentId: null } });
    await prisma.agent.delete({ where: { id } });
    res.json({ message: 'Agent deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

export default router;
