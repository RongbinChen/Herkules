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

test('visit reports render as a list with overview facts, not a truncated card grid', async () => {
  const mod = await loadJsxModule(path.join(here, 'SourceCards.jsx'))
  const SourceCards = mod.default
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(SourceCards, {
    lang: 'en',
    sources: [
      { type: 'customer', title: 'COSCO Shipping Heavy Industry (Shanghai)', href: '/customers/12' },
      {
        type: 'report',
        title: 'Shanghai Hongguang Boiler Reference Visit for COSCO machining',
        href: '/visit-reports/58',
        visitDate: '2026-10-30',
        location: 'Shanghai Hongguang',
        customer: 'COSCO Shipping Heavy Industry (Shanghai)',
        summary: 'Reference visit to compare machining capacity ahead of the Dec 10 target.',
      },
      {
        type: 'reminder',
        title: '⏰ Keep contact (WRC)',
        href: '/visit-reports/58?remindDate=2026-11-30#remind-abc',
        visitReportId: 58,
        start: '2026-11-30T01:00:00.000Z',
        reportTitle: 'Shanghai Hongguang Boiler Reference Visit for COSCO machining',
      },
    ],
  })))
  assert.match(html, /Visit reports/)
  assert.match(html, /Shanghai Hongguang Boiler Reference Visit for COSCO machining/)
  assert.match(html, /2026-10-30 · Shanghai Hongguang · COSCO Shipping Heavy Industry \(Shanghai\)/)
  assert.match(html, /Reference visit to compare machining capacity/)
  assert.match(html, /Reminder/)
  assert.match(html, /Keep contact \(WRC\)/)
  assert.match(html, /href="\/visit-reports\/58\?remindDate=2026-11-30#remind-abc"/)
  assert.doesNotMatch(html, /sm:grid-cols-2[^"]*"[^>]*>[^<]*Shanghai Hongguang Boiler/)
  // The long report title must not be CSS-truncated away.
  assert.doesNotMatch(html, /truncate[^"]*"[^>]*>Shanghai Hongguang Boiler Reference Visit/)
  // Customer stays a card and is not relabeled as a report.
  assert.match(html, /Customer/)
  assert.match(html, /href="\/customers\/12"/)
})

test('source type labels follow the Ask AI language toggle', async () => {
  const mod = await loadJsxModule(path.join(here, 'SourceCards.jsx'))
  const SourceCards = mod.default
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(SourceCards, {
    lang: 'zh',
    sources: [
      {
        type: 'report',
        title: '沪东拜访',
        href: '/visit-reports/11',
        visitDate: '2026-10-28',
        summary: '讨论了交货期。',
      },
    ],
  })))
  assert.match(html, /拜访报告/)
  assert.match(html, /讨论了交货期/)
  assert.doesNotMatch(html, /Visit report/)
})
