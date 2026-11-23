import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const CUSTOMERS = [
  { id: 11, name: 'Alpha Mill Co.', address: '1 Harbor Road' },
  { id: 12, name: 'Beta Machinery Works' },
  { id: 13, name: 'Gamma Plant Ltd.' },
]

async function render(extra = {}) {
  const { default: EventModal } = await loadJsxModule(path.join(here, 'EventModal.jsx'))
  return renderToStaticMarkup(createElement(EventModal, {
    isOpen: true,
    onClose() {},
    onSave() {},
    event: null,
    users: [{ id: 1, name: 'Ada' }],
    customers: CUSTOMERS,
    agents: [{ id: 7, name: 'North Agent', company: 'North Desk' }],
    isAdmin: true,
    currentUser: { id: 1, name: 'Ada' },
    ...extra,
  }))
}

test('the create-activity customer field is a searchable select, not a native list', async () => {
  const html = await render()
  assert.match(html, /Create employee activity/)
  assert.match(html, /\+ New customer/)
  assert.match(html, /data-searchable-select-trigger="true"/)
  assert.match(html, /Customer Selection/)
  assert.match(html, /id="activity-customer"/)
  // The long customer list must not be dumped into a native <select>.
  assert.doesNotMatch(html, /<option[^>]*>Alpha Mill Co\.</)
  assert.doesNotMatch(html, /<option[^>]*>Beta Machinery Works</)
  assert.doesNotMatch(html, /<option[^>]*>Gamma Plant Ltd\.</)
  // The Agent field was not requested; it stays a native select.
  assert.match(html, /<option value=""[^>]*>Agent Selection<\/option>/)
  assert.match(html, /North Agent/)
})

test('the customer picker keeps the new-customer action and does not render a native customer list', async () => {
  const html = await render()
  assert.match(html, />Customer</)
  assert.match(html, /\+ New customer/)
  assert.match(html, /data-searchable-select-trigger="true"/)
  // Address remains a detail under the field after a selection; it is not option text.
  assert.doesNotMatch(html, /1 Harbor Road/)
})
