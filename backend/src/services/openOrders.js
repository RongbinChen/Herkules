// Which commercial contracts are an order in execution that nobody is following
// up. Pure: the route loads the rows, this decides the grouping.
//
// A file is already covered when an ACTIVE, ON_HOLD or COMPLETED follow-up is
// linked to it, or when that follow-up's order number matches the contract
// number or Kom. No. on the same customer. CANCELLED does not cover — the
// order was dropped from the list and may need opening again. Completed does
// cover: the work was tracked, it is not "open".
//
// An order is also finished, and stays off this list, in two other cases.
// The same customer already has an FAC file whose contract number or Kom. No.
// matches (orderIdsMatch / identityOf). Or the commercial file itself has
// closedAt set — someone marked it finished on the Contracts page. Hot Project
// closedAt is not consulted: that date is when the deal was won.
import { komFromNote } from './contractSummaryFormat.js';
import { parseDate } from './contractTimelineFormat.js';

const COVERING = new Set(['ACTIVE', 'ON_HOLD', 'COMPLETED']);

export function normalizeOrderKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

// Exact match after stripping spaces and punctuation. A shorter number has to
// be at least 5 characters before it may match as a substring — "12" must not
// swallow "12345", while "30-0004" and "300004" are the same Kom. No.
export function orderIdsMatch(a, b) {
  const x = normalizeOrderKey(a);
  const y = normalizeOrderKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  if (shorter.length < 5) return false;
  return longer.includes(shorter);
}

function summaryValue(summary, key) {
  const raw = summary?.fields?.find((f) => f.key === key)?.value;
  const s = String(raw ?? '').trim();
  if (!s || s === '—' || s === '-' || s === '–' || /^n\/?a$/i.test(s)) return null;
  return s;
}

function identityOf(file) {
  const ids = [];
  const contractNo = summaryValue(file.summary, 'contractNo');
  const kom = summaryValue(file.summary, 'komNo') || komFromNote(file.note);
  if (contractNo) ids.push(contractNo);
  if (kom) ids.push(kom);
  return ids;
}

function isCovered(file, followUps) {
  if ((file.linkedFollowUps || []).some((f) => COVERING.has(f.status))) return true;
  const ids = identityOf(file);
  if (!ids.length || !file.customerId) return false;
  return (followUps || []).some((fu) => (
    COVERING.has(fu.status)
    && fu.customerId === file.customerId
    && ids.some((id) => orderIdsMatch(id, fu.orderNo))
  ));
}

function groupKey(file) {
  const contractNo = summaryValue(file.summary, 'contractNo');
  const kom = summaryValue(file.summary, 'komNo') || komFromNote(file.note);
  if (contractNo) return `${file.customerId}:no:${normalizeOrderKey(contractNo)}`;
  if (kom) return `${file.customerId}:kom:${normalizeOrderKey(kom)}`;
  return `${file.customerId}:file:${file.id}`;
}

function firstValue(files, key) {
  for (const f of files) {
    const v = summaryValue(f.summary, key);
    if (v) return v;
  }
  return null;
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function buildOrder(files, followUps) {
  const sorted = [...files].sort((a, b) => {
    const rank = (d) => (d === 'COMMERCIAL' ? 0 : 1);
    return rank(a.docType) - rank(b.docType) || a.id - b.id;
  });
  const head = sorted[0];
  const contractNo = firstValue(sorted, 'contractNo');
  const komNo = firstValue(sorted, 'komNo') || sorted.map((f) => komFromNote(f.note)).find(Boolean) || null;
  const machineType = clip(firstValue(sorted.filter((f) => f.docType === 'TECHNICAL').concat(sorted), 'machine'), 80);
  const signedRaw = firstValue(sorted, 'signedDate');
  const signed = signedRaw ? parseDate(signedRaw) : null;
  const signedDate = signed?.date && !signed.monthOnly ? signed.date : null;
  const orderNo = contractNo || komNo || null;
  const customerName = head.customerName || '';
  const title = [customerName, machineType || orderNo].filter(Boolean).join(' — ') || customerName || 'Order';
  const identities = [contractNo, komNo].filter(Boolean);
  const alsoOpen = (followUps || []).filter((fu) => (
    fu.customerId === head.customerId
    && (fu.status === 'ACTIVE' || fu.status === 'ON_HOLD')
    && !identities.some((id) => orderIdsMatch(id, fu.orderNo))
  )).slice(0, 3).map((fu) => ({
    id: fu.id, title: fu.title, orderNo: fu.orderNo || null,
  }));
  return {
    customerId: head.customerId,
    customerName,
    team: head.team,
    contractNo: contractNo || null,
    komNo: komNo || null,
    machineType: machineType || null,
    signedDate,
    orderNo,
    title,
    fileIds: sorted.map((f) => f.id),
    files: sorted.map((f) => ({
      id: f.id,
      filename: f.filename,
      docType: f.docType,
      ocrStatus: f.ocrStatus,
      summarised: Boolean(f.summary),
    })),
    alsoOpen,
  };
}

function hasSignedDate(order) {
  return typeof order.signedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(order.signedDate);
}

/**
 * files: contract rows already limited to one team. Each needs
 * { id, filename, docType, note, customerId, customerName, ocrStatus, summary, team,
 *   closedAt, linkedFollowUps: [{ status }] }.
 * followUps: ACTIVE / ON_HOLD / COMPLETED follow-ups for those customers.
 * Returns orders with no contract value and no page text, newest signed date
 * first. Orders with no signed day sort last, by customer name then file id.
 */
export function selectOpenOrders(files, followUps) {
  const readable = (files || []).filter((f) => (
    f
    && (f.docType === 'COMMERCIAL' || f.docType === 'TECHNICAL')
    && (f.ocrStatus === 'DONE' || f.summary)
  ));
  const commercial = readable.filter((f) => f.docType === 'COMMERCIAL');
  const technical = readable.filter((f) => f.docType === 'TECHNICAL');
  // An FAC closes the matching order whether or not it has been transcribed:
  // the contract number or Kom. No. may already be on the note. A commercial
  // marked closed does too, even while it is still queued for OCR — otherwise
  // its technical agreement would resurface as a new open order.
  const facFiles = (files || []).filter((f) => f && f.docType === 'FAC');
  const closedCommercials = (files || []).filter((f) => f && f.docType === 'COMMERCIAL' && f.closedAt);
  const customersWithCommercial = new Set([
    ...commercial.map((f) => f.customerId),
    ...closedCommercials.map((f) => f.customerId),
  ]);

  const groups = new Map();
  for (const f of commercial) {
    if (f.closedAt || isCovered(f, followUps)) continue;
    const key = groupKey(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  // Technical agreements join the commercial they belong to. An FAC, and a
  // commercial someone has marked closed, join the same way and then retire
  // that order — they never become a candidate of their own. A closed
  // commercial still counts above, so its technical agreement does not surface
  // as a new order once the commercial is gone.
  function placeCompanion(file, { canStandAlone }) {
    if (canStandAlone && isCovered(file, followUps)) return;
    const ids = identityOf(file);
    const key = groupKey(file);
    if (groups.has(key)) { groups.get(key).push(file); return; }
    const owned = [...groups.entries()].find(([, list]) => (
      list[0].customerId === file.customerId
      && ids.length > 0
      && list.some((f) => identityOf(f).some((a) => ids.some((b) => orderIdsMatch(a, b))))
    ));
    if (owned) { owned[1].push(file); return; }
    const custGroups = [...groups.values()].filter((list) => list[0].customerId === file.customerId);
    if (!ids.length && custGroups.length === 1) {
      if (canStandAlone) custGroups[0].push(file);
      return;
    }
    if (canStandAlone && !customersWithCommercial.has(file.customerId)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(file);
    }
  }

  for (const t of technical) placeCompanion(t, { canStandAlone: true });
  for (const f of closedCommercials) placeCompanion(f, { canStandAlone: false });
  for (const fac of facFiles) placeCompanion(fac, { canStandAlone: false });

  const orders = [...groups.values()]
    .filter((list) => list.length && !list.some((f) => (
      f.docType === 'FAC' || (f.docType === 'COMMERCIAL' && f.closedAt)
    )))
    .map((list) => buildOrder(list, followUps));
  orders.sort((a, b) => {
    const aDated = hasSignedDate(a);
    const bDated = hasSignedDate(b);
    if (aDated !== bDated) return aDated ? -1 : 1;
    if (aDated && a.signedDate !== b.signedDate) return a.signedDate < b.signedDate ? 1 : -1;
    const byName = String(a.customerName).localeCompare(String(b.customerName));
    if (byName) return byName;
    return (a.fileIds[0] || 0) - (b.fileIds[0] || 0);
  });
  return orders.slice(0, 100);
}
