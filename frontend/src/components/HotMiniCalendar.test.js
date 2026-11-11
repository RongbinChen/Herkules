import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CJK = /[\u4e00-\u9fff]/

function render(node) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node))
}

const events = [
  {
    id: 'tender:A:deadline:baosteel',
    source: 'tender',
    kind: 'deadline',
    day: '2026-11-20',
    customer: 'Baosteel',
    title: 'Baosteel · CNC gantry',
    detail: 'Bid deadline',
    detailZh: '投标截止',
    href: '/chinabidding/tracking?q=THREAD-A',
    overdue: false,
    color: 'brand',
  },
  {
    id: 'tender:B:deadline:baosteel',
    source: 'tender',
    kind: 'deadline',
    day: '2026-11-20',
    customer: 'Baosteel',
    title: 'Baosteel · Second mill',
    detail: 'Bid deadline',
    detailZh: '投标截止',
    href: '/chinabidding/tracking?q=THREAD-B',
    overdue: false,
    color: 'brand',
  },
  {
    id: 'followup:7:LC_OPEN_DEADLINE',
    source: 'followup',
    kind: 'LC_OPEN_DEADLINE',
    day: '2026-11-02',
    customer: 'Baosteel',
    title: 'Baosteel · Roll grinder',
    detail: 'L/C to be opened by',
    detailZh: '信用证开证截止',
    href: '/followups/7',
    overdue: true,
    color: 'rose',
  },
]

const aliases = [
  { id: 1, customerName: 'Baosteel', alias: 'Baosteel Group', confirmed: false },
  { id: 2, customerName: 'Ansteel', alias: 'Angang', confirmed: true },
]

test('collapsed default is a compact bar and hides the month grid', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events,
    today: '2026-11-11',
    initialMonth: '2026-11',
    aliases,
    hotCustomers: [],
  }))

  assert.match(html, /data-expanded="false"/)
  assert.match(html, /November 2026/)
  assert.match(html, /data-testid="calendar-toggle"/)
  assert.match(html, />Expand</)
  assert.match(html, /data-testid="calendar-teaser"/)
  assert.match(html, /1 overdue/)
  assert.match(html, /Next Nov 20 · Bid deadline/)
  assert.match(html, /class="[^"]*\bw-full\b/)
  assert.match(html, /max-w-full/)
  assert.doesNotMatch(html, /min-w-\[/)
  assert.doesNotMatch(html, /data-testid="calendar-grid"/)
  assert.doesNotMatch(html, /data-testid="calendar-weekdays"/)
  assert.doesNotMatch(html, /data-testid="calendar-peek"/)
  assert.doesNotMatch(html, /data-testid="calendar-legend"/)
  assert.doesNotMatch(html, /data-testid="event-list"/)
  assert.doesNotMatch(html, /data-testid="alias-panel"/)
  assert.doesNotMatch(html, /data-testid="day-/)
  assert.doesNotMatch(html, /grid-cols-7/)
  assert.doesNotMatch(html, />Collapse</)
  assert.doesNotMatch(html, /Baosteel · CNC gantry/)
  assert.doesNotMatch(html, /December 2026/)
  assert.doesNotMatch(html, CJK)
})

test('aliases do not force the calendar open on load', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events: [],
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialAliasesOpen: true,
    aliases,
    hotCustomers: [{ name: 'Baosteel', customerId: 4 }],
  }))

  assert.match(html, /data-expanded="false"/)
  assert.doesNotMatch(html, /data-testid="calendar-grid"/)
  assert.doesNotMatch(html, /data-testid="alias-panel"/)
  assert.doesNotMatch(html, /data-testid="confirm-alias-1"/)
  assert.doesNotMatch(html, CJK)
})

test('expanded month shows the grid, peek, legend, and English copy', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events,
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialExpanded: true,
    aliases: [],
  }))

  assert.match(html, /data-expanded="true"/)
  assert.match(html, />Collapse</)
  assert.match(html, /data-testid="calendar-grid"/)
  assert.match(html, /data-testid="calendar-weekdays"/)
  assert.match(html, /title="Sunday"/)
  assert.match(html, /data-testid="calendar-peek"/)
  assert.match(html, /data-testid="calendar-legend"/)
  assert.match(html, /Deadline/)
  assert.match(html, /Opening/)
  assert.match(html, /Follow-up/)
  assert.match(html, /Overdue/)
  assert.match(html, /December 2026/)
  assert.match(html, /data-testid="day-2026-11-20"[^>]*data-dots="brand"/)
  assert.match(html, /data-testid="day-2026-11-02"[^>]*data-dots="rose"/)
  assert.match(html, /aria-current="date"/)
  assert.match(html, /h-12/)
  assert.match(html, /Select a day/)
  assert.match(html, /Bid dates need a confirmed alias/)
  assert.match(html, /aria-label="Previous month"/)
  assert.match(html, /aria-label="Next month"/)
  assert.doesNotMatch(html, /data-testid="event-list"/)
  assert.doesNotMatch(html, CJK)
})

test('expanded day stacks two tenders as separate tracking links', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events,
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialExpanded: true,
    initialSelected: '2026-11-20',
    aliases: [],
  }))

  assert.match(html, /data-expanded="true"/)
  assert.match(html, /h-12/)
  assert.equal((html.match(/data-testid="cal-event"/g) || []).length, 2)
  assert.match(html, /Baosteel · CNC gantry/)
  assert.match(html, /Baosteel · Second mill/)
  assert.match(html, /Bid deadline/)
  assert.match(html, /href="\/chinabidding\/tracking\?q=THREAD-A"/)
  assert.match(html, /href="\/chinabidding\/tracking\?q=THREAD-B"/)
  assert.doesNotMatch(html, /href="\/followups\/7"/)
  assert.doesNotMatch(html, /投标截止/)
  assert.doesNotMatch(html, CJK)
})

test('a follow-up event links to that follow-up record', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events,
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialExpanded: true,
    initialSelected: '2026-11-02',
    aliases: [],
  }))
  assert.match(html, /href="\/followups\/7"/)
  assert.match(html, /L\/C to be opened by/)
  assert.match(html, /Overdue/)
  assert.doesNotMatch(html, /信用证开证截止/)
  assert.doesNotMatch(html, /逾期/)
  assert.doesNotMatch(html, CJK)
})

test('only a pending alias offers confirm', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events: [],
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialExpanded: true,
    initialAliasesOpen: true,
    aliases,
    hotCustomers: [{ name: 'Baosteel', customerId: 4 }],
  }))
  assert.match(html, /data-testid="alias-panel"/)
  assert.match(html, /data-testid="confirm-alias-1"/)
  assert.doesNotMatch(html, /data-testid="confirm-alias-2"/)
  assert.match(html, /Pending/)
  assert.match(html, /Confirmed/)
  assert.match(html, /Baosteel Group/)
  assert.match(html, /Angang/)
  assert.match(html, />Customer</)
  assert.match(html, />Purchaser</)
  assert.match(html, /placeholder="Optional"/)
  assert.match(html, />Add</)
  assert.doesNotMatch(html, /待确认/)
  assert.doesNotMatch(html, /已确认/)
  assert.doesNotMatch(html, CJK)
})

test('calendar source has no Chinese copy', async () => {
  const component = await fs.readFile(path.join(here, 'HotMiniCalendar.jsx'), 'utf8')
  const util = await fs.readFile(path.join(here, '../utils/hotCalendar.js'), 'utf8')
  assert.doesNotMatch(component, CJK)
  assert.doesNotMatch(util, CJK)
})
