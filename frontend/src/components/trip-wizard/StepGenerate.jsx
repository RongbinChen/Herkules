import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tripsAPI } from '../../api/api'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import ShareLinkBar from '../ShareLinkBar'
import TripPlanView from '../TripPlanView'
import { Button, Card } from '../ui'
import { buildTripPayload } from './context'

// A client-side timeout can hide a plan that actually landed, so these are the
// failures worth re-checking the server about before reporting them.
const isTimeoutish = (e) =>
  e.code === 'ECONNABORTED' || !e.response || [502, 503, 504].includes(e.response.status)

function waitingLabel(seconds) {
  if (seconds < 15) return 'Saving the trip and preparing the plan…'
  if (seconds < 45) return 'DeepSeek is arranging the itinerary…'
  if (seconds < 120) return 'Still working — the planning model thinks for up to two minutes.'
  return 'Taking unusually long. You can keep waiting, or open the trip and generate later — nothing is lost.'
}

export default function StepGenerate({ draft, patch, customers, onDone, bindRef, onPhase, children }) {
  const navigate = useNavigate()
  // idle | saving | planning | done | planFailed | failed
  const [phase, setPhase] = useState('idle')
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState('')
  const elapsed = useElapsedSeconds(phase === 'saving' || phase === 'planning')

  const busy = phase === 'saving' || phase === 'planning'

  async function run({ regenerate = true, skipConstraints = false } = {}) {
    setError('')
    setPhase('saving')
    // Skip plans from customers, order, dates, and flights only. The empty
    // list is what gets saved; the pasted brief stays in the draft.
    const source = skipConstraints ? { ...draft, constraints: '' } : draft
    let savedId = draft.createdTripId ?? (draft.mode === 'edit' ? draft.tripId : null)
    try {
      // Reuse the trip we already created if the user refreshed or retried
      // after a failed plan — otherwise every retry leaves another trip behind.
      const payload = buildTripPayload(source)

      if (!savedId) {
        const { data } = await tripsAPI.create(payload)
        savedId = data.id
        setTrip(data)
        patch((d) => ({ ...d, createdTripId: data.id }))
      } else {
        // Only tell the backend the plan is stale when the order actually
        // moved. Changing the title or a note must leave the itinerary alone;
        // a customer-set change is detected server-side regardless.
        const order = source.stops.map((s) => s.customerId)
        const base = source.baseStopOrder || order
        const reordered = order.length !== base.length || order.some((c, i) => c !== base[i])
        const { data } = await tripsAPI.update(savedId, { ...payload, clearItinerary: reordered })
        setTrip(data)
      }

      if (skipConstraints) {
        patch((d) => ({ ...d, constraints: '', constraintsEdited: false }))
      }

      if (!regenerate) {
        setPhase('done')
        return
      }

      setPhase('planning')
      const { data: planned } = await tripsAPI.plan(savedId)
      setTrip(planned)
      setPhase('done')
    } catch (e) {
      if (savedId && isTimeoutish(e)) {
        const recovered = await tripsAPI
          .get(savedId)
          .then((r) => (r.data.itineraryAt ? r.data : null))
          .catch(() => null)
        if (recovered) {
          setTrip(recovered)
          setPhase('done')
          return
        }
      }
      setError(
        typeof e.response?.data?.error === 'string'
          ? e.response.data.error
          : 'Failed to generate the itinerary',
      )
      // The trip itself is real work — customers, order, dates, priorities —
      // and a failed plan says nothing about it. Keep it and let the user
      // retry or generate later from the trip page. savedId is set once the
      // row exists, including edit mode, so a plan failure is not reported
      // as a failed save.
      setPhase(savedId ? 'planFailed' : 'failed')
    }
  }

  if (bindRef) {
    bindRef.current = {
      generate: () => run({ regenerate: true }),
      skip: () => run({ regenerate: true, skipConstraints: true }),
      save: () => run({ regenerate: false }),
    }
  }

  useEffect(() => { onPhase?.(phase) }, [phase, onPhase])

  const open = () => {
    onDone()
    navigate(`/trips/${trip.id}`)
  }

  const selected = draft.stops
    .map((s) => customers.find((c) => c.id === s.customerId))
    .filter(Boolean)

  const showForm = phase === 'idle' || phase === 'failed' || phase === 'planFailed'
  const constraintText = (draft.constraints || '').trim()

  return (
    <div className="space-y-4">
      {phase === 'idle' && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-700">Plan</h2>
          <p className="mt-1 text-xs text-slate-500">
            Constraints are optional. Generate uses what you write below. “Skip — generate without
            constraints” plans from the customers, order, dates, and flights only. The trip is saved
            either way.
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Title</dt><dd className="min-w-0 font-medium text-slate-700">{draft.meta.title}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Dates</dt><dd className="text-slate-700">{draft.meta.startTime.replace('T', ' ')} → {draft.meta.endTime.replace('T', ' ')}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Stops</dt><dd className="min-w-0 text-slate-700">{selected.map((c) => c.name).join(' → ') || 'None yet'}</dd></div>
            {draft.meta.flights.length > 0 && (
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Flights</dt><dd className="text-slate-700">{draft.meta.flights.length} recorded</dd></div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-400">Constraints</dt>
              <dd className="min-w-0 whitespace-pre-wrap text-slate-600">{constraintText || 'None — optional'}</dd>
            </div>
          </dl>
        </Card>
      )}

      {busy && (
        <Card className="p-6 text-center">
          <p className="text-3xl font-bold tabular-nums text-slate-700">{elapsed}s</p>
          <p className="mt-2 text-sm text-slate-500">{waitingLabel(elapsed)}</p>
          {trip?.shareToken && (
            <div className="mt-4 text-left">
              <p className="mb-1.5 text-xs text-slate-400">
                The trip is already saved — you can share the link now, the plan will fill in.
              </p>
              <ShareLinkBar shareToken={trip.shareToken} hidePhoneOnShare={trip.hidePhoneOnShare} />
            </div>
          )}
        </Card>
      )}

      {(phase === 'done' || phase === 'planFailed') && trip && (
        <>
          <Card className="p-4">
            <p className="font-semibold text-emerald-600">Trip saved ✓</p>
            <p className="mt-0.5 text-sm text-slate-500">{trip.title}</p>
          </Card>

          <ShareLinkBar shareToken={trip.shareToken} hidePhoneOnShare={trip.hidePhoneOnShare} />

          {phase === 'planFailed' && (
            <Card className="border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">Itinerary not generated</p>
              <p className="mt-1 text-sm text-amber-700">{error}</p>
              <p className="mt-1 text-xs text-amber-600">
                The trip itself is saved and shareable. You can retry here, or open the trip and press
                “Generate with AI” whenever the assistant is available again.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => run({ regenerate: true })}>Retry generation</Button>
                <Button size="sm" variant="secondary" onClick={open}>Open trip</Button>
              </div>
            </Card>
          )}

          {phase === 'done' && (
            <>
              {trip.itinerary?.days?.length > 0 && (
                <Card className="p-4"><TripPlanView trip={trip} /></Card>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={open}>Open trip</Button>
                <Button variant="secondary" onClick={() => setPhase('idle')}>Edit constraints</Button>
              </div>
            </>
          )}
        </>
      )}

      {phase === 'failed' && (
        <Card className="border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">Could not save the trip</p>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
          <p className="mt-1 text-xs text-rose-600">Your draft is untouched — nothing has been lost.</p>
          <Button size="sm" className="mt-3" onClick={() => run({ regenerate: true })}>Try again</Button>
        </Card>
      )}

      {showForm && children}
    </div>
  )
}
