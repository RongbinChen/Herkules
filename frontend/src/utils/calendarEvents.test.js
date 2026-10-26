import test from 'node:test'
import assert from 'node:assert/strict'
import { exclusiveAllDayEnd, holidayRange, isValidInstant } from './calendarEvents.js'

test('a bad all-day end is skipped instead of throwing', () => {
  assert.equal(isValidInstant('not-a-date'), false)
  assert.equal(isValidInstant(''), false)
  assert.equal(isValidInstant(null), false)
  assert.equal(exclusiveAllDayEnd('also-bad'), null)
  assert.equal(exclusiveAllDayEnd(undefined), null)
})

test('a readable all-day end becomes the next local calendar day', () => {
  const start = '2026-10-26T00:00:00.000Z'
  const end = exclusiveAllDayEnd(start)
  assert.equal(isValidInstant(end), true)
  assert.equal(new Date(end).getTime() - new Date(start).getTime(), 24 * 60 * 60 * 1000)
})

test('a holiday with a missing day is dropped and a real holiday keeps its Beijing range', () => {
  assert.equal(holidayRange({ start: '', endExclusive: null }), null)
  assert.equal(holidayRange({ start: '2026-10-01' }), null)
  assert.equal(holidayRange(null), null)
  assert.deepEqual(holidayRange({
    start: '2026-10-01',
    endExclusive: '2026-10-08',
  }), {
    start: '2026-10-01T00:00:00.000+08:00',
    end: '2026-10-08T00:00:00.000+08:00',
  })
})
