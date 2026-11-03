// Group visit reports for the Visit Reports page (cards and list).
//
// Customer groups are ordered by the newest visit in each group, latest first.
// COSCO appears above Anhui when COSCO's most recent report is newer, even
// though Anhui comes first alphabetically. Groups with the same latest date
// fall back to display-name order. A group with no parseable date sorts after
// every dated group, and undated groups break their own ties by name.
// Collation follows the UI language (en, or zh-CN when the page is 中文) so
// Chinese names sort by pinyin in a Chinese session. Comparison is
// case-insensitive and numeric ("Plant 2" before "Plant 10"), but the group
// key itself is the trimmed display name, so "COSCO" and "cosco" stay
// separate groups.
//
// Inside a group, newest visit date comes first. Reports with no date, or a
// date that does not parse, sit at the bottom in their original order.
//
// A report with no customer, or a blank/whitespace-only customer name, goes in
// one "no customer" group so it is not mixed in with named customers. That
// bucket is ordered by its own latest visit, the same way named groups are.

const UNNAMED_KEY = '\0unnamed'

export function customerDisplayName(report) {
  const raw = report?.customer?.name
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, ' ')
}

function visitTime(report) {
  const value = report?.visitDate
  if (value == null || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

// Stable for equal timestamps: callers pass the API order (visitDate desc).
function compareNewestFirst(a, b) {
  const left = visitTime(a)
  const right = visitTime(b)
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return right - left
}

function latestVisitTime(reports) {
  let latest = null
  for (const report of reports) {
    const time = visitTime(report)
    if (time != null && (latest == null || time > latest)) latest = time
  }
  return latest
}

function compareGroupNames(a, b, locale) {
  return a.name.localeCompare(b.name, locale, {
    numeric: true,
    sensitivity: 'base',
  })
}

// Newest group first. Undated groups sink. Equal dates keep name order.
function compareGroupsByLatestVisit(locale) {
  return (a, b) => {
    const left = latestVisitTime(a.reports)
    const right = latestVisitTime(b.reports)
    if (left == null && right == null) return compareGroupNames(a, b, locale)
    if (left == null) return 1
    if (right == null) return -1
    if (left !== right) return right - left
    return compareGroupNames(a, b, locale)
  }
}

export function groupVisitReportsByCustomer(reports, locale = 'en') {
  const list = Array.isArray(reports) ? reports : []
  const buckets = new Map()

  for (const report of list) {
    const name = customerDisplayName(report)
    const unnamed = name.length === 0
    const key = unnamed ? UNNAMED_KEY : `name:${name}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, name, unnamed, reports: [] }
      buckets.set(key, bucket)
    }
    bucket.reports.push(report)
  }

  const groups = []
  for (const bucket of buckets.values()) {
    groups.push({ ...bucket, reports: [...bucket.reports].sort(compareNewestFirst) })
  }

  groups.sort(compareGroupsByLatestVisit(locale))
  return groups
}
