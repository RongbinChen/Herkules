import { useEffect, useMemo, useState } from 'react'
import { tripsAPI, customersAPI, usersAPI } from '../api/api'

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white'

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(value) {
  const d = value ? new Date(value) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

// Create / edit a trip. `trip` null → create mode.
export default function TripModal({ isOpen, trip, initialCustomerIds = [], onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [hidePhone, setHidePhone] = useState(false)
  const [flights, setFlights] = useState([])
  const [constraints, setConstraints] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const [customers, setCustomers] = useState([])
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setSearch('')
    customersAPI.getAll().then((r) => setCustomers(r.data)).catch(() => setCustomers([]))
    usersAPI.getVisible().then((r) => setUsers(r.data)).catch(() =>
      usersAPI.getAll().then((r) => setUsers(r.data)).catch(() => setUsers([])),
    )
    if (trip) {
      setTitle(trip.title || '')
      setAssigneeId(trip.assignee?.id ? String(trip.assignee.id) : '')
      setStartTime(toLocalInput(trip.startTime))
      setEndTime(toLocalInput(trip.endTime))
      setNotes(trip.notes || '')
      setHidePhone(trip.hidePhoneOnShare === true)
      setFlights(Array.isArray(trip.flights) ? trip.flights : [])
      setConstraints(trip.constraints || '')
      setSelectedIds((trip.stops || []).map((s) => s.customer.id))
    } else {
      const now = new Date()
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
      setTitle('')
      setAssigneeId('')
      setStartTime(toLocalInput(now))
      setEndTime(toLocalInput(tomorrow))
      setNotes('')
      setHidePhone(false)
      setFlights([])
      setConstraints('')
      setSelectedIds(initialCustomerIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trip])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c) =>
      [c.name, c.address, c.contactName].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [customers, search])

  if (!isOpen) return null

  function toggle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function addFlight() {
    setFlights((prev) => [...prev, { date: '', flightNo: '', routing: '', time: '', notes: '' }])
  }
  function updateFlight(i, field, value) {
    setFlights((prev) => prev.map((f, idx) => (idx === i ? { ...f, [field]: value } : f)))
  }
  function removeFlight(i) {
    setFlights((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!title.trim()) return setError('Title is required')
    if (selectedIds.length === 0) return setError('Select at least one customer')
    if (new Date(endTime) <= new Date(startTime)) return setError('End must be after start')
    setSaving(true)
    setError('')
    const payload = {
      title: title.trim(),
      notes: notes.trim() || undefined,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      hidePhoneOnShare: hidePhone,
      flights: flights.filter((f) => f.flightNo || f.routing || f.date),
      constraints: constraints.trim() || null,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      customerIds: selectedIds,
    }
    try {
      const res = trip ? await tripsAPI.update(trip.id, payload) : await tripsAPI.create(payload)
      await onSaved?.(res.data)
      onClose()
    } catch (err) {
      console.error('Failed to save trip', err)
      const detail = err?.response?.data?.error
      setError(typeof detail === 'string' ? detail : 'Failed to save trip')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Trip</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {trip ? 'Edit trip' : 'Schedule trip'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Trip title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. East China customer visits" required />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Assignee (colleague)</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <div />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Start</span>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">End</span>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} required />
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Select customers (stops)</span>
              <span className="text-xs text-slate-400">{selectedIds.length} selected</span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, address, contact..."
              className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white"
            />
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">No matching customers</p>
              ) : (
                filtered.map((c) => {
                  const checked = selectedIds.includes(c.id)
                  const hasCoords = typeof c.latitude === 'number' && typeof c.longitude === 'number'
                  return (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-brand-50/50"
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} className="h-4 w-4 accent-brand-600" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        {c.address && <span className="block truncate text-xs text-slate-400">{c.address}</span>}
                      </span>
                      {!hasCoords && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600" title="No coordinates — won't appear on the map">
                          no coords
                        </span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">Stops are auto-ordered by geographic distance.</p>
          </div>

          {/* Flights (optional) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Flights <span className="text-slate-400">(optional)</span></span>
              <button type="button" onClick={addFlight} className="text-xs font-semibold text-brand-600 hover:underline">+ Add flight</button>
            </div>
            {flights.length > 0 && (
              <div className="space-y-2">
                {flights.map((f, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 p-2.5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <input value={f.date || ''} onChange={(e) => updateFlight(i, 'date', e.target.value)} placeholder="Date e.g. 8 Jul" className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
                      <input value={f.flightNo || ''} onChange={(e) => updateFlight(i, 'flightNo', e.target.value)} placeholder="Flight e.g. CA4508" className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
                      <input value={f.routing || ''} onChange={(e) => updateFlight(i, 'routing', e.target.value)} placeholder="Routing e.g. → CTU" className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
                      <input value={f.time || ''} onChange={(e) => updateFlight(i, 'time', e.target.value)} placeholder="Time e.g. 06:55" className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input value={f.notes || ''} onChange={(e) => updateFlight(i, 'notes', e.target.value)} placeholder="Notes" className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
                      <button type="button" onClick={() => removeFlight(i)} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Planning constraints <span className="text-slate-400">(optional, for AI)</span></span>
            <textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={2} className={inputCls} placeholder="e.g. Priority client needs 1.5 days; factories closed on weekends; pick one Shanghai client..." />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Purpose, notes for the trip..." />
          </label>

          <label className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5">
            <input type="checkbox" checked={hidePhone} onChange={(e) => setHidePhone(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            <span className="text-sm text-slate-700">Hide customer phone on the public share page</span>
          </label>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <button onClick={onClose} type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
            {saving ? 'Saving...' : trip ? 'Save changes' : 'Create trip'}
          </button>
        </div>
      </div>
    </div>
  )
}
