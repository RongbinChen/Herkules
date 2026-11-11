import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

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

test('collapsed month grid shows dots and stays within the page width', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events,
    today: '2026-11-11',
    initialMonth: '2026-11',
    aliases: [],
    hotCustomers: [],
  }))

  assert.match(html, /data-expanded="false"/)
  assert.match(html, /grid-cols-7/)
  assert.match(html, /class="[^"]*\bw-full\b/)
  assert.match(html, /max-w-full/)
  assert.doesNotMatch(html, /min-w-\[/)
  assert.match(html, /data-testid="day-2026-11-20"[^>]*data-dots="brand"/)
  assert.match(html, /data-testid="day-2026-11-02"[^>]*data-dots="rose"/)
  assert.match(html, /aria-current="date"/)
  assert.match(html, /data-testid="calendar-peek"/)
  assert.match(html, /十二月/)
  assert.doesNotMatch(html, /data-testid="event-list"/)
  assert.doesNotMatch(html, /Baosteel · CNC gantry/)
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
  assert.match(html, /href="\/chinabidding\/tracking\?q=THREAD-A"/)
  assert.match(html, /href="\/chinabidding\/tracking\?q=THREAD-B"/)
  assert.doesNotMatch(html, /href="\/followups\/7"/)
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
  assert.match(html, /信用证开证截止/)
  assert.match(html, /Overdue/)
})

test('only a pending alias offers confirm', async () => {
  const { HotMiniCalendarView } = await loadJsxModule(path.join(here, 'HotMiniCalendar.jsx'))
  const html = render(createElement(HotMiniCalendarView, {
    events: [],
    today: '2026-11-11',
    initialMonth: '2026-11',
    initialAliasesOpen: true,
    aliases,
    hotCustomers: [{ name: 'Baosteel', customerId: 4 }],
  }))
  assert.match(html, /data-testid="confirm-alias-1"/)
  assert.doesNotMatch(html, /data-testid="confirm-alias-2"/)
  assert.match(html, /Pending · 待确认/)
  assert.match(html, /Confirmed · 已确认/)
  assert.match(html, /Baosteel Group/)
  assert.match(html, /Angang/)
})
