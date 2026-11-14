import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(here, '../../../../shared/fixtures/alpine-grid-original.md')

const body = [
  'X axis driven system is with problem',
  '',
  'Beijing No.1 people working on this matter',
  '',
  '- Customer got in general a good impression',
  '- non-critical workpiece of their own',
  '',
  'changed for table movement',
  '',
  '| Term | Share |',
  '| --- | --- |',
  '| Downpayment | 20% downpayment, 70% B/L, 10% FAT |',
  '| Instrument | L/C terms |',
  '',
  'full hydrostatic, full casted part, sufficient reference',
  '',
  '客户对非关键工件的安排保持原文。',
].join('\n')

test('the retained body shows every source phrase, including the table, without markup injection', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: `${body}\n\n<script>alert(1)</script>`,
  }))
  for (const phrase of [
    'X axis driven system is with problem',
    'Beijing No.1 people working on this matter',
    'full hydrostatic, full casted part, sufficient reference',
    'Customer got in general a good impression',
    'non-critical workpiece of their own',
    'changed for table movement',
    '20% downpayment, 70% B/L, 10% FAT',
    'L/C terms',
    '客户对非关键工件的安排保持原文。',
  ]) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(html, /<table/)
  assert.match(html, /<li /)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /text-sm font-normal leading-relaxed/)
})

test('an imported report shows the original body and its targets, not a rewritten section', async () => {
  const { default: VisitReportModal } = await loadJsxModule(path.join(here, '../VisitReportModal.jsx'))
  const report = {
    id: 8,
    title: 'Northline visit',
    status: 'FINAL',
    visitDate: '2026-11-12T00:00:00.000Z',
    canEdit: true,
    author: { id: 1, name: 'Ada North' },
    summary: 'Separate summary.',
    content: {
      bodySource: 'original',
      originalBody: 'X axis driven system is with problem',
      needs: 'This rewritten section must not appear',
      targets: [{ title: 'Follow the L/C terms', date: '2026-11-30', note: 'L/C terms' }],
    },
  }
  const html = renderToStaticMarkup(createElement(VisitReportModal, {
    report, lang: 'en', onClose: () => {}, onSaved: () => {},
  }))
  assert.match(html, /X axis driven system is with problem/)
  assert.match(html, /Follow the L\/C terms/)
  assert.match(html, /Separate summary/)
  assert.match(html, /Targets &amp; Reminders|Targets & Reminders/)
  assert.doesNotMatch(html, /This rewritten section must not appear/)
  assert.doesNotMatch(html, /<textarea/)
})

test('editing an imported report can add a target when extraction found none', async () => {
  const { default: VisitReportModal } = await loadJsxModule(path.join(here, '../VisitReportModal.jsx'))
  const report = {
    id: 8,
    title: 'Northline visit',
    status: 'DRAFT',
    visitDate: '2026-11-12T00:00:00.000Z',
    canEdit: true,
    author: { id: 1, name: 'Ada North' },
    content: { bodySource: 'original', originalBody: 'X axis driven system is with problem', targets: [] },
  }
  const html = renderToStaticMarkup(createElement(VisitReportModal, {
    report, startEditing: true, lang: 'en', onClose: () => {}, onSaved: () => {},
  }))
  assert.match(html, /Add target/)
  assert.match(html, /X axis driven system is with problem/)
  assert.doesNotMatch(html, /Regenerate caption/)
})

test('a pandoc grid table is rendered as a real table with reconstructed wrapped cells', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, { markdown: readFileSync(fixturePath, 'utf8') }))

  // No ASCII scaffolding or a raw dump of pipes in normal reading output.
  assert.doesNotMatch(html, /\+\-{3,}\+/)
  assert.doesNotMatch(html, /\+\-+\+.*\-+\+/)
  assert.doesNotMatch(html, /\| To\s*\|/)
  assert.doesNotMatch(html, /\+\-+\-+\-/)

  for (const name of ['Mornhill', 'Brocklane', 'Industry', 'Quotation', 'Customer', 'Shanghai', 'Holdings', 'Tscharee', 'Telex', 'Milling machine', 'Power generation']) {
    assert.match(html, new RegExp(name))
  }
  assert.match(html, /Participants|Parti cipants/)

  for (const split of ['M ornhill', 'Br ocklane', 'I ndustry', 'T elex', 'H oldings', 'Tsch aree']) {
    assert.doesNotMatch(html, new RegExp(split.replace(/\s+/g, ' ')))
  }

  for (const phrase of [
    'Helena Frost',
    '20% downpayment, 70% B/L, 10% FAT',
    'L/C terms',
    'X axis driven system is with problem',
    'Beijing No.1 people working on this matter',
    'non-critical workpiece of their own',
    'changed for table movement',
    'full hydrostatic, full casted part, sufficient reference',
  ]) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  // Angle brackets stay literal text (React escapes them, they are not markup).
  assert.match(html, /&lt;X&gt;/)
  assert.match(html, /&lt;10 mm&gt;/)

  // Both the grid table and the pipe table render as real tables.
  assert.ok((html.match(/<table/g) || []).length >= 2)
  assert.match(html, /Downpayment/)
  assert.match(html, /Instrument/)
})

test('the retained body keeps soft-wrapped prose, lists, and pipe tables intact', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: [
      'The shop reported that the X axis driven system is with problem.',
      'Beijing No.1 people working on this matter while the gap is held at',
      '<X> and <10 mm>.',
      '',
      '- Keep the L/C terms on the commercial list',
      '- Record the 20% downpayment, 70% B/L, 10% FAT split',
      '',
      '| Term | Share |',
      '| --- | --- |',
      '| Downpayment | 20% downpayment, 70% B/L, 10% FAT |',
      '| Instrument | L/C terms |',
    ].join('\n'),
  }))
  assert.match(html, /The shop reported that the X axis driven system is with problem\. Beijing No\.1 people working on this matter while the gap is held at/)
  assert.match(html, /&lt;X&gt; and &lt;10 mm&gt;\./)
  assert.match(html, /<li /)
  assert.match(html, /<table/)
  assert.doesNotMatch(html, /<script>/)
})
