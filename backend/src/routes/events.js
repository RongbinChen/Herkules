import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

const dateInput = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date value',
});

const eventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  start: dateInput,
  end: dateInput,
  allDay: z.boolean().default(false),
  color: z.string().optional(),
  location: z.string().optional(),
  category: z.enum(['WORK_SESSION', 'MEETING', 'SALES_MEETING', 'FIELD_WORK', 'BREAK', 'TRAINING', 'LEAVE']).default('WORK_SESSION'),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED']).default('PLANNED'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  userId: z.number().int().optional(),
});

function escapeIcsText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatUtcDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function formatAllDayDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildIcsEvent(event, calendarName) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:event-${event.id}@calendar-app`,
    `DTSTAMP:${formatUtcDate(new Date(event.updatedAt || event.createdAt || new Date()))}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${formatAllDayDate(new Date(event.start))}`
      : `DTSTART:${formatUtcDate(new Date(event.start))}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${formatAllDayDate(new Date(new Date(event.end).getTime() + 24 * 60 * 60 * 1000))}`
      : `DTEND:${formatUtcDate(new Date(event.end))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description || 'No notes')}`,
    `STATUS:${event.status === 'DONE' ? 'COMPLETED' : 'CONFIRMED'}`,
    `CATEGORIES:${escapeIcsText(event.category)}`,
    `X-CALENDAR-OWNER:${escapeIcsText(event.user?.name || calendarName)}`,
    `X-ACTIVITY-PRIORITY:${escapeIcsText(event.priority)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function buildCalendarIcs({ calendarName, calendarDescription, events }) {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendar App//Operations Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-CALDESC:${escapeIcsText(calendarDescription)}`,
  ];

  const body = events.map((event) => buildIcsEvent(event, calendarName));

  return [...header, ...body, 'END:VCALENDAR'].join('\r\n');
}

function setCalendarHeaders(res, filename, download = false) {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${filename}"`
  );
  res.setHeader('Cache-Control', download ? 'no-store' : 'private, max-age=300');
}

async function loadUserCalendar(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      events: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { start: 'asc' },
      },
    },
  });

  if (!user) {
    return null;
  }

  const calendarName = `${user.name} Calendar`;
  const calendarDescription = `Read-only calendar feed for ${user.name}`;

  return {
    user,
    filename: `${user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'calendar'}.ics`,
    ics: buildCalendarIcs({
      calendarName,
      calendarDescription,
      events: user.events,
    }),
  };
}

router.get('/feed/:token.ics', async (req, res) => {
  try {
    const owner = await prisma.user.findUnique({
      where: { calendarFeedToken: req.params.token },
      select: { id: true },
    });

    if (!owner) {
      return res.status(404).json({ error: 'Calendar feed not found' });
    }

    const calendar = await loadUserCalendar(owner.id);
    if (!calendar) {
      return res.status(404).json({ error: 'Calendar feed not found' });
    }

    setCalendarHeaders(res, calendar.filename, req.query.download === '1');
    res.send(calendar.ics);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export calendar feed' });
  }
});

router.get('/export.ics', authenticateToken, async (req, res) => {
  try {
    const calendar = await loadUserCalendar(req.user.userId);

    if (!calendar) {
      return res.status(404).json({ error: 'Calendar feed not found' });
    }

    setCalendarHeaders(res, calendar.filename, true);
    res.send(calendar.ics);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export calendar' });
  }
});

// Get all events
router.get('/', authenticateToken, async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { start: 'asc' },
    });
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event
router.post('/', authenticateToken, async (req, res) => {
  try {
    const data = eventSchema.parse(req.body);
    const targetUserId = req.user.isAdmin === true && data.userId ? data.userId : req.user.userId;
    const event = await prisma.event.create({
      data: {
        ...data,
        start: new Date(data.start),
        end: new Date(data.end),
        userId: targetUserId,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = eventSchema.parse(req.body);
    const eventId = parseInt(id, 10);
    const isAdmin = req.user.isAdmin === true;

    const event = await prisma.event.findFirst({
      where: isAdmin ? { id: eventId } : { id: eventId, userId: req.user.userId },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...data,
        start: new Date(data.start),
        end: new Date(data.end),
        userId: isAdmin && data.userId ? data.userId : event.userId,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const eventId = parseInt(id, 10);
    const isAdmin = req.user.isAdmin === true;

    const event = await prisma.event.findFirst({
      where: isAdmin ? { id: eventId } : { id: eventId, userId: req.user.userId },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await prisma.event.delete({ where: { id: eventId } });
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

export default router;
