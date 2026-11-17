import test from 'node:test'
import assert from 'node:assert/strict'
import { filterVisitReportsByKeyword, parseSearchTokens, visitReportSearchHaystack } from './visitReportSearch.js'

const report = (overrides) => ({
  id: 1,
  title: 'Meeting in Shanghai with TM and Purchasing Dept.',
  visitDate: '2026-09-16T00:00:00.000Z',
  status: 'FINAL',
  summary: 'Discussed the Herkules grinder relocation.',
  rawNotes: 'Follow up on lead time.',
  threadKey: 'cb-123',
  customer: { id: 10, name: 'COSCO Shipping Heavy Industry (Shanghai)' },
  author: { id: 7, name: 'Stefan Elze' },
  content: {
    bodySource: 'original',
    originalBody: 'The yard asked about a roll grinder and spare parts.',
    attendees: 'Customer: 张伟 (Purchasing). WaldrichSiegen: Stefan Elze',
    needs: 'Need a quotation for the new machine.',
    meta: { location: 'Shanghai yard', machineType: 'WS 1000' },
  },
  attachments: [{ storedName: 'abc-photo.jpg', name: 'yard-photo.jpg', caption: 'Gantry on the shop floor' }],
  ...overrides,
})

test('parseSearchTokens trims, lowercases, and splits on whitespace', () => {
  assert.deepEqual(parseSearchTokens('  COSCO   grinder '), ['cosco', 'grinder'])
  assert.deepEqual(parseSearchTokens('上海'), ['上海'])
  assert.deepEqual(parseSearchTokens('   '), [])
  assert.deepEqual(parseSearchTokens(''), [])
  assert.deepEqual(parseSearchTokens(null), [])
})

test('an empty query returns the original list, and does not mutate it', () => {
  const rows = [report({ id: 1 }), report({ id: 2, title: 'Other' })]
  const out = filterVisitReportsByKeyword(rows, '  ')
  assert.equal(out, rows)
  assert.deepEqual(rows.map((r) => r.id), [1, 2])
  assert.deepEqual(filterVisitReportsByKeyword(rows, ''), rows)
  assert.deepEqual(filterVisitReportsByKeyword(null, 'cosco'), [])
  assert.deepEqual(filterVisitReportsByKeyword(undefined, ''), [])
})

test('matches title, customer, author, summary, and notes case-insensitively', () => {
  const row = report()
  assert.deepEqual(filterVisitReportsByKeyword([row], 'purchasing').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'cosco').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'STEFAN').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'relocation').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'lead time').map((r) => r.id), [1])
})

test('matches attendees, location, machine type, and preserved body text', () => {
  const row = report()
  assert.deepEqual(filterVisitReportsByKeyword([row], '张伟').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'yard').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'ws 1000').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'spare parts').map((r) => r.id), [1])
})

test('matches a photo caption and the visit date, but not a storage filename', () => {
  const row = report()
  assert.deepEqual(filterVisitReportsByKeyword([row], 'gantry').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], '2026-09-16').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'abc-photo.jpg'), [])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'original'), [])
})

test('AND-matches every token; a miss on one token drops the report', () => {
  const row = report()
  assert.deepEqual(filterVisitReportsByKeyword([row], 'COSCO grinder').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], 'COSCO turbine'), [])
})

test('keeps reports that match and drops the rest, preserving input order', () => {
  const cosco = report({ id: 1 })
  const anhui = report({
    id: 2,
    title: 'Relocation of the Herkules grinder',
    customer: { id: 11, name: 'Anhui Jinyu Material Co. Ltd.' },
    summary: 'Site survey.',
    rawNotes: '',
    content: { attendees: 'Li Ming', originalBody: 'No mention of the yard.' },
    attachments: [],
    author: { id: 8, name: 'Anna Becker' },
  })
  const hits = filterVisitReportsByKeyword([anhui, cosco], 'cosco')
  assert.deepEqual(hits.map((r) => r.id), [1])
  const both = filterVisitReportsByKeyword([anhui, cosco], 'grinder')
  assert.deepEqual(both.map((r) => r.id), [2, 1])
})

test('the haystack includes Chinese body text for a Chinese keyword', () => {
  const row = report({
    title: '现场拜访',
    summary: '',
    rawNotes: '',
    content: { originalBody: '客户询问轧辊磨床交货期。' },
    customer: { id: 10, name: '中远海运重工（上海）' },
    attachments: [],
  })
  assert.ok(visitReportSearchHaystack(row).includes('轧辊磨床'))
  assert.deepEqual(filterVisitReportsByKeyword([row], '轧辊磨床交货期').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], '中远').map((r) => r.id), [1])
  assert.deepEqual(filterVisitReportsByKeyword([row], '车床'), [])
})
