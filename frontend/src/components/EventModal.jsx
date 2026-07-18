import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, eachDayOfInterval, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { customersAPI, agentsAPI } from '../api/api'

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
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-slate-900 outline-none transition hover:border-sky-400 focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
      >
        <span>{formatPickerDisplayValue(value, allDay)}</span>
        <span className="text-lg text-slate-400">▣</span>
      </button>

      {isOpen && !disabled && (
        <div className="absolute left-1/2 top-[calc(100%+0.4rem)] z-[90] w-[min(20rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:left-auto sm:right-[calc(100%+0.6rem)] sm:top-1/2 sm:w-[19rem] sm:translate-x-0 sm:-translate-y-1/2">
          <div className="flex flex-col gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
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
                        'h-8 rounded-lg text-sm font-medium transition',
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
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={getHour12(draftDate)}
                  onChange={(event) => updateHour(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {HOUR_OPTIONS.map((hour) => (
                    <option key={hour} value={hour}>{hour}</option>
                  ))}
                </select>
                <select
                  value={getMinute(draftDate)}
                  onChange={(event) => updateMinute(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {MINUTE_OPTIONS.map((minute) => (
                    <option key={minute} value={minute}>{minute}</option>
                  ))}
                </select>
                <select
                  value={getMeridiem(draftDate)}
                  onChange={(event) => updateMeridiem(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                >
                  {MERIDIEM_OPTIONS.map((period) => (
                    <option key={period} value={period}>{period}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
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

export default function EventModal({ isOpen, onClose, onSave, onDelete, event, users, customers = [], onCustomersChanged, agents = [], onAgentsChanged, isAdmin, currentUser, readOnly = false }) {
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
    customerId: '',
    agentId: '',
  })
  const [dateError, setDateError] = useState('')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', address: '', contactName: '', contactPhone: '' })
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState('')
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [newAgent, setNewAgent] = useState({ name: '', company: '', contactPhone: '' })
  const [savingAgent, setSavingAgent] = useState(false)
  const [agentError, setAgentError] = useState('')

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
        customerId: event.customerId ? String(event.customerId) : '',
        agentId: event.agentId ? String(event.agentId) : '',
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
      customerId: '',
      agentId: '',
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
    const startDate = new Date(normalizeDate(form.start, form.allDay))
    const endDate = new Date(normalizeDate(form.end, form.allDay))
    const invalid = form.allDay ? endDate < startDate : endDate <= startDate
    if (invalid) {
      setDateError('End must be after start')
      return
    }
    setDateError('')
    onSave({
      id: event?.id,
      ...form,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      userId: Number(form.userId),
      customerId: form.customerId ? Number(form.customerId) : null,
      agentId: form.agentId ? Number(form.agentId) : null,
    })
  }

  const selectedCustomer = customers.find((customer) => customer.id === Number(form.customerId))
  const selectedAgent = agents.find((agent) => agent.id === Number(form.agentId))

  async function handleCreateAgent() {
    if (!newAgent.name.trim()) {
      setAgentError('Agent name is required')
      return
    }
    setSavingAgent(true)
    setAgentError('')
    try {
      const response = await agentsAPI.create({
        name: newAgent.name.trim(),
        company: newAgent.company.trim(),
        contactPhone: newAgent.contactPhone.trim(),
      })
      if (onAgentsChanged) {
        await onAgentsChanged()
      }
      setForm((prev) => ({ ...prev, agentId: String(response.data.id) }))
      setNewAgent({ name: '', company: '', contactPhone: '' })
      setShowNewAgent(false)
    } catch (error) {
      console.error('Failed to create agent', error)
      setAgentError('Failed to create agent')
    } finally {
      setSavingAgent(false)
    }
  }

  async function handleCreateCustomer() {
    if (!newCustomer.name.trim()) {
      setCustomerError('Customer name is required')
      return
    }
    setSavingCustomer(true)
    setCustomerError('')
    try {
      const response = await customersAPI.create({
        name: newCustomer.name.trim(),
        address: newCustomer.address.trim(),
        contactName: newCustomer.contactName.trim(),
        contactPhone: newCustomer.contactPhone.trim(),
      })
      if (onCustomersChanged) {
        await onCustomersChanged()
      }
      setForm((prev) => ({ ...prev, customerId: String(response.data.id) }))
      setNewCustomer({ name: '', address: '', contactName: '', contactPhone: '' })
      setShowNewCustomer(false)
    } catch (error) {
      console.error('Failed to create customer', error)
      setCustomerError('Failed to create customer')
    } finally {
      setSavingCustomer(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-[24px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Activity Record</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {readOnly ? 'View employee activity' : event?.id ? 'Edit employee activity' : 'Create employee activity'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid gap-4 md:grid-cols-[1.4fr,0.85fr]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Activity title</span>
                <input
                  value={form.title}
                  onChange={(event) => updateField('title', event.target.value)}
                  disabled={readOnly}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  placeholder="Write customer visit, technical review, contract round..."
                  required
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Location</span>
                  <input
                    value={form.location}
                    onChange={(event) => updateField('location', event.target.value)}
                    disabled={readOnly}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                    placeholder="Office, Zoom, Warehouse A"
                  />
                </label>

                {!isHolidayEvent && (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Assigned employee</span>
                    <select
                      value={form.userId}
                      onChange={(event) => updateField('userId', event.target.value)}
                      disabled={readOnly || !isAdmin}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
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
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Notes</span>
                <textarea
                  value={form.description}
                  onChange={(event) => updateField('description', event.target.value)}
                  rows={3}
                  disabled={readOnly}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  placeholder="Capture customer feedback, blockers, negotiation notes, or internal handoff details."
                />
              </label>

              {!isHolidayEvent && (
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Customer</span>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => { setShowNewCustomer((prev) => !prev); setCustomerError('') }}
                        className="text-xs font-semibold text-sky-600 transition hover:text-sky-700"
                      >
                        {showNewCustomer ? 'Cancel' : '+ New customer'}
                      </button>
                    )}
                  </div>

                  <select
                    value={form.customerId}
                    onChange={(event) => updateField('customerId', event.target.value)}
                    disabled={readOnly}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    <option value="">Customer Selection</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.name}</option>
                    ))}
                  </select>

                  {selectedCustomer && (selectedCustomer.contactName || selectedCustomer.contactPhone || selectedCustomer.address) && (
                    <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                      {selectedCustomer.contactName && <p>Contact: {selectedCustomer.contactName}</p>}
                      {selectedCustomer.contactPhone && <p>Phone: {selectedCustomer.contactPhone}</p>}
                      {selectedCustomer.address && <p>Address: {selectedCustomer.address}</p>}
                    </div>
                  )}

                  {showNewCustomer && !readOnly && (
                    <div className="mt-3 space-y-2.5 border-t border-slate-200 pt-3">
                      <input
                        value={newCustomer.name}
                        onChange={(event) => setNewCustomer((prev) => ({ ...prev, name: event.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                        placeholder="Customer name (required)"
                      />
                      <input
                        value={newCustomer.address}
                        onChange={(event) => setNewCustomer((prev) => ({ ...prev, address: event.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                        placeholder="Address (for map)"
                      />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <input
                          value={newCustomer.contactName}
                          onChange={(event) => setNewCustomer((prev) => ({ ...prev, contactName: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                          placeholder="Contact name"
                        />
                        <input
                          value={newCustomer.contactPhone}
                          onChange={(event) => setNewCustomer((prev) => ({ ...prev, contactPhone: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                          placeholder="Phone"
                        />
                      </div>
                      {customerError && <p className="text-xs font-medium text-red-600">{customerError}</p>}
                      <button
                        type="button"
                        onClick={handleCreateCustomer}
                        disabled={savingCustomer}
                        className="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                      >
                        {savingCustomer ? 'Saving...' : 'Save customer'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isHolidayEvent && (
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Agent</span>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => { setShowNewAgent((prev) => !prev); setAgentError('') }}
                        className="text-xs font-semibold text-sky-600 transition hover:text-sky-700"
                      >
                        {showNewAgent ? 'Cancel' : '+ New agent'}
                      </button>
                    )}
                  </div>

                  <select
                    value={form.agentId}
                    onChange={(event) => updateField('agentId', event.target.value)}
                    disabled={readOnly}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    <option value="">Agent Selection</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}{agent.company ? ` · ${agent.company}` : ''}
                      </option>
                    ))}
                  </select>

                  {selectedAgent && (selectedAgent.company || selectedAgent.contactPhone || selectedAgent.region) && (
                    <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                      {selectedAgent.company && <p>Company: {selectedAgent.company}</p>}
                      {selectedAgent.contactPhone && <p>Phone: {selectedAgent.contactPhone}</p>}
                      {selectedAgent.region && <p>Region: {selectedAgent.region}</p>}
                    </div>
                  )}

                  {showNewAgent && !readOnly && (
                    <div className="mt-3 space-y-2.5 border-t border-slate-200 pt-3">
                      <input
                        value={newAgent.name}
                        onChange={(event) => setNewAgent((prev) => ({ ...prev, name: event.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                        placeholder="Agent name (required)"
                      />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <input
                          value={newAgent.company}
                          onChange={(event) => setNewAgent((prev) => ({ ...prev, company: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                          placeholder="Company / agency"
                        />
                        <input
                          value={newAgent.contactPhone}
                          onChange={(event) => setNewAgent((prev) => ({ ...prev, contactPhone: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                          placeholder="Phone"
                        />
                      </div>
                      {agentError && <p className="text-xs font-medium text-red-600">{agentError}</p>}
                      <button
                        type="button"
                        onClick={handleCreateAgent}
                        disabled={savingAgent}
                        className="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                      >
                        {savingAgent ? 'Saving...' : 'Save agent'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-[16px] bg-slate-50 p-3.5 sm:p-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Category</span>
                <select
                  value={form.category}
                  onChange={(event) => updateField('category', event.target.value)}
                  disabled={readOnly}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
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

              <div className="grid gap-3">
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
                  onApply={(nextValue) => { updateField('end', nextValue); setDateError('') }}
                />
                {dateError && (
                  <p className="text-xs font-medium text-red-600">{dateError}</p>
                )}
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: form.color }} />
                <p className="text-xs text-slate-500">Color auto-assigned from the selected employee.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                <button type="submit" className="flex-1 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 sm:flex-none">
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
