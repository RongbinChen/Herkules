import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const payload = {
  ok: true,
  gmtUrl: 'https://gmt.herkulesgroup-china.com',
  tasks: [{
    id: 11,
    title: 'Spindle alignment',
    type: 'INSTALLATION',
    status: 'PUBLISHED',
    start: '2026-11-12T16:00:00.000Z',
    end: '2026-11-13T08:00:00.000Z',
    siteName: 'Haixi plant',
    equipment: 'Roll grinder',
    engineers: [{ id: 3, name: 'Wei Zhang' }],
    url: 'https://gmt.herkulesgroup-china.com/?task=11',
  }],
  serviceReports: [{
    id: 21,
    originalName: 'Alignment report.docx',
    title: 'Do not use this title',
    status: 'PUBLISHED',
    siteName: 'Haixi plant',
    siteCustomer: 'Qingdao Haixi',
    machineSerial: 'WS-441',
    authorName: 'Wei Zhang',
    publishedAt: '2026-11-12T16:00:00.000Z',
    summary: 'Spindle is within tolerance.',
    url: 'https://gmt.herkulesgroup-china.com/?report=21',
  }],
}

test('field service renders tasks and reports with Beijing dates and GMT links', async () => {
  const { FieldServiceCard } = await loadJsxModule(path.join(here, 'CustomerFieldService.jsx'))
  const html = renderToStaticMarkup(createElement(FieldServiceCard, { phase: 'ready', payload }))

  assert.match(html, /Field service/)
  assert.match(html, /现场服务/)
  assert.match(html, /Open in GMT/)
  assert.match(html, /href="https:\/\/gmt\.herkulesgroup-china\.com"/)
  assert.match(html, /Spindle alignment/)
  assert.match(html, /Installation &amp; commissioning/)
  assert.match(html, /Dispatched/)
  assert.match(html, /Haixi plant/)
  assert.match(html, /Roll grinder/)
  assert.match(html, /Wei Zhang/)
  assert.match(html, /href="https:\/\/gmt\.herkulesgroup-china\.com\/\?task=11"/)
  // 2026-11-12T16:00:00Z is 2026-11-13 00:00 in Beijing, not Nov 12.
  assert.match(html, /11\/13\/2026/)
  assert.doesNotMatch(html, /11\/12\/2026/)
  assert.match(html, /Alignment report\.docx/)
  assert.doesNotMatch(html, /Do not use this title/)
  assert.match(html, /Published/)
  assert.match(html, /S\/N WS-441/)
  assert.match(html, /Spindle is within tolerance/)
  assert.match(html, /href="https:\/\/gmt\.herkulesgroup-china\.com\/\?report=21"/)
})

test('an empty GMT customer gets an empty state, not an error', async () => {
  const { FieldServiceCard } = await loadJsxModule(path.join(here, 'CustomerFieldService.jsx'))
  const html = renderToStaticMarkup(createElement(FieldServiceCard, {
    phase: 'ready',
    payload: { ok: true, gmtUrl: 'https://gmt.herkulesgroup-china.com', tasks: [], serviceReports: [] },
  }))
  assert.match(html, /No field-service tasks or reports for this customer yet/)
  assert.match(html, /Open in GMT/)
  assert.doesNotMatch(html, /Spindle alignment/)
})

test('unconfigured and unreachable GMT stay quiet', async () => {
  const { FieldServiceCard } = await loadJsxModule(path.join(here, 'CustomerFieldService.jsx'))
  const unconfigured = renderToStaticMarkup(createElement(FieldServiceCard, {
    phase: 'ready',
    payload: { ok: false, reason: 'unconfigured', tasks: [], serviceReports: [] },
  }))
  assert.match(unconfigured, /Field service is not connected/)
  assert.doesNotMatch(unconfigured, /No field-service tasks/)

  const unreachable = renderToStaticMarkup(createElement(FieldServiceCard, {
    phase: 'quiet',
    payload: { ok: false, reason: 'unreachable' },
  }))
  assert.match(unreachable, /Field service is temporarily unavailable/)
  assert.match(unreachable, /Open in GMT/)
})
