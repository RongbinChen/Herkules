// Activity-history status badges (Planned, In Progress, Done, Blocked) are a
// plan for something that has not happened yet. Once the event's start is no
// longer in the future, the badge comes off — whether or not anyone marked it
// done. Type badges are unaffected, and this helper is not used for the
// nested visit-report reminder rows.
//
// Comparison is an instant comparison. Stored timestamps are absolute; a value
// with no zone is a Beijing wall time, matching the calendar (Asia/Shanghai,
// no DST). That is what keeps a meeting at 00:30 Beijing on the correct side
// of midnight when the machine clock is still on the previous UTC day.

import { BEIJING_OFFSET, toBeijingWall } from './halfDay.js'

function hasExplicitZone(value) {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
}

export function activityStartInstant(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const text = String(value).trim()
  if (!text) return null
  if (hasExplicitZone(text)) {
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const wall = toBeijingWall(text)
  if (!wall) return null
  const parsed = new Date(`${wall}:00${BEIJING_OFFSET}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// True only while the event start is strictly after `now`.
export function showActivityStatusBadge(start, now = new Date()) {
  const instant = activityStartInstant(start)
  const current = now instanceof Date ? now : activityStartInstant(now)
  if (!instant || !current || Number.isNaN(current.getTime())) return false
  return instant.getTime() > current.getTime()
}
