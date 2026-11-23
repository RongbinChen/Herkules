// Grouping and overview helpers for Ask AI source cards.
// Visit reports render as a vertical list with stored facts; reminders are
// labeled and, when they belong to a listed report, nested under it.

const REPORT_HREF = /^\/visit-reports\/(\d+)/
const SAFE_PATH = /^\/(customers|visit-reports|chinabidding|hotprojects|followups|trips|contracts|calendar|search|trip\/share|bidopen\/share)(\/|\?|#|$)/

export function isSafeAppHref(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return false
  return SAFE_PATH.test(href)
}


export function reportIdFromHref(href) {
  const m = String(href || '').match(REPORT_HREF)
  return m ? Number(m[1]) : null
}

export function sourceTypeLabels(lang) {
  if (lang === 'zh') {
    return {
      customer: '客户',
      project: '招标',
      report: '拜访报告',
      reports: '拜访报告',
      hot: '热点项目',
      event: '日历',
      bidopen: '开标',
      trip: '出差',
      followup: '项目跟进',
      reminder: '提醒',
      reminders: '提醒',
      'field-service': '现场服务',
      contracts: '合同',
      record: '记录',
      locked: '已锁定',
      fromReport: '来源报告',
    }
  }
  return {
    customer: 'Customer',
    project: 'Tender',
    report: 'Visit report',
    reports: 'Visit reports',
    hot: 'Hot project',
    event: 'Calendar',
    bidopen: 'Bid opening',
    trip: 'Trip',
    followup: 'Follow-up',
    reminder: 'Reminder',
    reminders: 'Reminders',
    'field-service': 'Field service',
    contracts: 'Contracts',
    record: 'Record',
    locked: 'locked',
    fromReport: 'from report',
  }
}

export function fmtSourceDate(value) {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  const day = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (day) return day[1]
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

export function reminderDisplayTitle(title) {
  return String(title ?? '').replace(/^(?:⏰\s*)+/, '').trim()
}

export function reportOverviewLine(source) {
  if (!source) return ''
  const parts = []
  const day = fmtSourceDate(source.visitDate)
  if (day) parts.push(day)
  const location = String(source.location || '').trim()
  if (location) parts.push(location)
  const customer = String(source.customer || '').trim()
  if (customer) parts.push(customer)
  const author = String(source.author || '').trim()
  if (author) parts.push(author)
  return parts.join(' · ')
}

export function reminderOverviewLine(source, lang = 'en') {
  if (!source) return ''
  const t = sourceTypeLabels(lang)
  const parts = []
  const day = fmtSourceDate(source.start || source.visitDate)
  if (day) parts.push(day)
  const location = String(source.location || '').trim()
  if (location) parts.push(location)
  const reportTitle = String(source.reportTitle || '').trim()
  if (reportTitle) parts.push(lang === 'zh' ? `${t.fromReport}：${reportTitle}` : `${t.fromReport}: ${reportTitle}`)
  const customer = String(source.customer || '').trim()
  if (customer && customer !== reportTitle) parts.push(customer)
  return parts.join(' · ')
}

export function groupSourceCards(sources = []) {
  const reports = []
  const others = []
  const reminders = []
  const seen = new Set()

  for (const source of sources || []) {
    if (!source || typeof source !== 'object') continue
    const href = source.href
    if (typeof href !== 'string' || !href) continue
    const key = `${source.type || ''}:${href}`
    if (seen.has(key)) continue
    seen.add(key)
    if (source.type === 'report') reports.push(source)
    else if (source.type === 'reminder') reminders.push(source)
    else others.push(source)
  }

  const reportIds = new Set(reports.map((r) => r.visitReportId || reportIdFromHref(r.href)).filter(Boolean))
  const remindersByReport = new Map()
  const looseReminders = []
  for (const rem of reminders) {
    const id = rem.visitReportId || reportIdFromHref(rem.href)
    if (id && reportIds.has(id)) {
      if (!remindersByReport.has(id)) remindersByReport.set(id, [])
      remindersByReport.get(id).push(rem)
    } else {
      looseReminders.push(rem)
    }
  }

  return {
    others,
    reports,
    remindersByReport,
    looseReminders,
    hasAny: others.length + reports.length + reminders.length > 0,
  }
}
