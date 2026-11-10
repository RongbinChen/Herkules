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
import {
  chinaDay,
  reminderDue,
  resolveReminderRecipients,
} from './followUpReminder.js';

export { chinaDay, milestoneStanding, reminderDue } from './followUpReminder.js';

// Ordered as the order actually runs. `lead` is the default reminder lead time
// in days; a record can override it per milestone.
//
// The UI reads `en`. `zh` is kept because the reminder mail is bilingual, like
// every other mail this system sends — the people chasing a letter of credit
// are on both sides of that language.
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

// ── Who hears about it ───────────────────────────────────────────────────────
// The assigned person is the addressee. Nobody is copied by default — an
// optional CC is only FOLLOWUP_CC_EMAIL, or the user named by FOLLOWUP_CC_NAME.
// The managing director stays on bcc, so the copy list a customer-facing
// colleague sees stays short.
//
// Names are resolved against the user table so a change of address is one
// profile edit, and the env vars exist for the case where the person is not a
// user of this system at all.
async function emailForName(name) {
  if (!name) return null;
  const u = await prisma.user.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { email: true },
  });
  return u?.email || null;
}

export async function reminderRecipients(ownerEmail, env = process.env) {
  return resolveReminderRecipients(ownerEmail, env, emailForName);
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
        // Named scalars only. The contract value is not part of a reminder,
        // and a bare include would put it on the object the mail is built from.
        select: {
          id: true, title: true, orderNo: true,
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
          message: `📌 ${m.followUp.title} — ${m.label || meta?.en || m.kind}: ${
            due.urgency === 'overdue' ? `${-due.delta} day(s) overdue` : due.urgency === 'today' ? 'due today' : `due in ${due.delta} day(s)`
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
