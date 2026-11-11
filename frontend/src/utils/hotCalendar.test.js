import test from 'node:test'
import assert from 'node:assert/strict'
import { WEEKDAYS, bidCalendarEvents, buildMonthGrid, chinaToday, dotColors, monthLabel, peekRow, shiftMonth } from './hotCalendar.js'

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

test('month and weekday labels are English only', () => {
  assert.equal(monthLabel('2026-11'), 'November 2026')
  assert.equal(monthLabel('2026-12'), 'December 2026')
  assert.deepEqual(WEEKDAYS.map((day) => day.short), ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
  const text = [
    monthLabel('2026-08'),
    ...WEEKDAYS.map((day) => `${day.short} ${day.title}`),
  ].join(' ')
  assert.doesNotMatch(text, /[\u4e00-\u9fff]/)
  assert.match(text, /August 2026/)
  assert.match(text, /Sunday/)
})

test('follow-up milestones are not bid-calendar events', () => {
  const kept = bidCalendarEvents([
    {
      id: 'tender:A:deadline',
      source: 'tender',
      kind: 'deadline',
      href: '/chinabidding/tracking?q=THREAD-A',
      detail: 'Bid deadline',
    },
    {
      id: 'followup:7:LC_OPEN_DEADLINE',
      source: 'followup',
      kind: 'LC_OPEN_DEADLINE',
      followUpId: 7,
      href: '/followups/7',
      detail: 'L/C to be opened by',
    },
    {
      id: 'followup:7:SHIPMENT',
      source: 'followup',
      kind: 'SHIPMENT',
      href: '/followups/7',
      detail: 'Shipment / customs',
    },
  ])
  assert.deepEqual(kept.map((event) => event.id), ['tender:A:deadline'])
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
