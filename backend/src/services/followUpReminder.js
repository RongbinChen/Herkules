// How a follow-up date stands on the China calendar, and which extra
// addresses a reminder may carry.
//
// The morning sweep (reminderDue) only mails on lead days, on the due day,
// and on the overdue cadence. A person sending the same mail by hand still
// needs the real standing — "due in 5 days" — on the days the sweep stays
// quiet. Those are two questions. A quiet day is not zero days left.
//
// No database and no mailer. followUps.js decides to send and looks up
// addresses; this file only answers the calendar and the copy list.

const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });

// The company works on China time. A date-only milestone is a day in Beijing,
// not a moment in UTC, or a deadline on the 30th starts reminding on the 29th
// for anyone reading before 08:00.
//
// A YYYY-MM-DD string is already that calendar day. A timestamp is formatted
// in Asia/Shanghai, so UTC midnight on the 15th stays the 15th and a moment
// after 16:00 UTC has already become the next Shanghai day.
export const chinaDay = (d = new Date()) => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return CN_DATE.format(d);
};

const daysBetween = (fromDay, toDay) =>
  Math.round((new Date(`${toDay}T00:00:00Z`) - new Date(`${fromDay}T00:00:00Z`)) / 86400000);

/**
 * Real standing of a milestone against a China calendar day.
 * Returns null only when there is no date. Done-ness and "already mailed
 * today" are send-policy, not standing: a manual send still has to say how
 * the date actually stands.
 *
 * delta is signed China days: >0 until due, 0 due today, <0 overdue.
 */
export function milestoneStanding(milestone, today = chinaDay()) {
  if (!milestone?.dueDate) return null;
  const due = chinaDay(milestone.dueDate);
  const delta = daysBetween(today, due);
  if (!Number.isFinite(delta)) return null;
  if (delta > 0) return { urgency: 'upcoming', delta };
  if (delta === 0) return { urgency: 'today', delta: 0 };
  return { urgency: 'overdue', delta };
}

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
  if (!milestone?.dueDate || milestone.doneAt) return null;
  if (milestone.lastRemindedOn === today) return null; // one mail per day, at most
  const standing = milestoneStanding(milestone, today);
  if (!standing) return null;

  if (standing.urgency === 'today') return standing;
  if (standing.urgency === 'upcoming') {
    // Empty list = only the day itself. The catalogue defaults are written
    // onto the row when it is created; this does not invent a lead time.
    const lead = milestone.remindDaysBefore?.length ? milestone.remindDaysBefore : [];
    return lead.includes(standing.delta) ? standing : null;
  }
  // Overdue: day 1 always, then every third day.
  const overdueDays = -standing.delta;
  return overdueDays === 1 || overdueDays % 3 === 0 ? standing : null;
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

// Optional CC. An address wins over a name. Neither means nobody is copied:
// there is no built-in default person on this mail.
export function optionalCcSpec(env = process.env) {
  const email = clean(env?.FOLLOWUP_CC_EMAIL);
  if (email) return { email, name: null };
  const name = clean(env?.FOLLOWUP_CC_NAME);
  if (name) return { email: null, name };
  return { email: null, name: null };
}

// Blind copy defaults to the managing director by name, looked up in the user
// table, unless FOLLOWUP_BCC_EMAIL supplies an address directly.
export function bccSpec(env = process.env) {
  const email = clean(env?.FOLLOWUP_BCC_EMAIL);
  if (email) return { email, name: null };
  return { email: null, name: clean(env?.FOLLOWUP_BCC_NAME) || 'Rongbin Chen' };
}

// Never copy someone on their own mail — the assignee would otherwise get it
// twice when they are also the blind-copy recipient.
export function chooseReminderRecipients(ownerEmail, cc, bcc) {
  const owner = clean(ownerEmail)?.toLowerCase() || '';
  const drop = (addr) => {
    const value = clean(addr);
    if (!value) return null;
    return value.toLowerCase() !== owner ? value : null;
  };
  return { cc: drop(cc), bcc: drop(bcc) };
}

// `lookup(name)` resolves a user to an email. A missing CC does not call it.
export async function resolveReminderRecipients(ownerEmail, env, lookup) {
  const source = env || process.env;
  const cc = optionalCcSpec(source);
  const bcc = bccSpec(source);
  const [ccAddr, bccAddr] = await Promise.all([
    cc.email || (cc.name ? lookup(cc.name) : null),
    bcc.email || lookup(bcc.name),
  ]);
  return chooseReminderRecipients(ownerEmail, ccAddr, bccAddr);
}
