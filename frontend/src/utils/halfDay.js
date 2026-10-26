// Half-day activities are a duration preset, not a stored flag. Choosing
// Morning or Afternoon snaps start/end onto a fixed Beijing office window.
// China has no DST, so +08:00 is the Asia/Shanghai offset all year.
//
// These windows are wall times, not Date#setHours. setHours follows the
// browser zone, so a machine outside Beijing would store "1 PM" at the wrong
// instant and the China calendar would draw it in the evening (the 6 PM bug).

export const BEIJING_TIME_ZONE = 'Asia/Shanghai'
export const BEIJING_OFFSET = '+08:00'

export const HALF_DAY_WINDOWS = {
  AM: { startHour: 8, endHour: 12, label: 'Morning', hint: '8 AM – 12 PM Beijing' },
  PM: { startHour: 13, endHour: 17, label: 'Afternoon', hint: '1 PM – 5 PM Beijing' },
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function hasExplicitZone(value) {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
}

function partsInBeijing(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value || ''
  let hour = read('hour')
  if (hour === '24') hour = '00'
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  }
}

// "YYYY-MM-DDTHH:mm" in Beijing, regardless of the machine's zone.
// Date-only strings stay on that calendar day (all-day values).
export function toBeijingWall(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00`
  }
  if (typeof value === 'string' && !hasExplicitZone(value) && value.includes('T')) {
    return value.slice(0, 16)
  }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const parts = partsInBeijing(parsed)
  if (!parts.year || !parts.hour) return ''
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function beijingDatePart(value) {
  const wall = toBeijingWall(value)
  return wall ? wall.slice(0, 10) : ''
}

// Interpret a wall clock as Beijing and return a UTC ISO instant.
export function beijingWallToIso(value, allDay = false) {
  const wall = toBeijingWall(value)
  if (!wall) return ''
  const datePart = wall.slice(0, 10)
  const time = allDay ? '00:00' : wall.slice(11, 16)
  const instant = new Date(`${datePart}T${time}:00${BEIJING_OFFSET}`)
  if (Number.isNaN(instant.getTime())) return ''
  return instant.toISOString()
}

export function toHalfDayRange(anchorValue, half) {
  const window = HALF_DAY_WINDOWS[half]
  if (!window) return null
  const datePart = beijingDatePart(anchorValue || new Date())
  if (!datePart) return null
  return {
    start: `${datePart}T${pad(window.startHour)}:00`,
    end: `${datePart}T${pad(window.endHour)}:00`,
  }
}

export function halfDayToIso(anchorValue, half) {
  const range = toHalfDayRange(anchorValue, half)
  if (!range) return null
  return {
    start: beijingWallToIso(range.start),
    end: beijingWallToIso(range.end),
  }
}

// Half-day is not persisted, so re-derive it when an existing event is opened.
// A stored 18:00 block is left alone: it does not match the afternoon window.
export function detectHalfDay(startValue, endValue, allDay) {
  if (allDay || !startValue || !endValue) return ''
  const startWall = toBeijingWall(startValue)
  const endWall = toBeijingWall(endValue)
  if (!startWall || !endWall) return ''

  return Object.keys(HALF_DAY_WINDOWS).find((half) => {
    const range = toHalfDayRange(startWall, half)
    return range && range.start === startWall && range.end === endWall
  }) || ''
}

export function beijingDayKey(value) {
  const wall = toBeijingWall(value)
  return wall ? wall.slice(0, 10) : ''
}

export function formatBeijingDayHeading(value) {
  const key = beijingDayKey(value)
  if (!key) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${key}T12:00:00${BEIJING_OFFSET}`))
}

export function formatBeijingMonthDay(value) {
  const key = beijingDayKey(value)
  if (!key) return ''
  const year = Number(key.slice(0, 4))
  const thisYear = Number(beijingDayKey(new Date()).slice(0, 4))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    ...(year === thisYear ? {} : { year: 'numeric' }),
  }).format(new Date(`${key}T12:00:00${BEIJING_OFFSET}`))
}

export function formatBeijingDisplay(value, allDay = false) {
  const wall = toBeijingWall(value)
  if (!wall) return ''
  const [datePart, timePart] = wall.split('T')
  const [year, month, day] = datePart.split('-')
  if (allDay) return `${month}/${day}/${year}`
  let hour = Number(timePart.slice(0, 2))
  const minute = timePart.slice(3, 5)
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${month}/${day}/${year} ${String(hour12).padStart(2, '0')}:${minute} ${meridiem}`
}
