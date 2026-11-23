import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('numbered visit-report lists render as a list with a trusted report link, not a table', async () => {
  const mod = await loadJsxModule(path.join(here, 'ChatMarkdown.jsx'))
  const Md = mod.default
  const text = [
    '**Recent visits**(1)',
    '',
    '1. **Reference visit at the boiler plant**',
    '   Date: November 12, 2026',
    '   Overview: Reviewed milling machines on site.',
    '   Report link: [View report](/visit-reports/54)',
  ].join('\n')
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(Md, { text })))
  assert.match(html, /<ol /)
  assert.match(html, /Reference visit at the boiler plant/)
  assert.match(html, /Date: November 12, 2026/)
  assert.match(html, /Overview: Reviewed milling machines on site\./)
  assert.match(html, /href="\/visit-reports\/54"/)
  assert.match(html, />View report</)
  assert.doesNotMatch(html, /<table/)
  assert.doesNotMatch(html, /overflow-x-auto/)
})

test('Chinese list labels and 报告链接 render, and the typo 连接 is not required', async () => {
  const mod = await loadJsxModule(path.join(here, 'ChatMarkdown.jsx'))
  const Md = mod.default
  const text = [
    '1. **扬州技术交流**',
    '   日期：2026年10月28日',
    '   概述：讨论了规格更新。',
    '   报告链接：[点击查看](/visit-reports/46)',
  ].join('\n')
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(Md, { text })))
  assert.match(html, /<ol /)
  assert.match(html, /日期：2026年10月28日/)
  assert.match(html, /概述：讨论了规格更新。/)
  assert.match(html, /报告链接/)
  assert.match(html, /href="\/visit-reports\/46"/)
  assert.match(html, />点击查看</)
})
