// Keyword search for the Visit Reports list page.
//
// The list API already returns the full report payload (title, summary,
// rawNotes, structured content including a preserved originalBody, customer
// and author), so filtering can stay on the client. Tokens are whitespace-
// split and AND-ed: every token must appear as a case-insensitive substring
// somewhere in the report. That works for English phrases and for Chinese
// keywords typed with or without spaces. An empty or whitespace-only query
// returns the input list unchanged (and does not mutate it).

const SKIP_KEYS = new Set([
  'storedName',
  'mimeType',
  'contentType',
  'url',
  'src',
  'path',
  'bodySource',
  'summaryModel',
  'aiModel',
  'regenerateCaption',
  'captionEdited',
  'id',
])

function collectStrings(value, into, skipKeys = false) {
  if (value == null) return
  if (typeof value === 'string') {
    if (value) into.push(value)
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    into.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into, skipKeys)
    return
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (skipKeys && SKIP_KEYS.has(key)) continue
      collectStrings(child, into, skipKeys)
    }
  }
}

export function visitReportSearchHaystack(report) {
  const parts = []
  if (!report || typeof report !== 'object') return ''
  parts.push(report.title)
  parts.push(report.summary)
  parts.push(report.rawNotes)
  parts.push(report.threadKey)
  if (report.visitDate != null && report.visitDate !== '') {
    parts.push(String(report.visitDate))
  }
  if (report.customer && typeof report.customer === 'object') {
    parts.push(report.customer.name)
  }
  if (report.author && typeof report.author === 'object') {
    parts.push(report.author.name)
  }
  collectStrings(report.content, parts, true)
  if (Array.isArray(report.attachments)) {
    for (const item of report.attachments) {
      if (!item || typeof item !== 'object') continue
      if (item.caption) parts.push(item.caption)
      if (item.name) parts.push(item.name)
    }
  }
  return parts
    .filter((s) => typeof s === 'string' && s)
    .join('\n')
    .toLowerCase()
}

export function parseSearchTokens(query) {
  if (typeof query !== 'string') return []
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function filterVisitReportsByKeyword(reports, query) {
  const list = Array.isArray(reports) ? reports : []
  const tokens = parseSearchTokens(query)
  if (tokens.length === 0) return list
  return list.filter((report) => {
    const hay = visitReportSearchHaystack(report)
    return tokens.every((token) => hay.includes(token))
  })
}
