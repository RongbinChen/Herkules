import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('source cards render only allowlisted deep links and skip invented URLs', async () => {
  const mod = await loadJsxModule(path.join(here, 'SourceCards.jsx'))
  const SourceCards = mod.default
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(SourceCards, {
    sources: [
      { type: 'customer', title: 'Demo Shipbuilding Co.', href: '/customers/12', subtitle: 'Customer' },
      { type: 'project', title: 'Rotor tender', href: '/chinabidding/tracking?q=TK-1' },
      { type: 'followup', title: 'Demo order', href: '/followups/8' },
      { type: 'contracts', title: 'Contracts', href: '/contracts?customerId=12', locked: true },
      { type: 'phishing', title: 'Ignore me', href: 'https://evil.example/customers/12' },
      { type: 'customer', title: 'No href' },
    ],
  })))
  assert.match(html, /href="\/customers\/12"/)
  assert.match(html, /href="\/chinabidding\/tracking\?q=TK-1"/)
  assert.match(html, /href="\/followups\/8"/)
  assert.match(html, /href="\/contracts\?customerId=12"/)
  assert.match(html, /Demo Shipbuilding Co\./)
  assert.match(html, /locked/)
  assert.doesNotMatch(html, /evil\.example/)
  assert.doesNotMatch(html, /Ignore me/)
})
