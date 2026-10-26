import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HALF_DAY_WINDOWS,
  beijingDayKey,
  beijingWallToIso,
  detectHalfDay,
  formatBeijingDayHeading,
  formatBeijingDisplay,
  halfDayToIso,
  toBeijingWall,
  toHalfDayRange,
} from './halfDay.js'

const DAY = '2026-10-26'

test('afternoon half-day starts at 13:00 Beijing, not 18:00', () => {
  assert.equal(HALF_DAY_WINDOWS.PM.startHour, 13)
  assert.equal(HALF_DAY_WINDOWS.PM.endHour, 17)

  const range = toHalfDayRange(`${DAY}T18:00`, 'PM')
  assert.deepEqual(range, { start: `${DAY}T13:00`, end: `${DAY}T17:00` })

  const iso = halfDayToIso(`${DAY}T18:00:00+08:00`, 'PM')
  assert.equal(iso.start, `${DAY}T05:00:00.000Z`)
  assert.equal(iso.end, `${DAY}T09:00:00.000Z`)
  assert.equal(toBeijingWall(iso.start), `${DAY}T13:00`)
  assert.equal(formatBeijingDisplay(iso.start), '10/26/2026 01:00 PM')
})

test('morning half-day stays at 08:00 Beijing', () => {
  assert.equal(HALF_DAY_WINDOWS.AM.startHour, 8)
  assert.equal(HALF_DAY_WINDOWS.AM.endHour, 12)

  const range = toHalfDayRange(`${DAY}T18:00`, 'AM')
  assert.deepEqual(range, { start: `${DAY}T08:00`, end: `${DAY}T12:00` })
  assert.equal(beijingWallToIso(range.start), `${DAY}T00:00:00.000Z`)
  assert.equal(toBeijingWall(`${DAY}T00:00:00.000Z`), `${DAY}T08:00`)
})

test('half-day windows ignore the machine zone and keep the Beijing calendar day', () => {
  // 18:00Z is 02:00 the next morning in Beijing. Afternoon still starts at 13:00
  // that Beijing day, and is not left on the 18:00 UTC instant.
  const fromEveningUtc = halfDayToIso(`${DAY}T18:00:00.000Z`, 'PM')
  assert.equal(toBeijingWall(fromEveningUtc.start), '2026-10-27T13:00')
  assert.equal(fromEveningUtc.start, '2026-10-27T05:00:00.000Z')
  assert.notEqual(fromEveningUtc.start, `${DAY}T18:00:00.000Z`)

  const fromLateBeijing = toHalfDayRange(`${DAY}T23:30:00+08:00`, 'PM')
  assert.equal(fromLateBeijing.start, `${DAY}T13:00`)
})

test('Beijing midnight stays on that calendar day for the time grid', () => {
  // FullCalendar's "Oct 26" in Asia/Shanghai is the instant 2026-10-25T16:00:00.000Z.
  assert.equal(beijingDayKey('2026-10-25T16:00:00.000Z'), DAY)
  assert.equal(beijingDayKey(`${DAY}T05:00:00.000Z`), DAY)
  assert.equal(formatBeijingDayHeading('2026-10-25T16:00:00.000Z'), 'Monday, Oct 26')
})

test('opening an event re-detects Beijing half-days and leaves 18:00 data timed', () => {
  assert.equal(
    detectHalfDay(`${DAY}T05:00:00.000Z`, `${DAY}T09:00:00.000Z`, false),
    'PM',
  )
  assert.equal(
    detectHalfDay(`${DAY}T13:00:00+08:00`, `${DAY}T17:00:00+08:00`, false),
    'PM',
  )
  assert.equal(
    detectHalfDay(`${DAY}T00:00:00.000Z`, `${DAY}T04:00:00.000Z`, false),
    'AM',
  )
  assert.equal(
    detectHalfDay(`${DAY}T10:00:00.000Z`, `${DAY}T16:00:00.000Z`, false),
    '',
  )
  assert.equal(detectHalfDay(`${DAY}T13:00`, `${DAY}T17:00`, true), '')
})
