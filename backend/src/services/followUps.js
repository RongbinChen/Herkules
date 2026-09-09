// Project follow-up: the execution side of a won order, and the reminders that
// keep its dates from slipping past unnoticed.
//
// The catalogue below is the single source of truth for what a milestone is
// called and how early it wants chasing. The routes, the mail and the frontend
// all read from the same shape (the frontend keeps its own copy of the labels
// for rendering; the defaults that matter — the reminder lead times — live
// here, on the server that sends the mail).
import { prisma } from '../index.js';
import { milestoneReminderMail } from './followUpMail.js';

// Ordered as the order actually runs. `lead` is the default reminder lead time
// in days; a record can override it per milestone.
export const MILESTONES = [
  { kind: 'CONTRACT_SIGNED',    en: 'Contract signed',            zh: '合同签署',        group: 'contract', lead: [7, 1] },
  { kind: 'CONTRACT_EFFECTIVE', en: 'Contract effective',         zh: '合同生效（定金到账）', group: 'contract', lead: [14, 7, 1] },
  // The buyer has to act on this one, so it wants the longest runway: by the
  // time it is a week out, chasing it is already an escalation.
  { kind: 'LC_OPEN_DEADLINE',   en: 'L/C to be opened by',        zh: '信用证开证截止',   group: 'lc', lead: [30, 14, 7, 1] },
  { kind: 'LC_RECEIVED',        en: 'L/C received & checked',     zh: '信用证收到并审核', group: 'lc', lead: [7, 1] },
  // Miss this and the credit is void — nothing else on the list is as final.
  { kind: 'LC_LATEST_SHIPMENT', en: 'Latest shipment date (L/C)', zh: '最晚装运期',      group: 'lc', lead: [30, 14, 7, 1] },
  { kind: 'LC_PRESENTATION',    en: 'Document presentation due',  zh: '交单期',          group: 'lc', lead: [7, 3, 1] },
  { kind: 'PAYMENT_DOWN',       en: 'Down payment received',      zh: '预付款到账',      group: 'money', lead: [14, 7, 1] },
  { kind: 'PAYMENT_SHIPMENT',   en: 'Shipment payment received',  zh: '发货款到账',      group: 'money', lead: [14, 7, 1] },
  { kind: 'PAYMENT_FINAL',      en: 'Final payment received',     zh: '尾款到账',        group: 'money', lead: [14, 7, 1] },
  { kind: 'GUARANTEE_EXPIRY',   en: 'Bank guarantee expires',     zh: '保函到期',        group: 'money', lead: [30, 14, 7] },
  { kind: 'DRAWING_APPROVAL',   en: 'Drawings / spec approved',   zh: '图纸/技术协议确认', group: 'exec', lead: [14, 7, 1] },
  { kind: 'FAT',                en: 'FAT (factory acceptance)',   zh: 'FAT 出厂验收',    group: 'exec', lead: [14, 7, 1] },
  { kind: 'SHIPMENT',           en: 'Shipment / customs',         zh: '装运 / 到港清关',  group: 'exec', lead: [14, 7, 1] },
  { kind: 'INSTALLATION',       en: 'Installation & commissioning', zh: '安装调试',      group: 'exec', lead: [14, 7, 1] },
  { kind: 'FAC',                en: 'FAC (final acceptance)',     zh: 'FAC 终验收',      group: 'exec', lead: [14, 7, 1] },
  { kind: 'WARRANTY_EXPIRY',    en: 'Warranty expires',           zh: '质保到期',        group: 'exec', lead: [30, 7] },
];

export const MILESTONE_BY_KIND = new Map(MILESTONES.map((m) => [m.kind, m]));
export const MILESTONE_KINDS = new Set(MILESTONES.map((m) => m.kind));

// The company works on China time. A date-only milestone is a day in Beijing,
// not a moment in UTC, or a deadline on the 30th starts reminding on the 29th
// for anyone reading before 08:00.
const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
export const chinaDay = (d = new Date()) => CN_DATE.format(d);
const daysBetween = (fromDay, toDay) =>
  Math.round((new Date(`${toDay}T00:00:00Z`) - new Date(`${fromDay}T00:00:00Z`)) / 86400000);

/**
 * Should this milestone be chased today, and with what urgency?
 * Returns null when it should not.
 *
 * Overdue is capped at one mail every three days rather than daily: a date that
 * slipped by a month is not thirty times more urgent, and a mail that arrives
 * every morning stops being read within a week — which would also bury the
 * milestones that are still in time.
 */
export function reminderDue(milestone, today = chinaDay()) {
  if (!milestone.dueDate || milestone.doneAt) return null;
  const due = chinaDay(milestone.dueDate);
  const delta = daysBetween(today, due); // >0 upcoming, 0 today, <0 overdue
  if (milestone.lastRemindedOn === today) return null; // one mail per day, at most

  if (delta === 0) return { urgency: 'today', delta };
  if (delta > 0) {
    const lead = milestone.remindDaysBefore?.length ? milestone.remindDaysBefore : [];
    return lead.includes(delta) ? { urgency: 'upcoming', delta } : null;
  }
  // Overdue: day 1 always, then every third day.
  const overdueDays = -delta;
  return overdueDays === 1 || overdueDays % 3 === 0 ? { urgency: 'overdue', delta } : null;
}

// ── Who hears about it ───────────────────────────────────────────────────────
// The assigned person is the addressee; the sales lead is copied so nothing
// depends on one person reading their mail; the managing director is blind
// copied so the copy list a customer-facing colleague sees stays short.
//
// Names are resolved against the user table so a change of address is one
// profile edit, and the env vars exist for the case where the person is not a
// user of this system at all.
const CC_NAME = process.env.FOLLOWUP_CC_NAME || 'Stefan Elze';
const BCC_NAME = process.env.FOLLOWUP_BCC_NAME || 'Rongbin Chen';

async function emailForName(name) {
  const u = await prisma.user.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { email: true },
  });
  return u?.email || null;
}

export async function reminderRecipients(ownerEmail) {
  const [cc, bcc] = await Promise.all([
    process.env.FOLLOWUP_CC_EMAIL || emailForName(CC_NAME),
    process.env.FOLLOWUP_BCC_EMAIL || emailForName(BCC_NAME),
  ]);
  // Never copy someone on their own mail — a person who is both the assignee
  // and the sales lead would otherwise get it twice.
  const drop = (addr) => (addr && addr.toLowerCase() !== (ownerEmail || '').toLowerCase() ? addr : null);
  return { cc: drop(cc), bcc: drop(bcc) };
}

/**
 * Daily sweep: every open milestone with a date, on an active follow-up.
 * Called from the 08:00 China-time cron alongside the other reminders.
 */
export async function checkFollowUpMilestones() {
  const today = chinaDay();
  const milestones = await prisma.followUpMilestone.findMany({
    where: {
      doneAt: null,
      dueDate: { not: null },
      followUp: { status: 'ACTIVE' },
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      followUp: {
        include: {
          owner: { select: { id: true, name: true, email: true } },
          customer: { select: { name: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const m of milestones) {
    const due = reminderDue(m, today);
    if (!due) continue;

    // The milestone's own owner wins when it has one — payments are chased by
    // finance even on a project that belongs to sales.
    const person = m.owner || m.followUp.owner;
    const meta = MILESTONE_BY_KIND.get(m.kind);

    // The bell entry goes out even with no email configured and no assignee,
    // because the record still moved; the mail needs somebody to address.
    if (person?.id) {
      await prisma.notification.create({
        data: {
          userId: person.id,
          type: 'STATUS_CHANGE',
          projectId: null,
          message: `📌 ${m.followUp.title} — ${m.label || meta?.zh || m.kind}：${
            due.urgency === 'overdue' ? `已逾期 ${-due.delta} 天` : due.urgency === 'today' ? '今天到期' : `还有 ${due.delta} 天`
          }`,
        },
      }).catch((e) => console.error('[followups] notification failed:', e.message));
    }

    if (person?.email) {
      const { cc, bcc } = await reminderRecipients(person.email);
      await milestoneReminderMail({
        to: person.email, cc, bcc, milestone: m, followUp: m.followUp, meta, due,
      });
    }

    // Stamped whether or not a mail went out: the point of the stamp is "this
    // milestone has been handled for today", and retrying a failed send on the
    // next sweep would mean a burst of mail the moment SMTP recovers.
    await prisma.followUpMilestone.update({
      where: { id: m.id },
      data: { lastRemindedOn: today },
    });
    sent++;
  }
  if (sent) console.log(`[followups] ${sent} milestone reminder(s) sent for ${today}`);
  return sent;
}
