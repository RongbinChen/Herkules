// Date guards for the activity calendar. One unreadable activity or holiday
// must be dropped, not allowed to throw while the rest of the page is rendering.

export function isValidInstant(value) {
  if (value == null || value === '') return false
  return !Number.isNaN(new Date(value).getTime())
}

// All-day events are stored inclusive and drawn exclusive. Mirrors the
// previous local-calendar add-one-day conversion, and returns null instead
// of throwing when the stored end cannot be parsed.
export function exclusiveAllDayEnd(value) {
  if (!isValidInstant(value)) return null
  const date = new Date(value)
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

// Holiday feed dates are Beijing calendar days ("YYYY-MM-DD"), drawn as
// exclusive all-day ranges at +08:00.
export function holidayRange(holiday) {
  const startDay = holiday?.start
  const endDay = holiday?.endExclusive
  if (typeof startDay !== 'string' || typeof endDay !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) return null
  const start = `${startDay}T00:00:00.000+08:00`
  const end = `${endDay}T00:00:00.000+08:00`
  if (!isValidInstant(start) || !isValidInstant(end)) return null
  return { start, end }
}
