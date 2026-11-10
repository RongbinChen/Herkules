// Project Tracking dates a thread by the last official notice, not by when
// our database row was scraped or edited. Kept free of prisma so tests and
// the list API share one rule.

/** Milliseconds of a publication date, or 0 when it is missing or unparsable. */
export function publishedMs(date) {
  if (!date) return 0;
  const t = new Date(date).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Newest-first: later publishDate, then higher tender round, then higher id.
// A notice with no publication date never outranks one that has one.
function isNewerNotice(candidate, current) {
  const byDate = publishedMs(candidate?.publishDate) - publishedMs(current?.publishDate);
  if (byDate !== 0) return byDate > 0;
  const byRound = (candidate?.round || 1) - (current?.round || 1);
  if (byRound !== 0) return byRound > 0;
  return (candidate?.id || 0) - (current?.id || 0) > 0;
}

/** The notice that leads the timeline, or null when the thread has none. */
export function newestNotice(announcements) {
  let best = null;
  for (const notice of announcements || []) {
    if (!best || isNewerNotice(notice, best)) best = notice;
  }
  return best;
}

/**
 * Publication date of the latest official notice.
 * Null when every notice lacks a usable publishDate — callers must not
 * substitute updatedAt / last-synced time.
 */
export function lastPublishedAt(announcements) {
  const notice = newestNotice(announcements);
  if (!notice || publishedMs(notice.publishDate) === 0) return null;
  return notice.publishDate;
}

/**
 * Newest publication first. Threads with no notice date sort last.
 * Same-day ties follow tender round, then announcement id — never updatedAt.
 */
export function compareThreadsByLastPublished(a, b) {
  const an = newestNotice(a?.announcements);
  const bn = newestNotice(b?.announcements);
  const byDate = publishedMs(bn?.publishDate) - publishedMs(an?.publishDate);
  if (byDate) return byDate;
  const byRound = (bn?.round || 1) - (an?.round || 1);
  if (byRound) return byRound;
  return (bn?.id || 0) - (an?.id || 0);
}
