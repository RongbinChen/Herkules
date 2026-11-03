import test from 'node:test'
import assert from 'node:assert/strict'
import { customerDisplayName, groupVisitReportsByCustomer } from './visitReportGroups.js'

const report = (overrides) => ({
  id: 1,
  title: 'Visit',
  visitDate: '2026-01-01',
  status: 'FINAL',
  customer: { id: 1, name: 'COSCO Shipping Heavy Industry (Shanghai)' },
  author: { id: 7, name: 'Stefan Elze' },
  ...overrides,
})

test('groups by customer, newest visit inside the group, groups by latest visit', () => {
  const coscoOlder = report({
    id: 1,
    title: 'Meeting in Shanghai with TM and Purchasing Dept.',
    visitDate: '2026-01-03',
    customer: { id: 10, name: 'COSCO Shipping Heavy Industry (Shanghai)' },
  })
  const coscoNewer = report({
    id: 2,
    title: 'Follow-up at the yard',
    visitDate: '2026-09-16',
    customer: { id: 10, name: 'COSCO Shipping Heavy Industry (Shanghai)' },
  })
  const anhui = report({
    id: 3,
    title: 'Relocation of the Herkules grinder',
    visitDate: '2026-09-16',
    customer: { id: 11, name: 'Anhui Jinyu Material Co. Ltd.' },
  })
  const zhejiang = report({
    id: 4,
    title: '1st tech. presentation',
    visitDate: '2026-11-01',
    customer: { id: 12, name: 'Zhejiang Jinjiang Group, Henan Branch' },
  })

  // Input is a flat date-desc stream, the shape the list API returns.
  // Zhejiang's latest visit is November, so that section leads. COSCO and
  // Anhui both top out on 16 Sep, so the tie falls back to name order.
  const groups = groupVisitReportsByCustomer([zhejiang, coscoNewer, anhui, coscoOlder], 'en')

  assert.deepEqual(groups.map((g) => g.name), [
    'Zhejiang Jinjiang Group, Henan Branch',
    'Anhui Jinyu Material Co. Ltd.',
    'COSCO Shipping Heavy Industry (Shanghai)',
  ])
  assert.deepEqual(groups[2].reports.map((r) => r.id), [2, 1])
  assert.equal(groups.every((g) => g.unnamed === false), true)
})

test('a customer with a newer latest visit sorts above an earlier name', () => {
  const recent = report({
    id: 1,
    visitDate: '2026-10-30',
    customer: { id: 2, name: 'COSCO' },
  })
  const older = report({
    id: 2,
    visitDate: '2026-09-16',
    customer: { id: 3, name: 'Anhui Jinyu' },
  })
  const groups = groupVisitReportsByCustomer([older, recent], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['COSCO', 'Anhui Jinyu'])
})

test('the latest visit in a group decides its place, not an older visit', () => {
  const coscoOld = report({
    id: 1,
    visitDate: '2026-01-03',
    customer: { id: 10, name: 'COSCO' },
  })
  const anhui = report({
    id: 2,
    visitDate: '2026-09-16',
    customer: { id: 11, name: 'Anhui Jinyu' },
  })
  const coscoNew = report({
    id: 3,
    visitDate: '2026-10-30',
    customer: { id: 10, name: 'COSCO' },
  })
  const groups = groupVisitReportsByCustomer([coscoOld, anhui, coscoNew], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['COSCO', 'Anhui Jinyu'])
  assert.deepEqual(groups[0].reports.map((r) => r.id), [3, 1])
})

test('blank customer names share one group ordered by its own latest visit', () => {
  const named = report({ id: 1, visitDate: '2026-01-01', customer: { id: 1, name: 'HBIS Handan Steel' } })
  const missing = report({ id: 2, visitDate: '2026-12-01', customer: null, title: 'No link' })
  const blank = report({ id: 3, visitDate: '2026-06-01', customer: { id: 9, name: '   ' }, title: 'Blank name' })
  const whitespace = report({ id: 4, visitDate: null, customer: { id: 8, name: '\n\t' } })

  const groups = groupVisitReportsByCustomer([missing, named, blank, whitespace], 'en')

  assert.equal(groups.length, 2)
  // The unnamed bucket's latest visit is December, so it leads HBIS.
  assert.equal(groups[0].unnamed, true)
  assert.equal(groups[0].name, '')
  // Newest dated report first; the undated one stays last.
  assert.deepEqual(groups[0].reports.map((r) => r.id), [2, 3, 4])

  assert.equal(groups[1].name, 'HBIS Handan Steel')
  assert.equal(groups[1].unnamed, false)
  assert.deepEqual(groups[1].reports.map((r) => r.id), [1])
})

test('an older no-customer group sits below a customer with a newer visit', () => {
  const named = report({ id: 1, visitDate: '2026-10-30', customer: { id: 1, name: 'COSCO' } })
  const unnamed = report({ id: 2, visitDate: '2026-02-01', customer: null })
  const groups = groupVisitReportsByCustomer([unnamed, named], 'en')
  assert.deepEqual(groups.map((g) => [g.unnamed, g.name]), [[false, 'COSCO'], [true, '']])
})

test('whitespace-only differences collapse to one display name', () => {
  const a = report({ id: 1, visitDate: '2026-02-01', customer: { id: 1, name: '  COSCO   Shipping  ' } })
  const b = report({ id: 2, visitDate: '2026-08-01', customer: { id: 2, name: 'COSCO Shipping' } })
  const groups = groupVisitReportsByCustomer([a, b], 'en')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'COSCO Shipping')
  assert.deepEqual(groups[0].reports.map((r) => r.id), [2, 1])
  assert.equal(customerDisplayName(a), 'COSCO Shipping')
})

test('different spellings stay in different groups', () => {
  const groups = groupVisitReportsByCustomer([
    report({ id: 1, customer: { id: 1, name: 'COSCO' } }),
    report({ id: 2, customer: { id: 2, name: 'cosco' } }),
  ], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['COSCO', 'cosco'])
})

test('group order uses the latest real visit, and an invalid date stays last inside the group', () => {
  const groups = groupVisitReportsByCustomer([
    report({ id: 1, customer: { id: 1, name: 'Plant 10' }, visitDate: 'not-a-date' }),
    report({ id: 2, customer: { id: 1, name: 'Plant 10' }, visitDate: '2026-05-01' }),
    report({ id: 3, customer: { id: 2, name: 'Plant 2' }, visitDate: '2026-01-01' }),
  ], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['Plant 10', 'Plant 2'])
  assert.deepEqual(groups[0].reports.map((r) => r.id), [2, 1])
})

test('equal latest dates fall back to numeric name order', () => {
  const groups = groupVisitReportsByCustomer([
    report({ id: 1, customer: { id: 1, name: 'Plant 10' }, visitDate: '2026-05-01' }),
    report({ id: 2, customer: { id: 2, name: 'Plant 2' }, visitDate: '2026-05-01' }),
  ], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['Plant 2', 'Plant 10'])
})

test('a group with no parseable visit date sorts after dated groups', () => {
  const groups = groupVisitReportsByCustomer([
    report({ id: 1, customer: { id: 1, name: 'Alpha Mill' }, visitDate: 'not-a-date' }),
    report({ id: 2, customer: { id: 2, name: 'Zulu Works' }, visitDate: '2020-01-01' }),
  ], 'en')
  assert.deepEqual(groups.map((g) => g.name), ['Zulu Works', 'Alpha Mill'])
})

test('a newer visit outranks Chinese name order; equal dates use zh-CN collation', () => {
  const groups = groupVisitReportsByCustomer([
    report({ id: 1, customer: { id: 1, name: '浙江金江' }, visitDate: '2026-09-16' }),
    report({ id: 2, customer: { id: 2, name: '安徽金钰' }, visitDate: '2026-09-16' }),
    report({ id: 4, customer: { id: 2, name: '安徽金钰' }, visitDate: '2026-08-01' }),
    report({ id: 3, customer: { id: 3, name: '中冶' }, visitDate: '2026-10-30' }),
  ], 'zh-CN')
  // 中冶 would sort last by pinyin, but its October visit leads the page.
  assert.deepEqual(groups.map((g) => g.name), ['中冶', '安徽金钰', '浙江金江'])
  assert.deepEqual(groups[1].reports.map((r) => r.id), [2, 4])
})

test('equal visit times keep their incoming order, and the input array is not mutated', () => {
  const first = report({ id: 5, visitDate: '2026-09-16T08:00:00.000Z' })
  const second = report({ id: 6, visitDate: '2026-09-16T08:00:00.000Z' })
  const input = [first, second]
  const groups = groupVisitReportsByCustomer(input, 'en')
  assert.deepEqual(groups[0].reports.map((r) => r.id), [5, 6])
  assert.deepEqual(input.map((r) => r.id), [5, 6])
})

test('empty and non-array input yields no groups', () => {
  assert.deepEqual(groupVisitReportsByCustomer([], 'en'), [])
  assert.deepEqual(groupVisitReportsByCustomer(null, 'zh-CN'), [])
  assert.deepEqual(groupVisitReportsByCustomer(undefined), [])
})

test('grouping only includes the reports it is given, so a team filter drops other customers', () => {
  const wrc = report({ id: 1, authorId: 7, customer: { id: 1, name: 'COSCO Shipping Heavy Industry (Shanghai)' } })
  const hrc = report({ id: 2, authorId: 8, customer: { id: 2, name: 'HBIS Handan Steel' } })
  const visible = [wrc, hrc].filter((r) => r.authorId === 7)
  const groups = groupVisitReportsByCustomer(visible, 'en')
  assert.deepEqual(groups.map((g) => g.name), ['COSCO Shipping Heavy Industry (Shanghai)'])
  assert.deepEqual(groups[0].reports.map((r) => r.id), [1])
})
