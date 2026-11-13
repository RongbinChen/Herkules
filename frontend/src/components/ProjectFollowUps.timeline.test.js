import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const catalogue = [
  { kind: 'CONTRACT_EFFECTIVE', en: 'Contract effective', zh: '合同生效', group: 'contract' },
  { kind: 'LC_OPEN_DEADLINE', en: 'L/C to be opened by', zh: '信用证开证截止', group: 'lc' },
  { kind: 'LC_PRESENTATION', en: 'Document presentation due', zh: '交单期', group: 'lc' },
  { kind: 'WARRANTY_EXPIRY', en: 'Warranty expires', zh: '质保到期', group: 'exec' },
]

test('fill timeline shows a correction separately from empty milestones', async () => {
  const { TimelineSuggestionList } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const html = renderToStaticMarkup(createElement(TimelineSuggestionList, {
    followUpId: 3,
    catalogue,
    replace: false,
    picked: { CONTRACT_EFFECTIVE: true },
    applying: false,
    existing: [
      { kind: 'CONTRACT_EFFECTIVE', dueDate: '2026-10-30', doneAt: '2026-10-30' },
      { kind: 'LC_OPEN_DEADLINE', dueDate: '2027-03-04', doneAt: null },
    ],
    proposals: [
      {
        kind: 'CONTRACT_EFFECTIVE',
        dueDate: '2026-09-04',
        zh: '合同生效',
        docType: 'COMMERCIAL',
        correction: true,
        storedDate: '2026-10-30',
        storedDone: true,
        notes: 'Effective on signing',
      },
      {
        kind: 'LC_OPEN_DEADLINE',
        dueDate: '2027-03-04',
        docType: 'COMMERCIAL',
        notes: 'Opened six months after signing',
      },
      {
        kind: 'LC_PRESENTATION',
        dueDate: '2028-04-25',
        docType: 'COMMERCIAL',
        notes: '21 days after the B/L date',
      },
      {
        kind: 'WARRANTY_EXPIRY',
        dueDate: null,
        clearDate: true,
        correction: true,
        storedDate: '2027-09-04',
        docType: 'TECHNICAL',
        notes: '12 months from FAC, or 23 months from the last B/L, whichever first',
      },
    ],
    conditional: [{
      label: 'Second L/C opening (conditional)',
      dueDate: '2028-07-04',
      conditional: true,
      docType: 'COMMERCIAL',
      notes: 'One month before the last lot, before engineers are sent.',
    }],
  }))

  assert.match(html, /Contract effective/)
  assert.match(html, /合同生效/)
  assert.doesNotMatch(html, /定金到账/)
  assert.match(html, /2026-10-30 on the record → 2026-09-04/)
  assert.match(html, /Marked done\. Applying changes the date only\./)
  assert.match(html, /Correction/)
  assert.match(html, /L\/C to be opened by/)
  assert.match(html, /Kept — already filled/)
  assert.match(html, /2028-04-25/)
  assert.match(html, /Commercial/)
  assert.match(html, /2027-09-04 is not what this contract counts\. Clear it\./)
  assert.match(html, /Second L\/C opening \(conditional\)/)
  assert.match(html, /2028-07-04/)
  assert.match(html, /Conditional — not written as L\/C to be opened by/)
  assert.match(html, /Apply to empty milestones/)
  assert.match(html, /Apply selected corrections \(1\)/)
  const effectiveAt = html.indexOf('Contract effective')
  const keptAt = html.indexOf('Kept — already filled')
  assert.ok(effectiveAt > -1 && keptAt > effectiveAt)
  assert.doesNotMatch(html.slice(effectiveAt, html.indexOf('L/C to be opened by')), /Kept — already filled/)
})

test('a down-payment contract may say so on the effective row', async () => {
  const { TimelineSuggestionList } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const html = renderToStaticMarkup(createElement(TimelineSuggestionList, {
    followUpId: null,
    catalogue,
    replace: false,
    picked: {},
    proposals: [{
      kind: 'CONTRACT_EFFECTIVE',
      dueDate: '2026-10-26',
      zh: '合同生效（定金到账）',
      docType: 'COMMERCIAL',
      notes: 'Effective when the down payment is received',
    }],
    conditional: [],
    existing: [],
  }))
  assert.match(html, /合同生效（定金到账）/)
  assert.match(html, /Commercial/)
  assert.doesNotMatch(html, /Technical/)
})
