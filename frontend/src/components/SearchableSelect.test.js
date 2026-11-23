import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'
import { DEFAULT_MENU_MAX_HEIGHT } from '../utils/searchableSelect.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const OPTIONS = [
  { value: '1', label: 'Alpha Mill Co.' },
  { value: '2', label: 'Beta Machinery Works' },
  { value: '3', label: 'Gamma Plant Ltd.' },
]

async function render(props) {
  const { default: SearchableSelect } = await loadJsxModule(path.join(here, 'SearchableSelect.jsx'))
  return renderToStaticMarkup(createElement(SearchableSelect, {
    options: OPTIONS,
    value: '',
    onChange() {},
    placeholder: 'Customer Selection',
    searchPlaceholder: 'Search customers…',
    emptyMessage: 'No matching customers',
    ...props,
  }))
}

test('the closed trigger shows the selected label or the placeholder', async () => {
  const empty = await render({ value: '' })
  assert.match(empty, /data-searchable-select-trigger="true"/)
  assert.match(empty, /Customer Selection/)
  assert.doesNotMatch(empty, /data-searchable-select-menu/)
  assert.doesNotMatch(empty, /Beta Machinery Works/)

  const selected = await render({ value: '2' })
  assert.match(selected, /Beta Machinery Works/)
  assert.doesNotMatch(selected, /Customer Selection/)
})

test('an open menu has a sticky search field and a max-height scrolling list', async () => {
  const html = await render({ defaultOpen: true })
  assert.match(html, /data-searchable-select-menu="true"/)
  assert.match(html, /placeholder="Search customers…"/)
  assert.match(html, /data-searchable-select-list="true"/)
  assert.match(html, /overflow-y-auto/)
  assert.match(html, /overflow-hidden/)
  assert.match(html, new RegExp(`max-height:${DEFAULT_MENU_MAX_HEIGHT}px`))
  assert.match(html, /Alpha Mill Co\./)
  assert.match(html, /Beta Machinery Works/)
  assert.match(html, /Gamma Plant Ltd\./)

  const searchIndex = html.indexOf('placeholder="Search customers…"')
  const listIndex = html.indexOf('data-searchable-select-list="true"')
  assert.ok(searchIndex >= 0 && listIndex > searchIndex, 'search field stays above the scrolling list')
})

test('an open menu with a query only lists case-insensitive name matches', async () => {
  const html = await render({ defaultOpen: true, defaultQuery: 'beta' })
  assert.match(html, /Beta Machinery Works/)
  assert.doesNotMatch(html, /Alpha Mill Co\./)
  assert.doesNotMatch(html, /Gamma Plant Ltd\./)

  const empty = await render({ defaultOpen: true, defaultQuery: 'nope' })
  assert.match(empty, /No matching customers/)
  assert.doesNotMatch(empty, /Alpha Mill Co\./)
})
