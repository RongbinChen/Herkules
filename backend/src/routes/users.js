import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { dismissAdminNoticeForUser, getVisibleAdminNoticesForUser } from '../services/adminNotices.js';

const router = express.Router();
const prisma = new PrismaClient();

const createUserSchema = z.object({
  email: z.string().min(1, 'Username is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required'),
  isAdmin: z.boolean().default(false),
});

const updateUserSchema = z.object({
  email: z.string().min(1, 'Username is required').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
  name: z.string().min(1, 'Name is required').optional(),
  isAdmin: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const updateMeSchema = z.object({
  email: z.string().min(1, 'Username is required').optional(),
  name: z.string().min(1, 'Name is required').optional(),
  currentPassword: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
}).refine((data) => !data.password || Boolean(data.currentPassword), {
  message: 'Current password is required to set a new password',
  path: ['currentPassword'],
});

function requireAdmin(req, res) {
  if (req.user.isAdmin !== true) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }

  return true;
}

function getBaseUrl(req) {
  const origin = req.get('origin');
  if (origin && /^https?:\/\//.test(origin)) {
    return origin;
  }

  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

function buildCalendarFeedUrls(req, token) {
  const baseUrl = getBaseUrl(req);
  const feedPath = `/api/events/feed/${token}.ics`;

  return {
    token,
    feedUrl: `${baseUrl}${feedPath}`,
    webcalUrl: `webcal://${req.get('host')}${feedPath}`,
    downloadUrl: `${baseUrl}${feedPath}?download=1`,
  };
}

async function ensureCalendarFeedToken(userId) {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      calendarFeedToken: true,
    },
  });

  if (!currentUser) {
    return null;
  }

  if (currentUser.calendarFeedToken) {
    return currentUser;
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      calendarFeedToken: crypto.randomUUID(),
    },
    select: {
      id: true,
      name: true,
      email: true,
      calendarFeedToken: true,
    },
  });
}

async function ensureCalendarFeedTokensForUsers(userIds) {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      calendarFeedToken: true,
    },
    orderBy: { name: 'asc' },
  });

  const missingIds = users.filter((user) => !user.calendarFeedToken).map((user) => user.id);
  if (missingIds.length > 0) {
    await Promise.all(
      missingIds.map((id) =>
        prisma.user.update({
          where: { id },
          data: {
            calendarFeedToken: crypto.randomUUID(),
          },
        })
      )
    );
  }

  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      calendarFeedToken: true,
    },
    orderBy: { name: 'asc' },
  });
}

router.get('/visible', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch visible users' });
  }
});

// Get all users (for admin to see all calendars)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
        _count: {
          select: {
            events: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/activity-summary', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        events: {
          where: {
            end: { gte: weekStart },
          },
          orderBy: { start: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const summary = users.map((user) => {
      const events = user.events;
      const active = events.find((event) => event.status === 'IN_PROGRESS');
      const blockedCount = events.filter((event) => event.status === 'BLOCKED').length;
      const plannedCount = events.filter((event) => event.status === 'PLANNED').length;
      const doneCount = events.filter((event) => event.status === 'DONE').length;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        activeStatus: active?.status || (blockedCount > 0 ? 'BLOCKED' : plannedCount > 0 ? 'PLANNED' : 'DONE'),
        focusLabel: active?.title || events[0]?.title || 'No activity scheduled',
        blockedCount,
        plannedCount,
        doneCount,
        totalThisWeek: events.length,
      };
    });

    res.json(summary);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch activity summary' });
  }
});

router.put('/me', authenticateToken, async (req, res) => {
  try {
    const data = updateMeSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (data.email && data.email !== existingUser.email) {
      const duplicateUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (duplicateUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    if (data.password) {
      const validPassword = await bcrypt.compare(data.currentPassword, existingUser.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        ...(data.email ? { email: data.email } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.password ? { password: await bcrypt.hash(data.password, 10) } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
      },
    });

    res.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/me/calendar-feed', authenticateToken, async (req, res) => {
  try {
    const currentUser = await ensureCalendarFeedToken(req.user.userId);

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      userId: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      ...buildCalendarFeedUrls(req, currentUser.calendarFeedToken),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load calendar feed' });
  }
});

router.get('/me/admin-notices', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const notices = await getVisibleAdminNoticesForUser(req.user.userId);
    res.json(notices);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load admin notices' });
  }
});

router.post('/me/admin-notices/:noticeId/dismiss', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    await dismissAdminNoticeForUser(req.params.noticeId, req.user.userId);
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to dismiss admin notice' });
  }
});

router.post('/me/calendar-feed/rotate', authenticateToken, async (req, res) => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        calendarFeedToken: crypto.randomUUID(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        calendarFeedToken: true,
      },
    });

    res.json({
      userId: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      ...buildCalendarFeedUrls(req, updatedUser.calendarFeedToken),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to rotate calendar feed' });
  }
});

router.get('/calendar-feeds', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const visibleUsers = await prisma.user.findMany({
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    const users = await ensureCalendarFeedTokensForUsers(visibleUsers.map((user) => user.id));

    res.json(
      users.map((user) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        ...buildCalendarFeedUrls(req, user.calendarFeedToken),
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load team calendar feeds' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const { email, password, name, isAdmin } = createUserSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        isAdmin,
        calendarFeedToken: crypto.randomUUID(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
        _count: {
          select: {
            events: true,
          },
        },
      },
    });

    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const userId = Number.parseInt(req.params.id, 10);
    const data = updateUserSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.userId === userId && data.isAdmin === false) {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }

    if (data.email && data.email !== existingUser.email) {
      const duplicateUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (duplicateUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    const updateData = {
      ...(data.email ? { email: data.email } : {}),
      ...(data.name ? { name: data.name } : {}),
      ...(typeof data.isAdmin === 'boolean' ? { isAdmin: data.isAdmin } : {}),
      ...(data.password ? { password: await bcrypt.hash(data.password, 10) } : {}),
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
        _count: {
          select: {
            events: true,
          },
        },
      },
    });

    res.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const userId = Number.parseInt(req.params.id, 10);

    if (req.user.userId === userId) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
