// China-day month grid for the Hot Projects mini calendar. Weekdays are
// Sunday-first, matching the activity calendar, and every cell is a Beijing
// calendar day rather than the browser's local midnight.

const CN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

export const WEEKDAYS = [
  { en: 'Su', zh: '日' },
  { en: 'Mo', zh: '一' },
  { en: 'Tu', zh: '二' },
  { en: 'We', zh: '三' },
  { en: 'Th', zh: '四' },
  { en: 'Fr', zh: '五' },
  { en: 'Sa', zh: '六' },
]

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

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
  return { en: `${MONTHS_EN[mon - 1]} ${year}`, zh: MONTHS_ZH[mon - 1] }
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
