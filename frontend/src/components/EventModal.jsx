import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, eachDayOfInterval, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns'

const CATEGORY_OPTIONS = [
  { value: 'WORK_SESSION', label: 'Internal Coordination' },
  { value: 'MEETING', label: 'Technical Discussion' },
  { value: 'SALES_MEETING', label: 'Sales Meeting' },
  { value: 'FIELD_WORK', label: 'Customer Visit' },
  { value: 'BREAK', label: 'Final Negotiation' },
  { value: 'TRAINING', label: 'Project Execution' },
  { value: 'LEAVE', label: 'Holidays' },
]

const STATUS_OPTIONS = [
  { value: 'PLANNED', label: 'Planned' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'DONE', label: 'Done' },
]

const CATEGORY_COLORS = {
  WORK_SESSION: '#475569',
  MEETING: '#0f766e',
  SALES_MEETING: '#2563eb',
  FIELD_WORK: '#ea580c',
  BREAK: '#dc2626',
  TRAINING: '#7c3aed',
  LEAVE: '#0891b2',
}

const FIXED_USER_COLOR_THEMES = {
  1: { solid: '#f59e0b', soft: '#fff9c4' },
  4: { solid: '#2563eb', soft: '#e3f2fd' },
  5: { solid: '#fb7185', soft: '#fce4ec' },
  6: { solid: '#8b5cf6', soft: '#f3e5f5' },
  9: { solid: '#14b8a6', soft: '#e0f2f1' },
  10: { solid: '#f97316', soft: '#ffe0b2' },
  15: { solid: '#22c55e', soft: '#f1f8e9' },
}

const USER_CALENDAR_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4338ca',
  '#0f766e',
  '#a16207',
  '#475569',
]

function getUserCalendarColor(userId, users = []) {
  if (!userId) return USER_CALENDAR_COLORS[0]
  const numericUserId = Number(userId)
  if (FIXED_USER_COLOR_THEMES[numericUserId]) {
    return FIXED_USER_COLOR_THEMES[numericUserId].solid
  }
  const index = users.findIndex((user) => user.id === numericUserId)
  if (index === -1) return USER_CALENDAR_COLORS[numericUserId % USER_CALENDAR_COLORS.length]
  return USER_CALENDAR_COLORS[index % USER_CALENDAR_COLORS.length]
}

const HOUR_OPTIONS = ['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']
const MINUTE_OPTIONS = ['00', '15', '30', '45']
const MERIDIEM_OPTIONS = ['AM', 'PM']

function toLocalDateTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return format(parsed, "yyyy-MM-dd'T'HH:mm")
}

function parsePickerDate(value) {
  if (!value) return new Date()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date()
  return parsed
}

function formatPickerDisplayValue(value, allDay) {
  if (!value) return allDay ? 'Select date' : 'Select date and time'
  const parsed = parsePickerDate(value)
  return allDay ? format(parsed, 'MM/dd/yyyy') : format(parsed, 'MM/dd/yyyy hh:mm aa')
}

function toPickerValue(date, allDay) {
  return format(date, allDay ? "yyyy-MM-dd'T'00:00" : "yyyy-MM-dd'T'HH:mm")
}

function getHour12(date) {
  return format(date, 'hh')
}

function getMinute(date) {
  const minute = date.getMinutes()
  if (minute < 15) return '00'
  if (minute < 30) return '15'
  if (minute < 45) return '30'
  return '45'
}

function getMeridiem(date) {
  return format(date, 'aa')
}

function DateTimePickerField({ label, value, allDay, disabled, onApply }) {
  const [isOpen, setIsOpen] = useState(false)
  const parsedValue = useMemo(() => parsePickerDate(value), [value])
  const [draftDate, setDraftDate] = useState(parsedValue)
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(parsedValue))

  useEffect(() => {
    const nextDate = parsePickerDate(value)
    setDraftDate(nextDate)
    setVisibleMonth(startOfMonth(nextDate))
  }, [value, allDay])

  const calendarDays = useMemo(() => {
    const rangeStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 })
    const rangeEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 })
    return eachDayOfInterval({ start: rangeStart, end: rangeEnd })
  }, [visibleMonth])

  function updateDay(day) {
    setDraftDate((prev) => {
      const next = new Date(day)
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
      return next
    })
  }

  function updateHour(hourString) {
    setDraftDate((prev) => {
      const next = new Date(prev)
      const meridiem = getMeridiem(prev)
      const numericHour = Number.parseInt(hourString, 10)
      let hours24 = numericHour % 12
      if (meridiem === 'PM') {
        hours24 += 12
      }
      next.setHours(hours24, next.getMinutes(), 0, 0)
      return next
    })
  }

  function updateMinute(minuteString) {
    setDraftDate((prev) => {
      const next = new Date(prev)
      next.setMinutes(Number.parseInt(minuteString, 10), 0, 0)
      return next
    })
  }

  function updateMeridiem(nextMeridiem) {
    setDraftDate((prev) => {
      const next = new Date(prev)
      const hours = next.getHours()
      if (nextMeridiem === 'AM' && hours >= 12) {
        next.setHours(hours - 12, next.getMinutes(), 0, 0)
      }
      if (nextMeridiem === 'PM' && hours < 12) {
        next.setHours(hours + 12, next.getMinutes(), 0, 0)
      }
      return next
    })
  }

  function handleApply() {
    onApply(toPickerValue(draftDate, allDay))
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-slate-900 outline-none transition hover:border-sky-400 focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
      >
        <span>{formatPickerDisplayValue(value, allDay)}</span>
        <span className="text-lg text-slate-400">▣</span>
      </button>

      {isOpen && !disabled && (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-[90] w-[min(24rem,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => subMonths(prev, 1))}
                  className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
                >
                  &lt;
                </button>
                <div className="text-sm font-semibold text-slate-900">{format(visibleMonth, 'MMMM yyyy')}</div>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
                  className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
                >
                  &gt;
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((dayLabel) => (
                  <div key={dayLabel}>{dayLabel}</div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {calendarDays.map((day) => {
                  const selected = isSameDay(day, draftDate)
                  const inMonth = isSameMonth(day, visibleMonth)

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => updateDay(day)}
                      className={[
                        'h-9 rounded-xl text-sm font-medium transition',
                        selected ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100',
                        inMonth ? '' : 'text-slate-300',
                      ].join(' ')}
                    >
                      {format(day, 'd')}
                    </button>
                  )
                })}
              </div>
            </div>

            {!allDay && (
              <div className="grid grid-cols-3 gap-2 sm:w-[138px] sm:grid-cols-1">
                <select
                  value={getHour12(draftDate)}
                  onChange={(event) => updateHour(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {HOUR_OPTIONS.map((hour) => (
                    <option key={hour} value={hour}>{hour}</option>
                  ))}
                </select>
                <select
                  value={getMinute(draftDate)}
                  onChange={(event) => updateMinute(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {MINUTE_OPTIONS.map((minute) => (
                    <option key={minute} value={minute}>{minute}</option>
                  ))}
                </select>
                <select
                  value={getMeridiem(draftDate)}
                  onChange={(event) => updateMeridiem(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {MERIDIEM_OPTIONS.map((period) => (
                    <option key={period} value={period}>{period}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setDraftDate(new Date())}
              className="text-sm font-semibold text-slate-500 transition hover:text-slate-700"
            >
              Today
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EventModal({ isOpen, onClose, onSave, onDelete, event, users, isAdmin, currentUser, readOnly = false }) {
  const isHolidayEvent = event?.category === 'LEAVE' || event?.isSharedHoliday === true
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    start: '',
    end: '',
    allDay: false,
    color: USER_CALENDAR_COLORS[0],
    category: 'WORK_SESSION',
    status: 'PLANNED',
    userId: '',
  })

  const assignableUsers = useMemo(() => {
    if (isAdmin) return users

    const selectedUserId = Number(form.userId)
    const visibleUsers = users.filter((user) => user.id === currentUser?.id || user.id === selectedUserId)

    if (visibleUsers.length > 0) {
      return visibleUsers
    }

    return users.filter((user) => user.id === currentUser?.id)
  }, [currentUser?.id, form.userId, isAdmin, users])

  useEffect(() => {
    if (event) {
      setForm({
        title: event.title || '',
        description: event.description || '',
        location: event.location || '',
        start: toLocalDateTime(event.start),
        end: toLocalDateTime(event.end),
        allDay: event.allDay || false,
        color: event.color || getUserCalendarColor(event.userId || currentUser?.id, users),
        category: event.category || 'WORK_SESSION',
        status: event.status || 'PLANNED',
        userId: String(event.userId || currentUser?.id || ''),
      })
      return
    }

    const now = new Date()
    now.setMinutes(0, 0, 0)
    now.setHours(Math.max(8, now.getHours() + 1))
    const end = new Date(now)
    end.setHours(now.getHours() + 1)

    setForm({
      title: '',
      description: '',
      location: '',
      start: format(now, "yyyy-MM-dd'T'HH:mm"),
      end: format(end, "yyyy-MM-dd'T'HH:mm"),
      allDay: false,
      color: getUserCalendarColor(currentUser?.id, users),
      category: 'WORK_SESSION',
      status: 'PLANNED',
      userId: String(currentUser?.id || ''),
    })
  }, [event, currentUser])

  if (!isOpen) return null

  function updateField(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'userId' ? { color: getUserCalendarColor(value, users) } : {}),
    }))
  }

  function normalizeDate(value, allDay) {
    if (!value) return ''
    if (allDay) {
      return `${value.split('T')[0]}T00:00`
    }
    return value
  }

  function handleSubmit(submitEvent) {
    submitEvent.preventDefault()
    if (readOnly) return
    onSave({
      id: event?.id,
      ...form,
      start: new Date(normalizeDate(form.start, form.allDay)).toISOString(),
      end: new Date(normalizeDate(form.end, form.allDay)).toISOString(),
      userId: Number(form.userId),
    })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl sm:h-[90vh] sm:rounded-[28px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-8 sm:py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Activity Record</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
              {readOnly ? 'View employee activity' : event?.id ? 'Edit employee activity' : 'Create employee activity'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-4 py-4 sm:space-y-6 sm:px-8 sm:py-7">
          <div className="grid gap-5 md:grid-cols-[1.4fr,0.8fr] sm:gap-6">
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Activity title</span>
                <input
                  value={form.title}
                  onChange={(event) => updateField('title', event.target.value)}
                  disabled={readOnly}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  placeholder="Write customer visit, technical review, contract round..."
                  required
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Location</span>
                  <input
                    value={form.location}
                    onChange={(event) => updateField('location', event.target.value)}
                    disabled={readOnly}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                    placeholder="Office, Zoom, Warehouse A"
                  />
                </label>

                {!isHolidayEvent && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Assigned employee</span>
                    <select
                      value={form.userId}
                      onChange={(event) => updateField('userId', event.target.value)}
                      disabled={readOnly || !isAdmin}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                    >
                      {assignableUsers.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                    {!isAdmin && !readOnly && (
                      <p className="mt-2 text-xs text-slate-500">Non-admin users can only create and edit activities assigned to themselves.</p>
                    )}
                  </label>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Notes</span>
                <textarea
                  value={form.description}
                  onChange={(event) => updateField('description', event.target.value)}
                  rows={5}
                  disabled={readOnly}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  placeholder="Capture customer feedback, blockers, negotiation notes, or internal handoff details."
                />
              </label>
            </div>

            <div className="space-y-5 rounded-[20px] bg-slate-50 p-4 sm:rounded-[24px] sm:p-5">
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Category</span>
                  <select
                    value={form.category}
                    onChange={(event) => updateField('category', event.target.value)}
                    disabled={readOnly}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(event) => {
                    const nextAllDay = event.target.checked
                    setForm((prev) => ({
                      ...prev,
                      allDay: nextAllDay,
                      start: nextAllDay ? toPickerValue(parsePickerDate(prev.start), true) : prev.start,
                      end: nextAllDay ? toPickerValue(parsePickerDate(prev.end), true) : prev.end,
                    }))
                  }}
                  disabled={readOnly}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span className="text-sm font-medium text-slate-700">All-day activity</span>
              </label>

              <div className="grid gap-4">
                <DateTimePickerField
                  label="Start"
                  value={form.start}
                  allDay={form.allDay}
                  disabled={readOnly}
                  onApply={(nextValue) => updateField('start', nextValue)}
                />

                <DateTimePickerField
                  label="End"
                  value={form.end}
                  allDay={form.allDay}
                  disabled={readOnly}
                  onApply={(nextValue) => updateField('end', nextValue)}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="mb-2 block text-sm font-medium text-slate-700">Category color</span>
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: form.color }} />
                  <p className="text-sm text-slate-500">The event color is assigned automatically from the selected employee.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {event?.id && !readOnly && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-full bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                >
                  Delete activity
                </button>
              )}
            </div>
            <div className="flex w-full gap-3 sm:w-auto">
              <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
                {readOnly ? 'Close' : 'Cancel'}
              </button>
              {!readOnly && (
                <button type="submit" className="flex-1 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 sm:flex-none">
                  Save activity
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
