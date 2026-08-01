import { useMemo, useState } from 'react'
import { customersAPI } from '../../api/api'
import { hasCoords } from '../../utils/trips'
import { Badge, Button, Card, Input, Textarea } from '../ui'

// Rendering all ~500 customers at once makes the list janky on a phone.
const BROWSE_LIMIT = 50

export default function StepCustomers({ draft, patch, customers, users, onCustomerSaved }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [browse, setBrowse] = useState(false)
  const [geocoding, setGeocoding] = useState(null)
  const [geocodeErr, setGeocodeErr] = useState({})

  const selectedIds = useMemo(() => new Set(draft.stops.map((s) => s.customerId)), [draft.stops])
  const q = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!q) return []
    return customers.filter((c) => !selectedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 30)
  }, [q, customers, selectedIds])

  const exactMatch = q && customers.some((c) => c.name.toLowerCase() === q)

  const browseList = useMemo(() => {
    if (!browse) return []
    return customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q))
  }, [browse, customers, q])

  const setMeta = (field, value) => patch((d) => ({ ...d, meta: { ...d.meta, [field]: value } }))

  const addStop = (customerId) =>
    patch((d) =>
      d.stops.some((s) => s.customerId === customerId)
        ? d
        : { ...d, stops: [...d.stops, { customerId, priority: 'NORMAL', visitDuration: '', notes: '', plannedArrival: null }] },
    )

  const removeStop = (customerId) =>
    patch((d) => ({ ...d, stops: d.stops.filter((s) => s.customerId !== customerId) }))

  const toggleAssignee = (id) =>
    patch((d) => ({
      ...d,
      meta: {
        ...d.meta,
        assigneeIds: d.meta.assigneeIds.includes(id)
          ? d.meta.assigneeIds.filter((x) => x !== id)
          : [...d.meta.assigneeIds, id],
      },
    }))

  // Name-only creation, same as VisitReportModal: the backend's customer schema
  // only requires `name`. The address can be filled in on the card below, which
  // is what actually gets the customer onto the map.
  async function createCustomer() {
    const name = query.trim()
    if (!name || creating) return
    setErr('')
    setCreating(true)
    try {
      const { data } = await customersAPI.create({ name })
      onCustomerSaved(data)
      addStop(data.id)
      setQuery('')
      setOpen(false)
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to create customer')
    } finally {
      setCreating(false)
    }
  }

  // Saving an address lets the backend's applyGeocode fill in coordinates.
  async function saveAddress(customerId, address) {
    const customer = customers.find((c) => c.id === customerId)
    if (!customer || (customer.address || '') === address.trim()) return
    try {
      const { data } = await customersAPI.update(customerId, { address: address.trim() })
      onCustomerSaved(data)
    } catch (e) {
      setGeocodeErr((prev) => ({ ...prev, [customerId]: e.response?.data?.error || 'Could not save the address' }))
    }
  }

  // Geocoding runs on DeepSeek, so it fails whenever the AI account does.
  // Surface the reason and move on — a stop without coordinates still works.
  async function geocode(customerId) {
    const customer = customers.find((c) => c.id === customerId)
    if (!customer?.address) return
    setGeocoding(customerId)
    setGeocodeErr((prev) => ({ ...prev, [customerId]: '' }))
    try {
      const { data } = await customersAPI.geocode(customer.address)
      const { data: saved } = await customersAPI.update(customerId, {
        latitude: data.latitude,
        longitude: data.longitude,
      })
      onCustomerSaved(saved)
    } catch (e) {
      setGeocodeErr((prev) => ({ ...prev, [customerId]: e.response?.data?.error || 'Geocoding failed' }))
    } finally {
      setGeocoding(null)
    }
  }

  const selectedCustomers = draft.stops
    .map((s) => customers.find((c) => c.id === s.customerId))
    .filter(Boolean)
  const missingCoords = selectedCustomers.filter((c) => !hasCoords(c)).length

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Trip basics</h2>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Title</label>
        <Input
          value={draft.meta.title}
          onChange={(e) => setMeta('title', e.target.value)}
          placeholder="e.g. China customer site visits — September"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Start</label>
            <Input type="datetime-local" value={draft.meta.startTime} onChange={(e) => setMeta('startTime', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">End</label>
            <Input type="datetime-local" value={draft.meta.endTime} onChange={(e) => setMeta('endTime', e.target.value)} />
          </div>
        </div>

        {users.length > 0 && (
          <div className="mt-3">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Who is travelling</label>
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleAssignee(u.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    draft.meta.assigneeIds.includes(u.id)
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes (optional)</label>
          <Textarea rows={2} value={draft.meta.notes} onChange={(e) => setMeta('notes', e.target.value)} />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Who are you visiting?</h2>
        <p className="mb-3 text-xs text-slate-400">
          Search for a customer, or type a new name and create it on the spot.
        </p>

        <div className="relative">
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder="Search customers…"
          />
          {open && q && (matches.length > 0 || !exactMatch) && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  // mousedown fires before blur; without this the list closes
                  // out from under the click and nothing gets selected.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { addStop(c.id); setQuery('') }}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-700">{c.name}</span>
                    {c.address && <span className="block truncate text-xs text-slate-400">{c.address}</span>}
                  </span>
                  {!hasCoords(c) && <Badge tone="amber">no coords</Badge>}
                </button>
              ))}
              {!exactMatch && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={createCustomer}
                  disabled={creating}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3.5 py-2.5 text-left text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
                >
                  {creating ? 'Creating…' : <>+ Create “{query.trim()}”</>}
                </button>
              )}
            </div>
          )}
        </div>
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}

        <button
          type="button"
          onClick={() => setBrowse((v) => !v)}
          className="mt-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          {browse ? '▾ Hide full customer list' : '▸ Browse all customers'}
        </button>
        {browse && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200">
            {browseList.slice(0, BROWSE_LIMIT).map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-2 last:border-0 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => (selectedIds.has(c.id) ? removeStop(c.id) : addStop(c.id))}
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700">{c.name}</span>
                  {c.address && <span className="block truncate text-xs text-slate-400">{c.address}</span>}
                </span>
                {!hasCoords(c) && <Badge tone="amber">no coords</Badge>}
              </label>
            ))}
            {browseList.length > BROWSE_LIMIT && (
              <p className="px-3 py-2 text-xs text-slate-400">
                Showing {BROWSE_LIMIT} of {browseList.length} — refine the search above.
              </p>
            )}
            {browseList.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matches.</p>}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Selected <span className="tabular-nums text-slate-400">({draft.stops.length})</span>
          </h2>
          {missingCoords > 0 && <Badge tone="amber">{missingCoords} without coordinates</Badge>}
        </div>

        {draft.stops.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No customers selected yet.</p>
        ) : (
          <ul className="space-y-2">
            {draft.stops.map((s) => {
              const c = customers.find((x) => x.id === s.customerId)
              if (!c) return null
              const located = hasCoords(c)
              return (
                <li key={s.customerId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{c.name}</p>
                      {located && <p className="text-xs text-slate-400">{c.latitude.toFixed(3)}, {c.longitude.toFixed(3)}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!located && <Badge tone="amber">no coords</Badge>}
                      <button
                        type="button"
                        onClick={() => removeStop(s.customerId)}
                        className="text-slate-300 transition hover:text-rose-500"
                        aria-label={`Remove ${c.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {!located && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input
                        defaultValue={c.address || ''}
                        onBlur={(e) => saveAddress(c.id, e.target.value)}
                        placeholder="Add an address to put this stop on the map…"
                        className="min-w-[200px] flex-1 py-1.5 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!c.address || geocoding === c.id}
                        onClick={() => geocode(c.id)}
                        title={c.address ? 'Look up coordinates' : 'Add an address first'}
                      >
                        {geocoding === c.id ? 'Locating…' : 'Geocode'}
                      </Button>
                    </div>
                  )}
                  {geocodeErr[c.id] && <p className="mt-1 text-xs text-amber-600">{geocodeErr[c.id]}</p>}
                </li>
              )
            })}
          </ul>
        )}

        {missingCoords > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {missingCoords} of {draft.stops.length} stops have no coordinates. They will not appear on the map,
            they sort to the end of any geographic ordering, and the planner has only their address text to work
            from. You can continue anyway.
          </p>
        )}
      </Card>
    </div>
  )
}
