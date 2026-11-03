import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('customer group headers follow the language toggle', async () => {
  const { default: CustomerGroupHeader } = await loadJsxModule(path.join(here, 'CustomerGroupHeader.jsx'))

  const enNamed = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    name: 'COSCO Shipping Heavy Industry (Shanghai)',
    count: 2,
    lang: 'en',
    headingId: 'vr-customer-group-0',
  }))
  assert.match(enNamed, /COSCO Shipping Heavy Industry \(Shanghai\)/)
  assert.match(enNamed, /aria-label="2 reports"/)
  assert.match(enNamed, /🏢/)
  assert.match(enNamed, /id="vr-customer-group-0"/)
  assert.doesNotMatch(enNamed, /无客户/)

  const zhNamed = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    name: 'COSCO Shipping Heavy Industry (Shanghai)',
    count: 2,
    lang: 'zh',
  }))
  assert.match(zhNamed, /aria-label="共 2 篇"/)
  assert.match(zhNamed, /COSCO Shipping Heavy Industry \(Shanghai\)/)

  const enNone = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    unnamed: true,
    count: 1,
    lang: 'en',
  }))
  assert.match(enNone, /No customer/)
  assert.match(enNone, /data-customer-group="none"/)
  assert.match(enNone, /aria-label="1 report"/)
  assert.doesNotMatch(enNone, /🏢/)
  assert.doesNotMatch(enNone, /无客户/)

  const zhNone = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    unnamed: true,
    count: 3,
    lang: 'zh',
  }))
  assert.match(zhNone, /无客户/)
  assert.match(zhNone, /aria-label="共 3 篇"/)
  assert.doesNotMatch(zhNone, /No customer/)
})

test('customer group headers read as section titles, not body rows', async () => {
  const { default: CustomerGroupHeader } = await loadJsxModule(path.join(here, 'CustomerGroupHeader.jsx'))

  const named = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    name: 'COSCO',
    count: 4,
    lang: 'en',
    sticky: true,
  }))
  assert.match(named, /text-base/)
  assert.match(named, /font-bold/)
  assert.match(named, /border-l-brand-600/)
  assert.match(named, /bg-white/)
  assert.match(named, /py-3\.5/)
  assert.match(named, /bg-brand-100/)

  const unnamed = renderToStaticMarkup(createElement(CustomerGroupHeader, {
    unnamed: true,
    count: 1,
    lang: 'en',
    sticky: true,
  }))
  assert.match(unnamed, /border-l-slate-400/)
  assert.match(unnamed, /text-slate-600/)
  assert.doesNotMatch(unnamed, /border-l-brand-600/)
  assert.doesNotMatch(unnamed, /🏢/)
})
