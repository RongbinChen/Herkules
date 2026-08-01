import { useState } from 'react'
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

export default function StepGenerate({ draft, patch, customers, onDone }) {
  const navigate = useNavigate()
  // idle | saving | planning | done | planFailed | failed
  const [phase, setPhase] = useState('idle')
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState('')
  const elapsed = useElapsedSeconds(phase === 'saving' || phase === 'planning')

  const busy = phase === 'saving' || phase === 'planning'

  async function run({ regenerate = true } = {}) {
    setError('')
    setPhase('saving')
    try {
      // Reuse the trip we already created if the user refreshed or retried
      // after a failed plan — otherwise every retry leaves another trip behind.
      let id = draft.createdTripId ?? (draft.mode === 'edit' ? draft.tripId : null)
      const payload = buildTripPayload(draft)

      if (!id) {
        const { data } = await tripsAPI.create(payload)
        id = data.id
        setTrip(data)
        patch((d) => ({ ...d, createdTripId: data.id }))
      } else {
        // Reordering invalidates a saved plan even when the customer set is
        // unchanged, so say so explicitly.
        const { data } = await tripsAPI.update(id, { ...payload, clearItinerary: true })
        setTrip(data)
      }

      if (!regenerate) {
        setPhase('done')
        return
      }

      setPhase('planning')
      const { data: planned } = await tripsAPI.plan(id)
      setTrip(planned)
      setPhase('done')
    } catch (e) {
      const id = draft.createdTripId
      if (id && isTimeoutish(e)) {
        const recovered = await tripsAPI
          .get(id)
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
      // retry or generate later from the trip page.
      setPhase(draft.createdTripId || trip ? 'planFailed' : 'failed')
    }
  }

  const open = () => {
    onDone()
    navigate(`/trips/${trip.id}`)
  }

  const selected = draft.stops
    .map((s) => customers.find((c) => c.id === s.customerId))
    .filter(Boolean)

  return (
    <div className="space-y-4">
      {phase === 'idle' && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Ready to generate</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Title</dt><dd className="min-w-0 font-medium text-slate-700">{draft.meta.title}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Dates</dt><dd className="text-slate-700">{draft.meta.startTime.replace('T', ' ')} → {draft.meta.endTime.replace('T', ' ')}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Stops</dt><dd className="min-w-0 text-slate-700">{selected.map((c) => c.name).join(' → ')}</dd></div>
            {draft.meta.flights.length > 0 && (
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Flights</dt><dd className="text-slate-700">{draft.meta.flights.length} recorded</dd></div>
            )}
            {draft.constraints.trim() && (
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-400">Constraints</dt><dd className="min-w-0 whitespace-pre-wrap text-slate-600">{draft.constraints.trim()}</dd></div>
            )}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => run({ regenerate: true })}>✨ Generate itinerary</Button>
            <Button variant="secondary" onClick={() => run({ regenerate: false })}>
              Save without a plan
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            The trip is saved either way — you can always generate the plan later from the trip page.
          </p>
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
              <div className="flex gap-2">
                <Button onClick={open}>Open trip</Button>
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
    </div>
  )
}
