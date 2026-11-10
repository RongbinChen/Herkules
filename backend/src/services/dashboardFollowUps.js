// Home-page strip for live project follow-ups.
//
// This reads dates already stored on FollowUpMilestone. It does not suggest,
// shift, or recompute a timeline. That calculation lives in contractTimeline
// and is changing separately (L/C nodes from the commercial contract only,
// a theoretical down-payment date that still needs a person to confirm, and
// a delivery-period start that is per contract). When those dates land on
// the milestone rows, this strip picks them up with no further change.
//
// Visibility matches the follow-up list: any signed-in user may see the
// order and its dates. The contract value is never copied onto this payload,
// even for someone who would be allowed to see it on the record itself.
// Contract filenames stay behind the team PIN and are not loaded here.

export const DASHBOARD_FOLLOWUP_LIMIT = 8;
// A machine-tool order is still "recently signed" through manufacture and
// shipment. Older live orders stay off the home page unless a date is
// actually coming up — completed history never comes back here.
export const SIGNED_WINDOW_MONTHS = 18;
// Overdue, or due inside this many days, is worth a glance even when the
// signature itself is older than the window above.
export const ACTION_WINDOW_DAYS = 60;
const DATE_CAP = 4;

const SHORT_LABEL = {
  CONTRACT_SIGNED: 'Signed',
  CONTRACT_EFFECTIVE: 'Effective',
  LC_OPEN_DEADLINE: 'L/C open',
  LC_RECEIVED: 'L/C check',
  LC_LATEST_SHIPMENT: 'Latest ship',
  LC_PRESENTATION: 'Docs due',
  PAYMENT_DOWN: 'Down payment',
  PAYMENT_SHIPMENT: 'Ship payment',
  PAYMENT_FINAL: 'Final payment',
  GUARANTEE_EXPIRY: 'Guarantee',
  DRAWING_APPROVAL: 'Drawings',
  FAT: 'FAT',
  SHIPMENT: 'Shipment',
  INSTALLATION: 'Install',
  FAC: 'FAC',
  WARRANTY_EXPIRY: 'Warranty',
};

const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });

// A date-only string is already the calendar day someone typed. A timestamp
// is a China day, same as the follow-up page, so a midnight-in-Beijing
// deadline does not slip to the day before.
export function isoDay(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return CN_DATE.format(d);
}

export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const monthIndex = (m - 1) + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);
}

function signedOn(row) {
  const signed = (row.milestones || []).find((m) => m.kind === 'CONTRACT_SIGNED');
  return isoDay(signed?.dueDate) || isoDay(signed?.doneAt) || isoDay(row.createdAt);
}

function openDated(row, today) {
  return (row.milestones || [])
    .filter((m) => !m.doneAt && isoDay(m.dueDate))
    .map((m) => {
      const day = isoDay(m.dueDate);
      return { ...m, day, delta: daysBetween(today, day) };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || (a.id || 0) - (b.id || 0));
}

function cueFor(delta) {
  if (delta < 0) return { cue: `${-delta}d over`, tone: 'overdue' };
  if (delta === 0) return { cue: 'Today', tone: 'today' };
  if (delta <= 14) return { cue: `in ${delta}d`, tone: 'soon' };
  return { cue: `in ${delta}d`, tone: 'later' };
}

function personName(milestone, row) {
  return milestone?.owner?.name || row.owner?.name || null;
}

function included(row, today) {
  if (row.status !== 'ACTIVE' && row.status !== 'ON_HOLD') return false;
  const signed = signedOn(row);
  if (signed && signed >= addMonths(today, -SIGNED_WINDOW_MONTHS)) return true;
  return openDated(row, today).some((m) => m.delta <= ACTION_WINDOW_DAYS);
}

function present(row, today) {
  const open = openDated(row, today);
  const dates = open.slice(0, DATE_CAP).map((m) => ({
    kind: m.kind,
    label: m.label || m.en || m.kind,
    zh: m.zh || null,
    short: SHORT_LABEL[m.kind] || m.label || m.en || m.kind,
    dueDate: m.day,
    ownerName: personName(m, row),
    ...cueFor(m.delta),
  }));
  return {
    id: row.id,
    title: row.title || '',
    orderNo: row.orderNo || null,
    status: row.status,
    customerName: row.customer?.name || row.customerName || null,
    ownerName: row.owner?.name || null,
    signedOn: signedOn(row),
    overdueCount: open.filter((m) => m.delta < 0).length,
    next: dates[0] || null,
    dates,
    moreDates: Math.max(0, open.length - dates.length),
  };
}

function compare(a, b) {
  const aOver = a.overdueCount > 0;
  const bOver = b.overdueCount > 0;
  if (aOver !== bOver) return aOver ? -1 : 1;
  const ad = a.next?.dueDate || '9999-99-99';
  const bd = b.next?.dueDate || '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const as = a.signedOn || '0000-00-00';
  const bs = b.signedOn || '0000-00-00';
  if (as !== bs) return as > bs ? -1 : 1;
  return b.id - a.id;
}

/**
 * Live, recently signed follow-ups, shaped for the dashboard strip.
 * @returns {{ items: object[], total: number }}
 */
export function selectDashboardFollowUps(rows, { today } = {}) {
  const day = isoDay(today) || isoDay(new Date());
  const matched = (rows || []).filter((row) => included(row, day)).map((row) => present(row, day));
  matched.sort(compare);
  return {
    items: matched.slice(0, DASHBOARD_FOLLOWUP_LIMIT),
    total: matched.length,
  };
}
