// China-day month grid for the Hot Projects mini calendar. Weekdays are
// Sunday-first, matching the activity calendar, and every cell is a Beijing
// calendar day rather than the browser's local midnight.
// Labels on this card are English only.

const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

export const WEEKDAYS = [
  { short: 'Su', title: 'Sunday' },
  { short: 'Mo', title: 'Monday' },
  { short: 'Tu', title: 'Tuesday' },
  { short: 'We', title: 'Wednesday' },
  { short: 'Th', title: 'Thursday' },
  { short: 'Fr', title: 'Friday' },
  { short: 'Sa', title: 'Saturday' },
]

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function chinaToday(now = new Date()) {
  return CN_DATE.format(now)
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month) {
  const mon = Number(month.slice(5, 7))
  const year = month.slice(0, 4)
  return `${MONTHS_EN[mon - 1]} ${year}`
}

// Leading nulls are the weekdays before the 1st. Trailing nulls finish the
// last week so the seven columns stay aligned.
export function buildMonthGrid(month) {
  const [year, mon] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const lead = new Date(`${month}-01T12:00:00+08:00`).getUTCDay()
  const cells = Array(lead).fill(null)
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7) cells.push(null)
  return cells
}

// The first week of the following month, including its leading blanks, so
// the peek sits on the same weekday columns as the month above it.
export function peekRow(month) {
  const next = shiftMonth(month, 1)
  return { month: next, cells: buildMonthGrid(next).slice(0, 7) }
}

export function dotColors(events, limit = 3) {
  const colors = []
  for (const event of events || []) {
    if (event?.color && !colors.includes(event.color)) colors.push(event.color)
    if (colors.length >= limit) break
  }
  return colors
}

const BID_KINDS = new Set(['deadline', 'opening'])

// Chinabidding deadlines and openings only. A follow-up milestone that still
// arrives in a payload (L/C, shipment, payment) is dropped before the card
// counts overdue days, teases the next date, or paints a row.
export function bidCalendarEvents(events) {
  return (events || []).filter((event) => {
    if (!event || !BID_KINDS.has(event.kind)) return false
    if (event.source && event.source !== 'tender') return false
    if (event.followUpId) return false
    const href = typeof event.href === 'string' ? event.href : ''
    if (href.includes('/followups')) return false
    return true
  })
}
