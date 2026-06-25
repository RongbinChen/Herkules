import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { tripsAPI } from '../api/api'
import TripMap from './TripMap'
import TripModal from './TripModal'

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Editable copy of the stops (manual reorder + arrival-time tuning).
  const [stops, setStops] = useState([])
  const [dirty, setDirty] = useState(false)
  const [savingStops, setSavingStops] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await tripsAPI.get(id)
      setTrip(res.data)
      setStops(res.data.stops || [])
      setDirty(false)
    } catch (err) {
      console.error('Failed to load trip', err)
      setTrip(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const shareUrl = trip ? `${window.location.origin}/trip/share/${trip.shareToken}` : ''

  // Spread arrival times evenly across the trip window, in current order — so
  // reordering stops automatically re-sequences the suggested dates.
  function redistribute(list) {
    if (!trip || list.length === 0) return list
    const start = new Date(trip.startTime).getTime()
    const span = new Date(trip.endTime).getTime() - start
    const n = list.length
    return list.map((s, i) => ({
      ...s,
      plannedArrival: new Date(start + (span * i) / n).toISOString(),
    }))
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', shareUrl)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete trip “${trip.title}”? This cannot be undone.`)) return
    try {
      await tripsAPI.delete(trip.id)
      navigate('/trips')
    } catch (err) {
      console.error('Failed to delete trip', err)
      window.alert('Delete failed')
    }
  }

  function moveStop(index, dir) {
    const j = index + dir
    if (j < 0 || j >= stops.length) return
    const next = [...stops]
    ;[next[index], next[j]] = [next[j], next[index]]
    // Re-sequence suggested arrival dates to follow the new order.
    setStops(redistribute(next))
    setDirty(true)
  }

  function setArrival(index, localValue) {
    const next = [...stops]
    next[index] = {
      ...next[index],
      plannedArrival: localValue ? new Date(localValue).toISOString() : null,
    }
    setStops(next)
    setDirty(true)
  }

  async function saveStops() {
    setSavingStops(true)
    try {
      const payload = {
        title: trip.title,
        notes: trip.notes || undefined,
        assigneeId: trip.assignee?.id ?? null,
        hidePhoneOnShare: trip.hidePhoneOnShare === true,
        startTime: trip.startTime,
        endTime: trip.endTime,
        stops: stops.map((s, i) => ({
          customerId: s.customer.id,
          order: i,
          plannedArrival: s.plannedArrival,
          notes: s.notes ?? null,
        })),
      }
      const res = await tripsAPI.update(trip.id, payload)
      setTrip(res.data)
      setStops(res.data.stops || [])
      setDirty(false)
    } catch (err) {
      console.error('Failed to save stops', err)
      window.alert('Failed to save changes')
    } finally {
      setSavingStops(false)
    }
  }

  if (loading) return <p className="py-16 text-center text-slate-400">Loading...</p>
  if (!trip) {
    return (
      <div className="mx-auto max-w-[1100px] p-5">
        <p className="py-16 text-center text-slate-400">Trip not found.</p>
        <div className="text-center">
          <button onClick={() => navigate('/trips')} className="text-sky-600 hover:underline">← Back to trips</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/trips')}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            ← Trips
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{trip.title}</h1>
            <p className="text-sm text-slate-500">
              {new Date(trip.startTime).toLocaleString('en-US')} → {new Date(trip.endTime).toLocaleString('en-US')}
              {trip.assignee?.name ? ` · Assignee ${trip.assignee.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50">
            Edit
          </button>
          <button onClick={handleDelete} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>

      {/* Share link */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
        <span className="text-sm font-semibold text-sky-700">Public share link</span>
        <input
          readOnly
          value={shareUrl}
          onFocus={(e) => e.target.select()}
          className="min-w-[220px] flex-1 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none"
        />
        <button onClick={copyShare} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-700">
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <p className="w-full text-xs text-sky-600/80">
          Anyone with this link can view the trip and map without logging in (Google Maps by default; switch to AMap for China access).
          {trip.hidePhoneOnShare ? ' Phone numbers are hidden from the public page.' : ''}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <TripMap stops={stops} height={460} />
        </div>
        <div>
          {trip.notes && (
            <p className="mb-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">{trip.notes}</p>
          )}

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Visit order / times (editable)</h2>
            {dirty && (
              <div className="flex items-center gap-2">
                <button onClick={() => load()} className="text-xs font-semibold text-slate-500 hover:underline">Reset</button>
                <button
                  onClick={saveStops}
                  disabled={savingStops}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingStops ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            )}
          </div>

          {stops.length === 0 ? (
            <p className="text-sm text-slate-400">This trip has no stops.</p>
          ) : (
            <ol className="space-y-3">
              {stops.map((s, i) => (
                <li key={s.id ?? s.customer.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">{s.customer.name}</p>
                    {s.customer.address && <p className="mt-0.5 text-sm text-slate-500">{s.customer.address}</p>}
                    {s.customer.contactName && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        Contact: {s.customer.contactName}
                        {s.customer.contactPhone ? ` · ${s.customer.contactPhone}` : ''}
                      </p>
                    )}
                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      Arrival
                      <input
                        type="datetime-local"
                        value={toLocalInput(s.plannedArrival)}
                        onChange={(e) => setArrival(i, e.target.value)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1">
                    <button
                      onClick={() => moveStop(i, -1)}
                      disabled={i === 0}
                      title="Move up"
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveStop(i, 1)}
                      disabled={i === stops.length - 1}
                      title="Move down"
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <TripModal isOpen={editOpen} trip={trip} onClose={() => setEditOpen(false)} onSaved={() => load()} />
    </div>
  )
}
