/**
 * Trusted in-app paths for Ask AI source cards and tool payloads.
 * The model must not invent URLs; these are the only hrefs the UI will render.
 */

export const SITE_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://www.herkulesgroup-china.com';

export function customerHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/customers/${Number(id)}` : null;
}

export function reportHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/visit-reports/${Number(id)}` : null;
}

export function projectTrackingHref(threadKey) {
  const key = String(threadKey || '').trim();
  return key ? `/chinabidding/tracking?q=${encodeURIComponent(key)}` : null;
}

export function bidOpenHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/chinabidding/bidopen?id=${Number(id)}` : null;
}

export function hotProjectHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/hotprojects?id=${Number(id)}` : null;
}

export function tripHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/trips/${Number(id)}` : null;
}

export function followUpHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/followups/${Number(id)}` : null;
}

export function calendarEventHref(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? `/calendar?event=${Number(id)}` : null;
}

export function contractsHref(customerId) {
  return Number.isInteger(Number(customerId)) && Number(customerId) > 0
    ? `/contracts?customerId=${Number(customerId)}`
    : '/contracts';
}

export function shareUrl(path) {
  const p = String(path || '');
  if (!p) return null;
  return `${SITE_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`;
}

// Mirrors frontend/src/utils/remindAnchor.js so reminder cards can deep-link
// to /visit-reports/:id#remind-… without importing frontend code.
const TITLE_LIMIT = 180;

export function normalizeRemindTitle(title) {
  return String(title ?? '').trim().slice(0, TITLE_LIMIT);
}

export function targetTitleFromReminder(eventTitle) {
  return normalizeRemindTitle(String(eventTitle ?? '').replace(/^(?:⏰\s*)+/, ''));
}

export function remindKey(title) {
  const normalized = normalizeRemindTitle(title);
  if (!normalized) return null;
  const bytes = new TextEncoder().encode(normalized);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function reminderDueDay(start) {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function reminderReportHref(ev) {
  const reportId = ev?.visitReportId;
  if (!reportId) return calendarEventHref(ev?.id);
  const key = remindKey(targetTitleFromReminder(ev?.title));
  if (!key) return reportHref(reportId);
  const day = reminderDueDay(ev?.start);
  const search = day ? `?remindDate=${day}` : '';
  return `/visit-reports/${reportId}${search}#remind-${key}`;
}

export function eventHref(ev) {
  if (ev?.category === 'REMINDER' && ev?.visitReportId) return reminderReportHref(ev);
  return calendarEventHref(ev?.id);
}

// Allowlisted in-app path: used if the model echoes a tool href in markdown.
const SAFE_PATH = /^\/(customers|visit-reports|chinabidding|hotprojects|followups|trips|contracts|calendar|search|trip\/share|bidopen\/share)(\/|\?|#|$)/;

export function toAppPath(href) {
  if (typeof href !== 'string' || !href) return null;
  if (href.startsWith('/')) return SAFE_PATH.test(href) ? href : null;
  try {
    const u = new URL(href);
    const origin = new URL(SITE_ORIGIN);
    if (u.origin !== origin.origin) return null;
    const path = `${u.pathname}${u.search}${u.hash}`;
    return SAFE_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function isTrustedAppPath(href) {
  return Boolean(toAppPath(href));
}
