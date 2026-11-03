// Group visit reports for the Visit Reports page (cards and list).
//
// Customer groups are alphabetical by display name, not by the group's newest
// visit. Field staff scan a long customer list by name; ordering groups by
// recency would reshuffle the page every time a new visit is filed. Collation
// follows the UI language (en, or zh-CN when the page is 中文) so Chinese names
// sort by pinyin in a Chinese session. Comparison is case-insensitive and
// numeric ("Plant 2" before "Plant 10"), but the group key itself is the
// trimmed display name, so "COSCO" and "cosco" stay separate groups.
//
// Inside a group, newest visit date comes first. Reports with no date, or a
// date that does not parse, sit at the bottom in their original order.
//
// A report with no customer, or a blank/whitespace-only customer name, goes in
// one trailing "no customer" group so it is not mixed in with named customers.

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

  const named = []
  const unnamed = []
  for (const bucket of buckets.values()) {
    const group = { ...bucket, reports: [...bucket.reports].sort(compareNewestFirst) }
    if (group.unnamed) unnamed.push(group)
    else named.push(group)
  }

  named.sort((a, b) => a.name.localeCompare(b.name, locale, {
    numeric: true,
    sensitivity: 'base',
  }))

  return [...named, ...unnamed]
}
