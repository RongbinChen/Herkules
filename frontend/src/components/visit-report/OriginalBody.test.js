import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

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
