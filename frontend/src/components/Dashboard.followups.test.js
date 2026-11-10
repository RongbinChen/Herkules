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

const lcOverdue = {
  kind: 'LC_OPEN_DEADLINE',
  label: 'L/C to be opened by',
  zh: '信用证开证截止',
  short: 'L/C open',
  dueDate: '2026-11-01',
  cue: '9d over',
  tone: 'overdue',
  ownerName: 'Bo',
}

const downOverdue = {
  kind: 'PAYMENT_DOWN',
  label: 'Down payment received',
  zh: '预付款到账',
  short: 'Down payment',
  dueDate: '2026-10-20',
  cue: '21d over',
  tone: 'overdue',
  ownerName: 'Ada',
}

const chase = {
  id: 2,
  title: 'Roll grinder',
  orderNo: 'HRC-9',
  machineSerial: '5.1022',
  status: 'ACTIVE',
  customerName: 'Baowu Steel',
  ownerName: 'Ada',
  signedOn: '2026-09-01',
  overdueCount: 3,
  moreOverdue: 1,
  next: lcOverdue,
  overdue: [downOverdue, lcOverdue],
  dates: [
    downOverdue,
    lcOverdue,
    {
      kind: 'PAYMENT_SHIPMENT',
      label: 'Shipment payment received',
      zh: '发货款到账',
      short: 'Ship payment',
      dueDate: '2027-01-30',
      cue: 'in 81d',
      tone: 'later',
      ownerName: 'Ada',
    },
  ],
  moreDates: 1,
  contractValue: 'USD 980,000',
  notes: 'private account 9988 and a paragraph nobody should scan on the home page',
}

const soon = {
  kind: 'LC_OPEN_DEADLINE',
  label: 'L/C to be opened by',
  zh: '信用证开证截止',
  short: 'L/C open',
  dueDate: '2026-11-15',
  cue: 'in 5d',
  tone: 'soon',
  ownerName: 'Becky Chen',
}

test('a follow-up row leads with the serial, the next action, and the overdue list', async () => {
  const { FollowUpStatusRow } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const html = render(createElement(FollowUpStatusRow, { item: chase }))

  assert.match(html, /href="\/followups\/2"/)
  assert.match(html, /Serial/)
  assert.match(html, /5\.1022/)
  // Customer once, as orientation. The project title stays in the tooltip.
  assert.equal(html.split('Baowu Steel').length - 1, 2) // visible hint + title attribute
  assert.match(html, /title="Serial 5\.1022 · Baowu Steel · #HRC-9 · Roll grinder"/)
  assert.doesNotMatch(html, /Baowu Steel · Baowu Steel/)
  assert.doesNotMatch(html, /Baowu Steel —/)
  assert.match(html, />Overdue</)
  assert.match(html, /2026-11-01/)
  assert.match(html, /9d over/)
  assert.match(html, /L\/C to be opened by/)
  assert.match(html, /follow-up by Bo/)
  assert.doesNotMatch(html, /[\u4e00-\u9fff]/)
  assert.match(html, /Also overdue/)
  assert.match(html, /Down payment/)
  assert.match(html, /10-20/)
  assert.match(html, /21d over/)
  assert.match(html, /\+1</)
  // The next milestone is the action, not a second copy in the overdue list.
  const list = html.slice(html.indexOf('Also overdue'))
  assert.match(list, /Down payment/)
  assert.doesNotMatch(list, /L\/C open/)
  // A later open date is not an overdue item, so it stays off the row.
  assert.doesNotMatch(html, /Ship payment/)
  assert.doesNotMatch(html, /01-30/)
  // Phone: the date shares a line with the badge and is hidden from sm up.
  // Desktop: the date sits on the title line and is hidden below sm.
  assert.match(html, /flex-col gap-y-1/)
  assert.match(html, /sm:flex-row/)
  assert.match(html, /sm:hidden/)
  assert.match(html, /hidden max-w-full/)
  assert.match(html, /flex min-w-0 flex-wrap items-baseline/)
  assert.doesNotMatch(html, /980,000/)
  assert.doesNotMatch(html, /9988/)
  assert.doesNotMatch(html, /private account/)
})

test('the title line does not repeat the customer when the order title already contains it', async () => {
  const { FollowUpStatusRow, followUpStripIdentity } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const name = 'Shenyang Fortune Precision Equipment Co., Ltd.'
  const item = {
    id: 21,
    title: `${name} — GRG-FCJM-202608A`,
    orderNo: 'GRG-FCJM-202608A',
    machineSerial: null,
    status: 'ACTIVE',
    customerName: name,
    ownerName: 'Becky Chen',
    overdueCount: 0,
    overdue: [],
    moreOverdue: 0,
    next: soon,
    dates: [
      soon,
      {
        kind: 'PAYMENT_SHIPMENT',
        label: 'Shipment payment received',
        short: 'Ship payment',
        dueDate: '2027-01-30',
        cue: 'in 81d',
        tone: 'later',
      },
      {
        kind: 'SHIPMENT',
        label: 'Shipment / customs',
        short: 'Shipment',
        dueDate: '2027-01-30',
        cue: 'in 81d',
        tone: 'later',
      },
    ],
    moreDates: 0,
  }

  const identity = followUpStripIdentity(item)
  assert.equal(identity.serial, '')
  assert.equal(identity.primary, name)
  assert.equal(identity.hint, '#GRG-FCJM-202608A')
  assert.equal(identity.tooltip, `${name} · #GRG-FCJM-202608A`)
  assert.doesNotMatch(identity.tooltip, /—/)

  const html = render(createElement(FollowUpStatusRow, { item }))
  assert.equal(html.split(name).length - 1, 2) // visible name + the same name in the title attribute
  assert.doesNotMatch(html, /Ltd\.\s*·\s*Shenyang/)
  assert.doesNotMatch(html, /Ltd\.\s*—\s*GRG/)
  assert.match(html, /#GRG-FCJM-202608A/)
  assert.match(html, />Next</)
  assert.match(html, /L\/C to be opened by · /)
  assert.match(html, /follow-up by Becky Chen/)
  assert.doesNotMatch(html, /[\u4e00-\u9fff]/)
  assert.match(html, /2026-11-15/)
  assert.match(html, /in 5d/)
  assert.doesNotMatch(html, />Overdue</)
  assert.doesNotMatch(html, /Ship payment/)
  assert.doesNotMatch(html, /Shipment/)
})

test('a serial with nothing overdue shows the next action and no overdue list', async () => {
  const { FollowUpStatusRow } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const html = render(createElement(FollowUpStatusRow, {
    item: {
      id: 4,
      title: 'Plate line',
      orderNo: 'HRC-2',
      machineSerial: ' SN-88 ',
      status: 'ACTIVE',
      customerName: 'Ansteel',
      ownerName: 'Ada',
      overdueCount: 0,
      overdue: [],
      moreOverdue: 0,
      next: soon,
      dates: [soon],
      moreDates: 0,
    },
  }))
  assert.match(html, /Serial/)
  assert.match(html, /SN-88/)
  assert.match(html, /Ansteel/)
  assert.match(html, /L\/C to be opened by/)
  assert.match(html, /in 5d/)
  assert.doesNotMatch(html, />Overdue</)
  assert.doesNotMatch(html, /Also overdue/)

  // One overdue milestone is the next action. It is not listed a second time.
  const only = render(createElement(FollowUpStatusRow, {
    item: {
      id: 5,
      title: 'One late date',
      orderNo: 'HRC-3',
      machineSerial: '5.1001',
      status: 'ACTIVE',
      customerName: 'Ansteel',
      ownerName: 'Ada',
      overdueCount: 1,
      moreOverdue: 0,
      next: {
        kind: 'LC_OPEN_DEADLINE',
        label: 'L/C to be opened by',
        zh: '信用证开证截止',
        short: 'L/C open',
        dueDate: '2026-11-01',
        cue: '9d over',
        tone: 'overdue',
        ownerName: 'Ada',
      },
      overdue: [{
        kind: 'LC_OPEN_DEADLINE',
        label: 'L/C to be opened by',
        zh: '信用证开证截止',
        short: 'L/C open',
        dueDate: '2026-11-01',
        cue: '9d over',
        tone: 'overdue',
        ownerName: 'Ada',
      }],
    },
  }))
  assert.match(only, />Overdue</)
  assert.match(only, /L\/C to be opened by/)
  assert.doesNotMatch(only, /Also overdue/)
  assert.equal(only.split('L/C open').length - 1, 0)
})

test('on hold and an empty timeline stay one short line', async () => {
  const { FollowUpStatusRow } = await loadJsxModule(path.join(here, 'DashboardFollowUps.jsx'))
  const held = render(createElement(FollowUpStatusRow, {
    item: {
      id: 8,
      title: 'Waiting on funds',
      orderNo: 'WRC-3',
      machineSerial: '',
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
      overdue: [],
      dates: [],
      moreDates: 0,
    },
  }))
  assert.match(held, /href="\/followups\/8"/)
  assert.match(held, />Next</)
  assert.match(held, /On hold/)
  assert.match(held, /COSCO/)
  assert.match(held, /#WRC-3/)
  assert.match(held, /in 21d/)
  assert.match(held, /follow-up by Ada/)
  assert.doesNotMatch(held, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(held, /COSCO · COSCO/)
  // Nothing is overdue, so the overdue list is not rendered.
  assert.doesNotMatch(held, /Also overdue/)

  const empty = render(createElement(FollowUpStatusRow, {
    item: {
      id: 3,
      title: 'Dates not in yet',
      orderNo: null,
      status: 'ACTIVE',
      customerName: null,
      machineSerial: null,
      ownerName: null,
      next: null,
      overdue: [],
      dates: [],
      moreDates: 0,
    },
  }))
  assert.match(empty, /href="\/followups\/3"/)
  assert.match(empty, />No date</)
  assert.match(empty, /No open date/)
  assert.match(empty, /follow-up by Unassigned/)
  assert.match(empty, /Dates not in yet/)
  assert.doesNotMatch(empty, /Serial/)
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
