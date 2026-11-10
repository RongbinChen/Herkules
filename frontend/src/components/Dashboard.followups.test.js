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

const chase = {
  id: 2,
  title: 'Roll grinder',
  orderNo: 'HRC-9',
  status: 'ACTIVE',
  customerName: 'Baowu Steel',
  ownerName: 'Ada',
  signedOn: '2026-09-01',
  overdueCount: 1,
  next: {
    kind: 'LC_OPEN_DEADLINE',
    label: 'L/C to be opened by',
    zh: '信用证开证截止',
    short: 'L/C open',
    dueDate: '2026-11-01',
    cue: '9d over',
    tone: 'overdue',
    ownerName: 'Bo',
  },
  dates: [
    {
      kind: 'LC_OPEN_DEADLINE',
      label: 'L/C to be opened by',
      zh: '信用证开证截止',
      short: 'L/C open',
      dueDate: '2026-11-01',
      cue: '9d over',
      tone: 'overdue',
      ownerName: 'Bo',
    },
    {
      kind: 'PAYMENT_DOWN',
      label: 'Down payment received',
      zh: '预付款到账',
      short: 'Down payment',
      dueDate: '2026-11-18',
      cue: 'in 8d',
      tone: 'soon',
      ownerName: 'Ada',
    },
  ],
  moreDates: 1,
  contractValue: 'USD 980,000',
  notes: 'private account 9988 and a paragraph nobody should scan on the home page',
}

test('a follow-up row is a compact deep link with the next date, owner, and other due dates', async () => {
  const { FollowUpStatusRow } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const html = render(createElement(FollowUpStatusRow, { item: chase }))

  assert.match(html, /href="\/followups\/2"/)
  assert.match(html, /Baowu Steel/)
  assert.match(html, /Roll grinder/)
  assert.match(html, /#HRC-9/)
  assert.match(html, />Overdue</)
  assert.match(html, /2026-11-01/)
  assert.match(html, /9d over/)
  assert.match(html, /L\/C to be opened by/)
  assert.match(html, /信用证开证截止/)
  assert.match(html, /Bo/)
  assert.match(html, /Down payment 11-18/)
  assert.match(html, /\+1</)
  // Phone: the date shares a line with the badge and is hidden from sm up.
  // Desktop: the date sits on the title line and is hidden below sm.
  assert.match(html, /flex-col gap-y-1/)
  assert.match(html, /sm:flex-row/)
  assert.match(html, /sm:hidden/)
  assert.match(html, /hidden max-w-full/)
  assert.match(html, /sm:line-clamp-1/)
  assert.match(html, /line-clamp-2/)
  assert.match(html, /flex min-w-0 flex-wrap items-baseline/)
  assert.match(html, /flex min-w-0 flex-wrap gap-x-2/)
  assert.doesNotMatch(html, /980,000/)
  assert.doesNotMatch(html, /9988/)
  assert.doesNotMatch(html, /private account/)
})

test('on hold and an empty timeline stay one short line', async () => {
  const { FollowUpStatusRow } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const held = render(createElement(FollowUpStatusRow, {
    item: {
      id: 8,
      title: 'Waiting on funds',
      orderNo: 'WRC-3',
      status: 'ON_HOLD',
      customerName: 'COSCO',
      ownerName: 'Ada',
      next: {
        kind: 'DRAWING_APPROVAL',
        label: 'Drawings / spec approved',
        zh: '图纸/技术协议确认',
        short: 'Drawings',
        dueDate: '2026-12-01',
        cue: 'in 21d',
        tone: 'later',
        ownerName: 'Ada',
      },
      dates: [],
      moreDates: 0,
    },
  }))
  assert.match(held, /href="\/followups\/8"/)
  assert.match(held, />Next</)
  assert.match(held, /On hold/)
  assert.match(held, /in 21d/)
  assert.match(held, /图纸\/技术协议确认/)
  // No second open date, so the chip row is not rendered.
  assert.doesNotMatch(held, /mt-1 flex min-w-0 flex-wrap/)

  const empty = render(createElement(FollowUpStatusRow, {
    item: {
      id: 3,
      title: 'Dates not in yet',
      orderNo: null,
      status: 'ACTIVE',
      customerName: null,
      ownerName: null,
      next: null,
      dates: [],
      moreDates: 0,
    },
  }))
  assert.match(empty, /href="\/followups\/3"/)
  assert.match(empty, />No date</)
  assert.match(empty, /No open date/)
  assert.match(empty, /Unassigned/)
  assert.match(empty, /Dates not in yet/)
})

test('the section hides when there is nothing to do and links to the follow-up list', async () => {
  const { FollowUpStatusSection } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  assert.equal(render(createElement(FollowUpStatusSection, { items: [], total: 0 })), '')

  const html = render(createElement(FollowUpStatusSection, { items: [chase], total: 9 }))
  assert.match(html, /id="followup-status-heading"/)
  assert.match(html, /Project follow-up/)
  assert.match(html, /Recently signed orders/)
  assert.match(html, /href="\/followups"/)
  assert.match(html, /href="\/followups\/2"/)
  assert.match(html, />9</)
  assert.match(html, /\+8 more/)
})
