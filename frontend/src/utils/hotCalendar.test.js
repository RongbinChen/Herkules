import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMonthGrid, chinaToday, dotColors, peekRow, shiftMonth } from './hotCalendar.js'

test('November 2026 starts on Sunday and December peeks onto Tuesday', () => {
  const november = buildMonthGrid('2026-11')
  assert.equal(november[0], '2026-11-01')
  assert.equal(november.filter(Boolean).length, 30)
  assert.equal(november.length % 7, 0)
  assert.equal(november.at(-1), null)

  const peek = peekRow('2026-11')
  assert.equal(peek.month, '2026-12')
  assert.deepEqual(peek.cells, [null, null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'])
  assert.equal(shiftMonth('2026-11', 1), '2026-12')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
})

test('today is a China calendar day, including the UTC evening boundary', () => {
  assert.equal(chinaToday(new Date('2026-11-10T15:59:00.000Z')), '2026-11-10')
  assert.equal(chinaToday(new Date('2026-11-10T16:00:00.000Z')), '2026-11-11')
})

test('a day keeps one dot per color and does not merge events', () => {
  const colors = dotColors([
    { id: 'a', color: 'brand' },
    { id: 'b', color: 'brand' },
    { id: 'c', color: 'violet' },
    { id: 'd', color: 'amber' },
    { id: 'e', color: 'rose' },
  ])
  assert.deepEqual(colors, ['brand', 'violet', 'amber'])
})
