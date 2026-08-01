import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { customersAPI, tripsAPI, usersAPI } from '../../api/api'
import {
  clearDraft,
  draftFromTrip,
  emptyDraft,
  loadDraft,
  purgeStaleDrafts,
  saveDraft,
} from '../../utils/tripDraft'
import { sortStopsByArrival } from '../../utils/trips'
import { Button, Card } from '../ui'
import StepChat from './StepChat'
import StepCustomers from './StepCustomers'
import StepGenerate from './StepGenerate'
import StepOrder from './StepOrder'
import WizardShell from './WizardShell'
import { canLeave, maxReachable, stepErrors } from './context'

const clampStep = (n) => Math.min(4, Math.max(1, Number(n) || 1))

function withSeededStops(draft, customerIds) {
  const have = new Set(draft.stops.map((s) => s.customerId))
  const added = customerIds
    .filter((cid) => !have.has(cid))
    .map((customerId) => ({ customerId, priority: 'NORMAL', visitDuration: '', notes: '', plannedArrival: null }))
  return added.length ? { ...draft, stops: [...draft.stops, ...added] } : draft
}

export default function TripWizard({ mode = 'create' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // "Schedule trip" on the customer list arrives with a pre-selection.
  const seedCustomerIds = location.state?.customerIds
  // The step lives in the URL so the phone's system back button walks back a
  // step instead of dropping out of the wizard, and a refresh stays put.
  const [params, setParams] = useSearchParams()
  const step = clampStep(params.get('step'))

  const [draft, setDraft] = useState(null)
  const [customers, setCustomers] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [conflict, setConflict] = useState(null)
  const [showErrors, setShowErrors] = useState(false)

  const patch = useCallback((fn) => setDraft((d) => (d ? fn(d) : d)), [])

  const goStep = (n) => {
    setShowErrors(false)
    setParams({ step: String(clampStep(n)) })
  }

  useEffect(() => {
    let cancelled = false
    purgeStaleDrafts()

    async function boot() {
      setLoading(true)
      setLoadError('')
      try {
        const [custRes, userRes] = await Promise.all([
          customersAPI.getAll(),
          usersAPI.getVisible().catch(() => usersAPI.getAll()),
        ])
        if (cancelled) return
        setCustomers(custRes.data || [])
        setUsers(userRes.data || [])

        const saved = loadDraft(mode, id ?? null)
        if (mode === 'edit') {
          const { data: trip } = await tripsAPI.get(id)
          if (cancelled) return
          const fresh = draftFromTrip(trip, sortStopsByArrival(trip.stops || []))
          if (saved && saved.baseUpdatedAt !== trip.updatedAt) {
            // Someone (or you, from the trip page) changed this trip while the
            // draft sat here. Never silently discard unsaved edits — ask.
            setConflict({ fresh })
            setDraft(saved)
          } else {
            setDraft(saved || fresh)
          }
        } else {
          // Merge a pre-selection into whatever we already have rather than
          // replacing it: arriving from the customer list should not silently
          // throw away a draft, and it should not ignore the selection either.
          const base = saved || emptyDraft('create')
          setDraft(seedCustomerIds?.length ? withSeededStops(base, seedCustomerIds) : base)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.response?.data?.error || 'Failed to load. Check your connection and retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    boot()
    return () => { cancelled = true }
  }, [mode, id])

  // Persist on every change. Cheap, and it means closing the tab loses nothing.
  useEffect(() => { if (draft) saveDraft(draft) }, [draft])

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const onCustomerSaved = useCallback((customer) => {
    setCustomers((prev) => {
      const i = prev.findIndex((c) => c.id === customer.id)
      if (i < 0) return [customer, ...prev]
      const next = [...prev]
      next[i] = customer
      return next
    })
  }, [])

  const finish = useCallback(() => {
    if (draft) clearDraft(draft.mode, draft.tripId)
  }, [draft])

  if (loading) return <p className="p-8 text-center text-sm text-slate-400">Loading…</p>

  if (loadError) {
    return (
      <div className="mx-auto max-w-[900px] p-5">
        <Card className="border-rose-200 bg-rose-50 p-4">
          <p className="text-sm text-rose-700">{loadError}</p>
          <Button size="sm" className="mt-3" onClick={() => window.location.reload()}>Retry</Button>
        </Card>
      </div>
    )
  }
  if (!draft) return null

  const errors = stepErrors(draft)
  const reachable = maxReachable(draft)
  const stepBlocked = !canLeave(draft, step)

  const next = () => {
    if (stepBlocked) return setShowErrors(true)
    goStep(step + 1)
  }

  const banner = conflict && (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
      <p className="text-sm font-semibold text-amber-800">This trip changed while your draft was open</p>
      <p className="mt-0.5 text-xs text-amber-700">
        You have unsaved wizard edits, and the saved trip has since been modified. Keep yours, or start again
        from what is stored.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Keep my draft</Button>
        <Button size="sm" onClick={() => { setDraft(conflict.fresh); setConflict(null) }}>Reload from saved trip</Button>
      </div>
    </div>
  )

  const footer =
    step === 4 ? (
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => goStep(3)}>← Back</Button>
        <span className="text-xs text-slate-400">Step 4 of 4</span>
      </div>
    ) : (
      <div className="flex items-center justify-between gap-2">
        {step > 1
          ? <Button variant="secondary" onClick={() => goStep(step - 1)}>← Back</Button>
          : <Button variant="secondary" onClick={() => navigate('/trips')}>Cancel</Button>}
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-400 sm:inline">Step {step} of 4</span>
          <Button onClick={next}>{step === 3 ? 'Review and generate →' : 'Next →'}</Button>
        </div>
      </div>
    )

  return (
    <WizardShell
      step={step}
      maxReachable={reachable}
      onStep={goStep}
      onExit={() => navigate('/trips')}
      title={mode === 'edit' ? 'Edit trip' : 'Schedule a trip'}
      subtitle={draft.meta.title || (mode === 'edit' ? '' : 'Four steps: customers, order, constraints, generate')}
      banner={banner}
      errors={showErrors ? errors[step] : []}
      footer={footer}
    >
      {step === 1 && (
        <StepCustomers draft={draft} patch={patch} customers={customers} users={users} onCustomerSaved={onCustomerSaved} />
      )}
      {step === 2 && <StepOrder draft={draft} patch={patch} customers={customers} />}
      {step === 3 && <StepChat draft={draft} patch={patch} customerById={customerById} />}
      {step === 4 && <StepGenerate draft={draft} patch={patch} customers={customers} onDone={finish} />}
    </WizardShell>
  )
}
