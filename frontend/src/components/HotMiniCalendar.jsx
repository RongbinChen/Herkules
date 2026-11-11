/**
 * Collapsible month calendar on Hot Projects.
 *
 * Collapsed (the default, every visit) is a compact bar: the English month
 * title, a short teaser, and Expand. Expanding reveals the month grid, the
 * next-month peek, the legend, and — once a day is picked — that day's events
 * as separate links. A tracking thread and a follow-up record stay on their
 * own rows.
 *
 * Dates are China calendar days. The list is the same for every logged-in
 * user; the team tabs on the page below do not filter it. Copy on this card
 * is English only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { hotProjectsAPI } from '../api/api'
import { Button, Input } from './ui'
import {
  WEEKDAYS, buildMonthGrid, chinaToday, dotColors, monthLabel, peekRow, shiftMonth,
} from '../utils/hotCalendar'

const DOT = {
  brand: 'bg-brand-600',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
}

const LEGEND = [
  { color: 'brand', label: 'Deadline' },
  { color: 'violet', label: 'Opening' },
  { color: 'amber', label: 'Follow-up' },
  { color: 'rose', label: 'Overdue' },
]

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function eventsOn(events, day) {
  return day ? events.filter((event) => event.day === day) : []
}

function shortDay(day) {
  return `${SHORT_MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`
}

function DayCell({ day, events, today, selected, expanded, onSelect }) {
  if (!day) return <div className={expanded ? 'h-12 sm:h-14' : 'h-9'} aria-hidden="true" />
  const colors = dotColors(events)
  const isToday = day === today
  const isSelected = day === selected
  const label = [
    day,
    isToday ? 'today' : '',
    events.length ? `${events.length} events` : 'no events',
  ].filter(Boolean).join(', ')
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-label={label}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      data-testid={`day-${day}`}
      data-dots={colors.join(',')}
      className={`flex w-full min-w-0 flex-col items-center justify-center rounded-xl transition ${
        expanded ? 'h-12 sm:h-14' : 'h-9'
      } ${isSelected ? 'bg-brand-50 ring-2 ring-brand-300' : 'hover:bg-slate-50'}`}
    >
      <span
        className={`flex items-center justify-center rounded-full font-semibold ${
          expanded ? 'h-7 w-7 text-sm' : 'h-5 w-5 text-[11px]'
        } ${isToday ? 'bg-brand-600 text-white' : 'text-slate-800'}`}
      >
        {Number(day.slice(-2))}
      </span>
      <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
        {colors.map((color) => (
          <span key={color} className={`h-1.5 w-1.5 rounded-full ${DOT[color] || 'bg-slate-400'}`} />
        ))}
      </span>
    </button>
  )
}

function EventList({ events }) {
  if (!events.length) {
    return <p className="mt-3 text-xs text-slate-400">Nothing on this day</p>
  }
  return (
    <ul data-testid="event-list" className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
      {events.map((event) => (
        <li key={event.id}>
          <Link
            to={event.href}
            data-testid="cal-event"
            className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-brand-300 hover:bg-white"
          >
            <span className="block text-sm font-semibold text-slate-800">{event.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[event.color] || 'bg-slate-400'}`} />
              <span>{event.detail}</span>
              {event.overdue && <span className="font-semibold text-rose-600">Overdue</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function CollapsedTeaser({ events, today, onJump }) {
  const overdue = events
    .filter((event) => event.overdue)
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
  const upcoming = events
    .filter((event) => event.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
  const next = upcoming[0]
  if (!overdue.length && !next) return null
  const nextLabel = next
    ? `${next.day === today ? 'Today' : `Next ${shortDay(next.day)}`}${next.detail ? ` · ${next.detail}` : ''}`
    : ''
  return (
    <div data-testid="calendar-teaser" className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      {overdue.length > 0 && (
        <button
          type="button"
          onClick={() => onJump(overdue[0].day)}
          className="font-semibold text-rose-600 hover:underline"
        >
          {overdue.length} overdue
        </button>
      )}
      {next && (
        <button
          type="button"
          onClick={() => onJump(next.day)}
          className="font-semibold text-slate-600 hover:underline"
        >
          {nextLabel}
        </button>
      )}
    </div>
  )
}

function AliasPanel({ hotCustomers, aliases, aliasError, onCreateAlias, onUpdateAlias, onConfirmAlias, onDeleteAlias }) {
  const [draft, setDraft] = useState({ customerName: '', alias: '', note: '' })
  const [formError, setFormError] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const customerName = draft.customerName.trim()
    const alias = draft.alias.trim()
    if (customerName.length < 2 || alias.length < 2) {
      setFormError('Enter a customer and a purchaser name')
      return
    }
    const match = hotCustomers.find((customer) => customer.name === customerName)
    setBusy(true)
    setFormError('')
    try {
      await onCreateAlias?.({
        customerName,
        alias,
        note: draft.note.trim() || null,
        customerId: match?.customerId || null,
      })
      setDraft({ customerName: '', alias: '', note: '' })
    } catch {
      /* the parent surfaces aliasError */
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const match = hotCustomers.find((customer) => customer.name === editing.customerName.trim())
      await onUpdateAlias?.(editing.id, {
        customerName: editing.customerName.trim(),
        alias: editing.alias.trim(),
        note: editing.note?.trim() || null,
        customerId: match?.customerId || editing.customerId || null,
      })
      setEditing(null)
    } catch {
      /* parent */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3" data-testid="alias-panel">
      <p className="text-xs text-slate-500">
        Confirmed purchaser names only. An unconfirmed alias does not put tenders on the calendar.
      </p>
      <form onSubmit={submit} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-slate-500">
          Customer
          <Input
            value={draft.customerName}
            list="hot-calendar-customers"
            onChange={(event) => setDraft((d) => ({ ...d, customerName: event.target.value }))}
            placeholder="Hot project customer"
            className="mt-1"
          />
          <datalist id="hot-calendar-customers">
            {hotCustomers.map((customer) => <option key={customer.name} value={customer.name} />)}
          </datalist>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Purchaser
          <Input
            value={draft.alias}
            onChange={(event) => setDraft((d) => ({ ...d, alias: event.target.value }))}
            placeholder="Name on the tender"
            className="mt-1"
          />
        </label>
        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
          Note
          <Input
            value={draft.note}
            onChange={(event) => setDraft((d) => ({ ...d, note: event.target.value }))}
            placeholder="Optional"
            className="mt-1"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={busy}>Add</Button>
        </div>
      </form>
      {(formError || aliasError) && (
        <p className="mt-2 text-xs text-rose-600">{formError || aliasError}</p>
      )}
      <ul className="mt-3 space-y-1.5">
        {aliases.length === 0 && <li className="text-xs text-slate-400">No aliases yet</li>}
        {aliases.map((row) => (
          <li key={row.id} data-testid={`alias-${row.id}`} className="rounded-xl border border-slate-200 px-3 py-2">
            {editing?.id === row.id ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input value={editing.customerName} onChange={(event) => setEditing((e) => ({ ...e, customerName: event.target.value }))} />
                <Input value={editing.alias} onChange={(event) => setEditing((e) => ({ ...e, alias: event.target.value }))} />
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="button" size="sm" disabled={busy} onClick={saveEdit}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm text-slate-700">
                  <span className="font-semibold">{row.customerName}</span>
                  <span className="text-slate-400"> → </span>
                  {row.alias}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  row.confirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {row.confirmed ? 'Confirmed' : 'Pending'}
                </span>
                {!row.confirmed && (
                  <button
                    type="button"
                    data-testid={`confirm-alias-${row.id}`}
                    onClick={() => onConfirmAlias?.(row.id)}
                    className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing({ id: row.id, customerName: row.customerName, alias: row.alias, note: row.note || '', customerId: row.customerId || null })}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove alias “${row.alias}”?`)) onDeleteAlias?.(row.id)
                  }}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-rose-600"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HotMiniCalendarView({
  events = [],
  today,
  hotCustomers = [],
  aliases = [],
  loading = false,
  error = '',
  aliasError = '',
  onCreateAlias,
  onUpdateAlias,
  onConfirmAlias,
  onDeleteAlias,
  initialExpanded = false,
  initialMonth,
  initialSelected = null,
  initialAliasesOpen = false,
}) {
  const todayDay = today || chinaToday()
  const [expanded, setExpanded] = useState(initialExpanded)
  const [month, setMonth] = useState(initialMonth || todayDay.slice(0, 7))
  const [selected, setSelected] = useState(initialSelected)
  const [aliasesOpen, setAliasesOpen] = useState(initialAliasesOpen)

  const grid = useMemo(() => buildMonthGrid(month), [month])
  const peek = useMemo(() => peekRow(month), [month])
  const label = monthLabel(month)
  const peekLabel = monthLabel(peek.month)
  const byDay = useMemo(() => {
    const map = new Map()
    for (const event of events) {
      if (!map.has(event.day)) map.set(event.day, [])
      map.get(event.day).push(event)
    }
    return map
  }, [events])

  const visibleDays = useMemo(() => new Set([...grid, ...peek.cells].filter(Boolean)), [grid, peek])
  const visibleCount = events.filter((event) => visibleDays.has(event.day)).length
  const earlier = events.filter((event) => event.overdue && event.day.slice(0, 7) < month)
  const confirmed = aliases.filter((row) => row.confirmed).length
  const selectedEvents = eventsOn(events, expanded ? selected : null)

  const selectDay = (day) => {
    setMonth(day.slice(0, 7))
    setSelected(day)
    setExpanded(true)
  }

  return (
    <section
      data-testid="hot-mini-calendar"
      data-expanded={expanded ? 'true' : 'false'}
      className="mb-4 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Dates</p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className={`font-bold text-slate-800 ${expanded ? 'text-base sm:text-lg' : 'text-sm sm:text-base'}`}>
              {label}
            </h2>
          </div>
          {expanded ? (
            <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs">
              Hot-customer bid dates and follow-up milestones
            </p>
          ) : (
            <>
              {loading && <p className="mt-0.5 text-xs text-slate-400">Loading…</p>}
              {error && <p className="mt-0.5 text-xs text-rose-600">{error}</p>}
              {!loading && !error && (
                <CollapsedTeaser events={events} today={todayDay} onJump={selectDay} />
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {expanded && (
            <>
              <button type="button" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null) }}
                aria-label="Previous month"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                ‹
              </button>
              {month !== todayDay.slice(0, 7) && (
                <button type="button" onClick={() => { setMonth(todayDay.slice(0, 7)); setSelected(todayDay); setExpanded(true) }}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Today
                </button>
              )}
              <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null) }}
                aria-label="Next month"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                ›
              </button>
            </>
          )}
          <button
            type="button"
            data-testid="calendar-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-white"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500 sm:text-xs" data-testid="calendar-legend">
            {LEGEND.map((item) => (
              <span key={item.color} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[item.color]}`} />
                {item.label}
              </span>
            ))}
          </div>

          {loading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => selectDay(earlier[0].day)}
              className="mt-2 text-xs font-semibold text-rose-600 hover:underline"
            >
              {earlier.length} overdue
            </button>
          )}

          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-xs" data-testid="calendar-weekdays">
            {WEEKDAYS.map((day) => <div key={day.short} title={day.title}>{day.short}</div>)}
          </div>
          <div className="mt-1 grid w-full grid-cols-7 gap-0.5" data-testid="calendar-grid">
            {grid.map((day, index) => (
              <DayCell
                key={day || `blank-${index}`}
                day={day}
                events={eventsOn(events, day)}
                today={todayDay}
                selected={selected}
                expanded={expanded}
                onSelect={selectDay}
              />
            ))}
          </div>

          <div className="mt-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => { setMonth(peek.month); setSelected(null) }}
              className="mb-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              {peekLabel}
            </button>
            <div className="grid w-full grid-cols-7 gap-0.5" data-testid="calendar-peek">
              {peek.cells.map((day, index) => (
                <DayCell
                  key={day || `peek-${index}`}
                  day={day}
                  events={byDay.get(day) || []}
                  today={todayDay}
                  selected={selected}
                  expanded={expanded}
                  onSelect={selectDay}
                />
              ))}
            </div>
          </div>

          {visibleCount === 0 && !loading && (
            <p className="mt-2 text-xs text-slate-400">No dates this month</p>
          )}
          {confirmed === 0 && (
            <p className="mt-1 text-[11px] text-slate-400">
              Bid dates need a confirmed alias
            </p>
          )}

          {selected
            ? <EventList events={selectedEvents} />
            : <p className="mt-3 text-xs text-slate-400">Select a day</p>}

          <div className="mt-3">
            <button
              type="button"
              aria-expanded={aliasesOpen}
              onClick={() => setAliasesOpen((open) => !open)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Aliases
              <span className="ml-1 text-slate-400">{confirmed}/{aliases.length}</span>
            </button>
          </div>
          {aliasesOpen && (
            <AliasPanel
              hotCustomers={hotCustomers}
              aliases={aliases}
              aliasError={aliasError}
              onCreateAlias={onCreateAlias}
              onUpdateAlias={onUpdateAlias}
              onConfirmAlias={onConfirmAlias}
              onDeleteAlias={onDeleteAlias}
            />
          )}
        </>
      )}
    </section>
  )
}

export default function HotMiniCalendar() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [aliasError, setAliasError] = useState('')

  const load = useCallback(async () => {
    try {
      const { data: body } = await hotProjectsAPI.calendar()
      setData(body)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (fn) => {
    setAliasError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setAliasError(err.response?.data?.error || 'Save failed')
      throw err
    }
  }

  return (
    <HotMiniCalendarView
      events={data?.events || []}
      today={data?.today}
      hotCustomers={data?.hotCustomers || []}
      aliases={data?.aliases || []}
      loading={loading}
      error={error}
      aliasError={aliasError}
      onCreateAlias={(body) => run(() => hotProjectsAPI.createAlias(body))}
      onUpdateAlias={(id, body) => run(() => hotProjectsAPI.updateAlias(id, body))}
      onConfirmAlias={(id) => run(() => hotProjectsAPI.confirmAlias(id))}
      onDeleteAlias={(id) => run(() => hotProjectsAPI.deleteAlias(id))}
    />
  )
}
