import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

// 2026-11-13 00:30 Asia/Shanghai. UTC is still 2026-11-12.
const NOW = new Date('2026-11-12T16:30:00.000Z')

function render(ActivityHistory, events, extra = {}) {
  return renderToStaticMarkup(createElement(ActivityHistory, { events, now: NOW, ...extra }))
}

test('past events drop the status badge at the Beijing midnight boundary and keep the type', async () => {
  const { default: ActivityHistory } = await loadJsxModule(path.join(here, 'ActivityHistory.jsx'))

  const past = render(ActivityHistory, [{
    id: 1,
    title: 'Haixi quarterly review',
    start: '2026-11-12T15:30:00.000Z',
    category: 'SALES_MEETING',
    status: 'PLANNED',
    user: { name: 'Ada' },
  }])
  assert.match(past, /Sales Meeting/)
  assert.match(past, /Haixi quarterly review/)
  assert.match(past, /data-activity-type="SALES_MEETING"/)
  assert.doesNotMatch(past, /data-activity-status/)
  assert.doesNotMatch(past, />Planned</)

  const future = render(ActivityHistory, [{
    id: 2,
    title: 'Haixi contract review',
    start: '2026-11-12T17:00:00.000Z',
    category: 'BREAK',
    status: 'PLANNED',
  }])
  assert.match(future, /Final Negotiation/)
  assert.match(future, /data-activity-type="BREAK"/)
  assert.match(future, /data-activity-status="PLANNED"/)
  assert.match(future, />Planned</)

  const naiveFuture = render(ActivityHistory, [{
    id: 3,
    title: 'Shop-floor walkthrough',
    start: '2026-11-13T01:00',
    category: 'MEETING',
    status: 'IN_PROGRESS',
  }])
  assert.match(naiveFuture, /Technical Discussion/)
  assert.match(naiveFuture, /data-activity-status="IN_PROGRESS"/)
  assert.match(naiveFuture, />In Progress</)
})

test('visit-report reminder rows keep Done even when the reminder time is past', async () => {
  const { default: ActivityHistory } = await loadJsxModule(path.join(here, 'ActivityHistory.jsx'))
  const html = render(ActivityHistory, [
    {
      id: 8,
      title: 'Past sales meeting',
      start: '2026-10-01T02:00:00.000Z',
      category: 'SALES_MEETING',
      status: 'PLANNED',
    },
    {
      id: 9,
      visitReportId: 4,
      title: '⏰ Contract signing target',
      description: 'From visit report: Qingdao visit\nBring the draft',
      start: '2026-10-02T02:00:00.000Z',
      category: 'REMINDER',
      status: 'DONE',
      user: { name: 'Bo' },
    },
  ], { visitReports: [{ id: 4, title: 'Qingdao visit' }] })

  assert.match(html, /From visit report:/)
  assert.match(html, /Qingdao visit/)
  assert.match(html, /Contract signing target/)
  assert.match(html, /data-reminder-status="DONE"/)
  assert.match(html, />Done</)
  assert.doesNotMatch(html, /data-activity-status/)
  assert.doesNotMatch(html, />Planned</)
})
