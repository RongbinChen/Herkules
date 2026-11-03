// Visit-report targets live in content.targets[] as { title, date, note } and
// have no id. Saving a report creates one calendar reminder per dated target
// with title `⏰ ${title.slice(0, 180)}` and visitReportId set — that title is
// the only durable link back to the row. The anchor is the base64url of the
// normalized title, so /visit-reports/:id#remind-<key> still resolves after the
// report is reordered and after the reminder is postponed. remindDate is only
// a tie-break when two targets share a title.

const TITLE_LIMIT = 180

export function normalizeRemindTitle(title) {
  return String(title ?? '').trim().slice(0, TITLE_LIMIT)
}

// Strip the prefix the server adds when it creates the reminder. Anything
// after that is the target title, already sliced to TITLE_LIMIT.
export function targetTitleFromReminder(eventTitle) {
  return normalizeRemindTitle(String(eventTitle ?? '').replace(/^(?:⏰\s*)+/, ''))
}

export function remindKey(title) {
  const normalized = normalizeRemindTitle(title)
  if (!normalized) return null
  const bytes = new TextEncoder().encode(normalized)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function reminderDueDay(start) {
  const date = new Date(start)
  if (Number.isNaN(date.getTime())) return null
  // Reminders are stored at 09:00 Asia/Shanghai, which is 01:00 UTC the same
  // calendar day, so the UTC date is the day written on the target.
  return date.toISOString().slice(0, 10)
}

export function preferredRemindDate(search) {
  const value = new URLSearchParams(search || '').get('remindDate')
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
}

// Parallel to `targets`. Identical titles share one canonical id (`remind-<key>`)
// on the row whose date matches preferredDate, or the first row when none do.
// The other copies get `remind-<key>-2`, `-3`, … so ids stay unique.
export function assignRemindDomIds(targets, preferredDate) {
  const keys = targets.map((tg) => remindKey(tg?.title))
  const counts = new Map()
  for (const key of keys) {
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const canonicalIndex = new Map()
  keys.forEach((key, i) => {
    if (!key || counts.get(key) < 2 || canonicalIndex.has(key)) return
    if (preferredDate && targets[i]?.date === preferredDate) canonicalIndex.set(key, i)
  })
  keys.forEach((key, i) => {
    if (!key || counts.get(key) < 2 || canonicalIndex.has(key)) return
    canonicalIndex.set(key, i)
  })

  const extra = new Map()
  return keys.map((key, i) => {
    if (!key) return null
    if ((counts.get(key) || 0) < 2 || canonicalIndex.get(key) === i) return `remind-${key}`
    const n = (extra.get(key) || 1) + 1
    extra.set(key, n)
    return `remind-${key}-${n}`
  })
}

// focusId is null when the hash is missing, malformed, or names no row —
// the report then stays at the top.
export function remindAnchors(targets, { hash = '', search = '' } = {}) {
  const ids = assignRemindDomIds(targets, preferredRemindDate(search))
  let focusId = null
  if (hash.startsWith('#remind-')) {
    try {
      const id = decodeURIComponent(hash.slice(1))
      if (ids.includes(id)) focusId = id
    } catch {
      focusId = null
    }
  }
  return { ids, focusId }
}

export function visitReportRemindLocation(ev) {
  const pathname = `/visit-reports/${ev.visitReportId}`
  const key = remindKey(targetTitleFromReminder(ev?.title))
  if (!key) return { pathname }
  const day = reminderDueDay(ev?.start)
  return {
    pathname,
    hash: `#remind-${key}`,
    ...(day ? { search: `?remindDate=${day}` } : {}),
  }
}
