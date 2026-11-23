// Slash commands for the Ask AI page — instant structured search, no LLM.
export const COMMANDS = [
  { key: 'customer', icon: '🤝', label: '/customer', hint: 'Search customers' },
  { key: 'project', icon: '📋', label: '/project', hint: 'Search tender projects' },
  { key: 'report', icon: '📝', label: '/report', hint: 'Search visit reports' },
  { key: 'followup', icon: '📌', label: '/followup', hint: 'Search project follow-ups' },
  { key: 'trip', icon: '🗺️', label: '/trip', hint: 'Search trips' },
  { key: 'hot', icon: '🔥', label: '/hot', hint: 'Search hot projects' },
]

export const CMD_BY_KEY = Object.fromEntries(COMMANDS.map((c) => [c.key, c]))

export function parseInput(raw) {
  const s = String(raw || '').trimStart()
  if (!s || s[0] !== '/') return { mode: 'idle' }
  const m = s.match(/^\/(\w+)\s+(.*)$/)
  if (m && CMD_BY_KEY[m[1].toLowerCase()]) {
    return { mode: 'search', type: m[1].toLowerCase(), query: m[2].trim() }
  }
  return { mode: 'palette', partial: s.slice(1).toLowerCase() }
}

export function projectTrackingHref(threadKey) {
  const key = String(threadKey || '').trim()
  return key ? `/chinabidding/tracking?q=${encodeURIComponent(key)}` : '/chinabidding/tracking'
}

export function resultHref(type, row) {
  if (row?.href && String(row.href).startsWith('/')) return row.href
  if (type === 'customer' && row?.id) return `/customers/${row.id}?from=search`
  if (type === 'project') return projectTrackingHref(row?.threadKey)
  if (type === 'report' && row?.id) return `/visit-reports/${row.id}`
  if (type === 'followup' && row?.id) return `/followups/${row.id}`
  if (type === 'trip' && row?.id) return `/trips/${row.id}`
  if (type === 'hot' && row?.id) return `/hotprojects?id=${row.id}`
  return null
}

export const EXAMPLES = {
  en: [
    'How are the recent visits and project progress with COSCO?',
    'Which competitors won the most tenders in the last 6 months?',
    "What's on the calendar next week?",
    'Which of my reminders are due, and what is the follow-up status?',
  ],
  zh: [
    'COSCO 最近的拜访和项目进展怎么样？',
    '过去 6 个月哪些竞争对手中标最多？',
    '下周日历上有什么安排？',
    '我有哪些到期提醒？相关项目跟进到哪一步了？',
  ],
}

export function examplesForLang(lang) {
  if (lang === 'zh') return EXAMPLES.zh
  if (lang === 'en') return EXAMPLES.en
  // Auto: two of each, so the welcome screen matches a bilingual workspace.
  return [EXAMPLES.en[0], EXAMPLES.zh[0], EXAMPLES.en[2], EXAMPLES.zh[3]]
}

export const TOOL_LABEL = {
  search_customers: 'Customers', get_customer: 'Customer profile', search_projects: 'Tenders',
  get_bidding_stats: 'Market stats', search_reports: 'Visit reports', get_report: 'Report',
  search_hot_projects: 'Hot projects', search_bid_openings: 'Bid openings', search_trips: 'Trips',
  search_events: 'Calendar', create_event: '✚ New event',
  search_followups: 'Follow-ups', get_followup: 'Follow-up',
  list_due_reminders: 'Reminders', get_field_service: 'Field service',
  ask_contracts: 'Contracts',
}
