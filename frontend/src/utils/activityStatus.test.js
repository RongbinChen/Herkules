import test from 'node:test'
import assert from 'node:assert/strict'
import { showActivityStatusBadge } from './activityStatus.js'

// 2026-11-13 00:30 in Asia/Shanghai. The UTC clock is still on Nov 12.
const NOW = new Date('2026-11-12T16:30:00.000Z')

test('a Beijing start before now hides the status badge, including across UTC midnight', () => {
  // 2026-11-12 23:30 Beijing — previous Beijing day, same UTC date as now.
  assert.equal(showActivityStatusBadge('2026-11-12T15:30:00.000Z', NOW), false)
  assert.equal(showActivityStatusBadge('2026-11-12T23:30:00+08:00', NOW), false)
  // No zone: wall time is Beijing, not the machine zone.
  assert.equal(showActivityStatusBadge('2026-11-12T23:30', NOW), false)
  assert.equal(showActivityStatusBadge('2026-11-12T23:30:00', NOW), false)
})

test('a Beijing start after now keeps the status badge, even when UTC is still the previous day', () => {
  // 2026-11-13 01:00 Beijing = 2026-11-12 17:00 UTC.
  assert.equal(showActivityStatusBadge('2026-11-12T17:00:00.000Z', NOW), true)
  assert.equal(showActivityStatusBadge('2026-11-13T01:00:00+08:00', NOW), true)
  assert.equal(showActivityStatusBadge('2026-11-13T01:00', NOW), true)
})

test('the exact start instant is no longer in the future', () => {
  assert.equal(showActivityStatusBadge(NOW.toISOString(), NOW), false)
  assert.equal(showActivityStatusBadge(new Date(NOW.getTime() + 1), NOW), true)
  assert.equal(showActivityStatusBadge(new Date(NOW.getTime() - 1), NOW), false)
})

test('a missing or unreadable start does not show a status badge', () => {
  assert.equal(showActivityStatusBadge('', NOW), false)
  assert.equal(showActivityStatusBadge(null, NOW), false)
  assert.equal(showActivityStatusBadge('not-a-date', NOW), false)
})
