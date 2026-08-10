// Everyday reminders that land in the notification bell.
//
// Two deliberate constraints shape this file:
//
// 1. No new NotificationType values. Adding one changes schema.prisma, which
//    aborts the deploy and forces a manual pass over the VPS. The bell renders
//    `message` verbatim, so an emoji at the front of the text separates these
//    from tender alerts just as well as a distinct icon would. Nothing filters
//    by type today, so the only thing lost is a query axis nobody uses.
//
// 2. `projectId` is a foreign key to BidProject, so it stays null here. The UI
//    already guards for that (`n.project?.sourceUrl`), and a null just means
//    clicking the row marks it read instead of opening a tender.
//
// Volume is the real design risk. A bell that fires eight times a day gets
// ignored, and then the alarms hiding among them get ignored too. Every check
// below is either once per event or once per day per person.
import { prisma } from '../index.js';

// The company works on China time; "tomorrow" has to mean tomorrow in Beijing,
// not tomorrow in UTC, or a trip starting Monday 08:00 gets announced on Sunday
// morning for people whose Sunday has not ended yet.
const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });

function chinaDayRange(offsetDays = 0) {
  const base = new Date(Date.now() + offsetDays * 86400000);
  const day = CN_DATE.format(base); // YYYY-MM-DD
  return {
    day,
    start: new Date(`${day}T00:00:00+08:00`),
    end: new Date(`${day}T23:59:59.999+08:00`),
  };
}

// Same message to the same person twice is the fastest way to train someone to
// stop looking. Cheap guard: has this exact line already gone out recently?
async function alreadySent(userId, message, withinHours = 36) {
  const dup = await prisma.notification.findFirst({
    where: { userId, message, createdAt: { gt: new Date(Date.now() - withinHours * 3600000) } },
    select: { id: true },
  });
  return Boolean(dup);
}

async function send(rows) {
  const fresh = [];
  for (const r of rows) {
    if (!(await alreadySent(r.userId, r.message))) fresh.push({ ...r, type: 'STATUS_CHANGE', projectId: null });
  }
  if (fresh.length === 0) return 0;
  const res = await prisma.notification.createMany({ data: fresh });
  return res.count;
}

/**
 * Trips starting tomorrow, to whoever is going and whoever planned it.
 * Runs once a day, and a given trip is only ever "tomorrow" on one of them.
 */
export async function checkTripsTomorrow() {
  const { day, start, end } = chinaDayRange(1);
  const trips = await prisma.trip.findMany({
    where: { startTime: { gte: start, lte: end } },
    select: { id: true, title: true, createdById: true, assignees: { select: { id: true } } },
  });

  const rows = [];
  for (const t of trips) {
    const people = new Set([t.createdById, ...t.assignees.map((a) => a.id)]);
    for (const userId of people) {
      rows.push({ userId, message: `📅 明天出发：${t.title.slice(0, 80)}（${day}）` });
    }
  }
  const count = await send(rows);
  if (count) console.log(`[reminders] ${trips.length} 个行程明天出发，发出 ${count} 条通知`);
  return count;
}

/**
 * Somebody logged a note on a customer you have worked with.
 *
 * There is no owner field on Customer, so "your customer" has to be inferred.
 * The proxy used here is prior involvement: anyone who has written a note or a
 * visit report for this customer. People actually following an account leave
 * that trail, and it costs no schema change. The note's author is excluded —
 * nobody needs to be told what they just did.
 *
 * Event-driven rather than daily, because the point is that a colleague can
 * react while it is still fresh.
 */
export async function notifyCustomerNote({ customerId, authorId, content }) {
  const [customer, notes, reports, author] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }),
    prisma.customerNote.findMany({ where: { customerId }, select: { authorId: true }, distinct: ['authorId'] }),
    prisma.visitReport.findMany({ where: { customerId }, select: { authorId: true }, distinct: ['authorId'] }),
    prisma.user.findUnique({ where: { id: authorId }, select: { name: true } }),
  ]);
  if (!customer) return 0;

  const audience = new Set([...notes.map((n) => n.authorId), ...reports.map((r) => r.authorId)]);
  audience.delete(authorId);
  audience.delete(null);
  if (audience.size === 0) return 0;

  const who = author?.name || '有人';
  const snippet = content.replace(/\s+/g, ' ').slice(0, 50);
  const message = `📝 ${who} 在 ${customer.name.slice(0, 30)} 下写了一条记录：${snippet}`;
  // Not deduped by `send`'s window: two different notes on one customer are two
  // real events, and their snippets differ anyway.
  const res = await prisma.notification.createMany({
    data: [...audience].map((userId) => ({ userId, type: 'STATUS_CHANGE', projectId: null, message })),
  });
  return res.count;
}
