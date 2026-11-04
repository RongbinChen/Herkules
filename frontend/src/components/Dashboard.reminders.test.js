import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

function renderRow(ReminderRow, ev) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(ReminderRow, { ev, onResolved: () => {} }),
  ))
}

const base = {
  id: 1,
  title: 'To remind COSCO to check spec and scope (WRC)',
  start: '2026-11-03T01:00:00.000Z',
  customer: { name: 'COSCO Shipping Heavy Industry (Shanghai)' },
}

test('desktop shows the overflow actions inline and keeps the menu for narrow screens', async () => {
  const { ReminderRow } = await loadJsxModule(path.join(here, 'Dashboard.jsx'))
  const html = renderRow(ReminderRow, base)

  assert.match(html, /COSCO Shipping Heavy Industry \(Shanghai\)/)
  assert.match(html, /2026-11-03/)
  assert.match(html, /hidden shrink-0 items-center gap-0\.5 md:flex/)
  assert.match(html, /aria-label="Reminder actions"/)
  assert.match(html, /aria-label="More actions"/)
  assert.match(html, /md:hidden/)
  // Menu stays closed, so each label is the inline control exactly once.
  assert.equal(html.split('Postpone').length - 1, 1)
  assert.equal(html.split('No timeframe').length - 1, 1)
  assert.equal(html.split('>Delete<').length - 1, 1)
  assert.doesNotMatch(html, /Open visit report/)
  assert.match(html, /bg-emerald-600/)
  assert.match(html, />Done</)
  assert.match(html, /text-red-600[^"]*"[^>]*>Delete</)
  assert.match(html, /title="Keep the reminder without a due date/)
})

test('Open visit report is inline only when the reminder belongs to a report', async () => {
  const { ReminderRow } = await loadJsxModule(path.join(here, 'Dashboard.jsx'))
  const html = renderRow(ReminderRow, { ...base, visitReportId: 42 })

  assert.equal(html.split('Open visit report').length - 1, 1)
  assert.equal(html.split('Postpone').length - 1, 1)
  assert.equal(html.split('No timeframe').length - 1, 1)
  assert.equal(html.split('>Delete<').length - 1, 1)
  // Still a button that goes through visitReportRemindLocation, not a bare link.
  assert.doesNotMatch(html, /href="\/visit-reports\//)
})
