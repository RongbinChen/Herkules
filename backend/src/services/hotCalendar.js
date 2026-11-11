// Hot-project mini calendar. Events are derived on read from current
// Chinabidding tracking and scrape rows for Hot Project customers. Project
// follow-up milestones (L/C, shipment, payment, and the rest of execution)
// belong to the follow-up module and are not read here. There is no
// calendar table to go stale: when a scrape moves a deadline, the next
// read already shows the new day.
//
// A Chinabidding tender is included only when its purchaser matches a
// human-confirmed alias of a customer who still has an open Hot Project.
// Matching is normalizeCompany equality, never a substring. The Hot
// Project's own name is not a match by itself — a search that merely
// contains "Waldrich" or "INNSE" has already pulled in the wrong
// companies, and this calendar does not repeat that. An unconfirmed alias
// does not match, and nothing here confirms an alias on its own.

import { normalizeCompany } from './companyName.js';

// Mirrors chinabidding.js STAGE_ORDER / roundOf. Copied rather than imported
// so this module does not pull the scraper (and, through it, the server).
const STAGE_ORDER = { TENDER: 0, CHANGE: 1, EVALUATION: 2, AWARD: 3 };
const ROUND_RE = /[（(](\d+)[)）]\s*$/;
const OPEN_STAGES = new Set(['TENDER', 'CHANGE']);
const FINISHED_TRACKING = new Set(['WON', 'LOST', 'ABANDONED']);

const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });

// A China calendar day. A date-only string is already that day (the way a
// person typed it, and the way date-only deadlines are stored at UTC
// midnight). An instant is formatted in Asia/Shanghai, so 16:00 UTC is the
// next morning in Beijing and lands on the next day.
export function chinaDay(value = new Date()) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return CN_DATE.format(date);
}

export function roundOf(name) {
  const m = ROUND_RE.exec(name || '');
  return m ? parseInt(m[1], 10) : 1;
}

// "Open-Time of Bids: 2026-11-25" as printed on a chinabidding detail page.
// The date is a China calendar day already; it is not re-zoned.
const OPEN_TIME_RE = /(?:Open[-\s]*Time of Bids|Time of Bid Opening|Bid Opening Time|开标时间)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/i;

export function extractBidOpenDay(text) {
  const m = OPEN_TIME_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

export function openingMatches(biddingNo, threadKey, projectCode) {
  const no = String(biddingNo || '').trim();
  if (!no) return false;
  return [threadKey, projectCode].some((key) => {
    const k = String(key || '').trim();
    return k && (no === k || no.startsWith(`${k}/`));
  });
}

function ms(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clip(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function groupAnnouncements(announcements) {
  const groups = new Map();
  for (const row of announcements || []) {
    const key = row.threadKey || `p:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// Same round restart as listProjectThreads: a higher "(n)" or a fresh TENDER
// after a later stage starts the lifecycle over. History stays on the old
// notices; the calendar only reads the current round.
export function threadState(announcements) {
  const sorted = [...(announcements || [])].sort((a, b) =>
    (ms(a.publishDate) - ms(b.publishDate)) ||
    (roundOf(a.projectName) - roundOf(b.projectName)) ||
    ((a.id || 0) - (b.id || 0)));
  let currentStage = null;
  let currentOrder = -1;
  let cycleStart = 0;
  let lastRound = 0;
  sorted.forEach((row, i) => {
    const round = roundOf(row.projectName);
    const isNewRound = lastRound > 0 && round > lastRound;
    if (round > lastRound) lastRound = round;
    const order = row.bidStage ? (STAGE_ORDER[row.bidStage] ?? -1) : -1;
    if (order === -1) return;
    if (isNewRound || (row.bidStage === 'TENDER' && currentOrder > STAGE_ORDER.TENDER)) {
      currentStage = row.bidStage;
      currentOrder = order;
      cycleStart = i;
    } else if (order > currentOrder) {
      currentOrder = order;
      currentStage = row.bidStage;
    }
  });
  return { announcements: sorted, currentStage, cycleStart };
}

function isOpenThread(state, tracking) {
  if (!OPEN_STAGES.has(state.currentStage)) return false;
  if (tracking && FINISHED_TRACKING.has(tracking.ourStatus)) return false;
  const latest = state.announcements[state.announcements.length - 1];
  // The latest notice of an open round. CLOSED / CANCELLED is how a tender
  // that never reached award still leaves the working set (a withdrawn bid,
  // or a PAST row the scraper stored as closed).
  const cycle = state.announcements.slice(state.cycleStart);
  const head = cycle[cycle.length - 1] || latest;
  if (head && (head.status === 'CLOSED' || head.status === 'CANCELLED')) return false;
  return true;
}

function purchaserOf(state) {
  const cycle = state.announcements.slice(state.cycleStart);
  for (let i = cycle.length - 1; i >= 0; i -= 1) {
    if (cycle[i].purchaser) return cycle[i].purchaser;
  }
  return state.announcements.find((row) => row.purchaser)?.purchaser || null;
}

// Latest bid deadline in the current round. Evaluation notices also store a
// date, but that one is a complaint window on a bid that has already closed,
// so it is not a calendar deadline.
function deadlineOf(state) {
  const cycle = state.announcements.slice(state.cycleStart);
  for (let i = cycle.length - 1; i >= 0; i -= 1) {
    const row = cycle[i];
    if (row.bidStage === 'EVALUATION' || row.bidStage === 'AWARD') continue;
    const day = chinaDay(row.deadline);
    if (day) return day;
  }
  return null;
}

function scrapeOpenDay(state) {
  const cycle = state.announcements.slice(state.cycleStart);
  for (let i = cycle.length - 1; i >= 0; i -= 1) {
    const day = extractBidOpenDay(cycle[i].rawContent);
    if (day) return day;
  }
  return null;
}

function recordedOpenDay(bidOpenings, threadKey, projectCode) {
  let best = null;
  for (const row of bidOpenings || []) {
    if (!openingMatches(row.biddingNo, threadKey, projectCode)) continue;
    const day = chinaDay(row.openDate);
    if (day && (!best || day > best)) best = day;
  }
  return best;
}

function projectNameOf(state) {
  const cycle = state.announcements.slice(state.cycleStart);
  const named = [...cycle].reverse().find((row) => row.projectName);
  return named?.projectName || '';
}

function projectCodeOf(state) {
  const cycle = state.announcements.slice(state.cycleStart);
  const coded = [...cycle].reverse().find((row) => row.projectCode);
  return coded?.projectCode || null;
}

// Confirmed aliases whose customer is still on an open Hot Project.
// customerName is matched to the Hot Project name; customerId is a second
// door for the same row when the CRM link is what the person confirmed.
function aliasIndex(hotProjects, aliases) {
  const byName = new Map();
  const byId = new Map();
  for (const project of hotProjects || []) {
    if (project.closedAt) continue;
    const name = String(project.customer || '').trim();
    if (!name) continue;
    const norm = normalizeCompany(name);
    if (norm && !byName.has(norm)) byName.set(norm, name);
    if (project.customerId && !byId.has(project.customerId)) byId.set(project.customerId, name);
  }
  const hits = [];
  const seen = new Set();
  for (const row of aliases || []) {
    if (!row.confirmed) continue;
    const aliasNorm = normalizeCompany(row.alias);
    if (!aliasNorm) continue;
    const customer = byName.get(normalizeCompany(row.customerName))
      || (row.customerId ? byId.get(row.customerId) : null);
    if (!customer) continue;
    const key = `${aliasNorm}::${customer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ aliasNorm, customer });
  }
  return hits;
}

function customersForPurchaser(purchaser, hits) {
  const norm = normalizeCompany(purchaser);
  if (!norm) return [];
  const names = [];
  const seen = new Set();
  for (const hit of hits) {
    if (hit.aliasNorm !== norm || seen.has(hit.customer)) continue;
    seen.add(hit.customer);
    names.push(hit.customer);
  }
  return names;
}

function eachOpenMatch(announcements, trackings, hotProjects, aliases, visit) {
  const hits = aliasIndex(hotProjects, aliases);
  const trackingByKey = new Map((trackings || []).map((row) => [row.threadKey, row]));
  for (const [key, rows] of groupAnnouncements(announcements)) {
    const state = threadState(rows);
    if (!isOpenThread(state, trackingByKey.get(key) || trackingByKey.get(rows[0]?.threadKey))) continue;
    const customers = customersForPurchaser(purchaserOf(state), hits);
    if (!customers.length) continue;
    visit({ key, state, customers });
  }
}

function trackingFor(state, key, trackings) {
  const byKey = new Map((trackings || []).map((row) => [row.threadKey, row]));
  return byKey.get(key) || byKey.get(state.announcements.find((row) => row.threadKey)?.threadKey) || null;
}

// Which open, alias-matched announcements still need their page text so the
// opening date can be read. Deadlines live on the column and do not need it.
export function threadsNeedingText(announcements, trackings, hotProjects, aliases) {
  const ids = [];
  eachOpenMatch(announcements, trackings, hotProjects, aliases, ({ state }) => {
    for (const row of state.announcements) if (row.id != null) ids.push(row.id);
  });
  return ids;
}

const KIND_LABEL = {
  deadline: { en: 'Bid deadline', zh: '投标截止' },
  opening: { en: 'Bid opening', zh: '开标' },
};

function tenderEvent({ key, kind, day, customer, projectName, today }) {
  const label = KIND_LABEL[kind];
  const short = clip(projectName, 72);
  return {
    id: `tender:${key}:${kind}:${normalizeCompany(customer)}`,
    source: 'tender',
    kind,
    day,
    customer,
    title: short ? `${customer} · ${short}` : customer,
    detail: label.en,
    detailZh: label.zh,
    href: `/chinabidding/tracking?q=${encodeURIComponent(key)}`,
    threadKey: key,
    overdue: Boolean(today) && day < today,
    color: (today && day < today) ? 'rose' : (kind === 'deadline' ? 'brand' : 'violet'),
  };
}

function eventRank(event) {
  if (event.kind === 'deadline') return 0;
  if (event.kind === 'opening') return 1;
  return 2;
}

export function listHotCustomers(hotProjects) {
  const map = new Map();
  for (const project of hotProjects || []) {
    if (project.closedAt) continue;
    const name = String(project.customer || '').trim();
    if (!name) continue;
    const key = normalizeCompany(name) || name.toLowerCase();
    if (!map.has(key)) map.set(key, { name, customerId: project.customerId || null });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Build the calendar from the current Chinabidding rows. Callers pass the
 * live query result; nothing is stored. Follow-up rows are not an input:
 * L/C, shipment, payment, and other execution milestones stay off this
 * calendar even if a caller still has them in hand.
 *
 * One deadline and, when a date exists, one opening, per open tender whose
 * purchaser matches a confirmed alias. Two tenders on the same day stay two
 * events.
 */
export function deriveHotCalendarEvents({
  hotProjects = [],
  aliases = [],
  announcements = [],
  trackings = [],
  bidOpenings = [],
  today = chinaDay(new Date()),
} = {}) {
  const events = [];
  const trackingByKey = new Map((trackings || []).map((row) => [row.threadKey, row]));
  eachOpenMatch(announcements, trackings, hotProjects, aliases, ({ key, state, customers }) => {
    const tracking = trackingByKey.get(key);
    if (tracking && FINISHED_TRACKING.has(tracking.ourStatus)) return;
    const deadlineDay = deadlineOf(state);
    const projectCode = projectCodeOf(state);
    const openDay = scrapeOpenDay(state) || recordedOpenDay(bidOpenings, key, projectCode);
    const projectName = projectNameOf(state);
    for (const customer of customers) {
      if (deadlineDay) {
        events.push(tenderEvent({ key, kind: 'deadline', day: deadlineDay, customer, projectName, today }));
      }
      if (openDay) {
        events.push(tenderEvent({ key, kind: 'opening', day: openDay, customer, projectName, today }));
      }
    }
  });
  events.sort((a, b) =>
    a.day.localeCompare(b.day) ||
    (eventRank(a) - eventRank(b)) ||
    a.title.localeCompare(b.title, 'en') ||
    a.id.localeCompare(b.id));
  return {
    today,
    events,
    hotCustomers: listHotCustomers(hotProjects),
  };
}

export function normalizeAliasInput(body = {}) {
  const customerName = String(body.customerName || '').trim();
  const alias = String(body.alias || '').trim();
  const noteRaw = body.note == null ? '' : String(body.note).trim();
  const parsed = body.customerId == null || body.customerId === '' ? null : parseInt(body.customerId, 10);
  return {
    customerName,
    alias,
    note: noteRaw ? noteRaw.slice(0, 500) : null,
    customerId: Number.isInteger(parsed) ? parsed : null,
  };
}

export function aliasValidationError(input, existing = [], selfId = null) {
  if (!input.customerName || input.customerName.length > 200) return 'Customer name is required';
  if (!input.alias || input.alias.length > 200) return 'Alias is required';
  if (normalizeCompany(input.customerName).length < 2) return 'Customer name is too short';
  if (normalizeCompany(input.alias).length < 2) return 'Alias is too short';
  const name = normalizeCompany(input.customerName);
  const alias = normalizeCompany(input.alias);
  const duplicate = existing.find((row) =>
    row.id !== selfId
    && normalizeCompany(row.customerName) === name
    && normalizeCompany(row.alias) === alias);
  if (duplicate) return 'That alias is already on this customer';
  return null;
}

// Editing the customer or the procurer spelling withdraws the confirmation:
// the sign-off was for the previous pair of names. A note-only edit keeps it.
export function aliasPatch(existing, input) {
  const identityChanged = normalizeCompany(existing.customerName) !== normalizeCompany(input.customerName)
    || normalizeCompany(existing.alias) !== normalizeCompany(input.alias)
    || (existing.customerId || null) !== (input.customerId || null);
  return {
    customerName: input.customerName,
    alias: input.alias,
    note: input.note,
    customerId: input.customerId,
    ...(identityChanged ? { confirmed: false, confirmedAt: null, confirmedById: null } : {}),
  };
}

export async function loadHotCalendarData(prisma) {
  const [hotProjects, aliases, announcements, trackings, bidOpenings] = await Promise.all([
    prisma.hotProject.findMany({
      where: { closedAt: null },
      select: { id: true, customer: true, customerId: true, closedAt: true },
    }),
    prisma.hotCustomerAlias.findMany({ orderBy: [{ customerName: 'asc' }, { id: 'asc' }] }),
    // Stage columns for every notice. The award that closes a thread often
    // has no purchaser of its own, so filtering to "purchaser is set" would
    // leave the tender looking open. Page text stays out of this query.
    prisma.bidProject.findMany({
      select: {
        id: true,
        threadKey: true,
        projectName: true,
        projectCode: true,
        purchaser: true,
        deadline: true,
        bidStage: true,
        status: true,
        publishDate: true,
      },
    }),
    prisma.bidTracking.findMany({ select: { threadKey: true, ourStatus: true } }),
    prisma.bidOpening.findMany({
      where: { openDate: { not: null } },
      select: { biddingNo: true, openDate: true },
    }),
  ]);

  const ids = threadsNeedingText(announcements, trackings, hotProjects, aliases);
  let enriched = announcements;
  if (ids.length) {
    const raws = await prisma.bidProject.findMany({
      where: { id: { in: ids } },
      select: { id: true, rawContent: true },
    });
    const byId = new Map(raws.map((row) => [row.id, row.rawContent]));
    enriched = announcements.map((row) => (
      byId.has(row.id) ? { ...row, rawContent: byId.get(row.id) } : row
    ));
  }

  const derived = deriveHotCalendarEvents({
    hotProjects,
    aliases,
    announcements: enriched,
    trackings,
    bidOpenings,
  });
  return { ...derived, aliases };
}
