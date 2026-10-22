import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  STEPS,
  canLeave,
  maxReachable,
  resolveWizardStep,
  stepErrors,
  wizardStepNeedsRedirect,
} from './context'

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
  const rawStep = params.get('step')
  // Edit opens on Plan. ?step=4 (the old confirmation step) clamps to 3.
  const step = resolveWizardStep(rawStep, mode)

  const [draft, setDraft] = useState(null)
  const [customers, setCustomers] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [conflict, setConflict] = useState(null)
  const [showErrors, setShowErrors] = useState(false)
  // Plan's generate/save/skip live in the sticky footer, but the request state
  // stays inside StepGenerate. The ref is written during that child's render.
  const planApi = useRef(null)
  const [planPhase, setPlanPhase] = useState('idle')

  const patch = useCallback((fn) => setDraft((d) => (d ? fn(d) : d)), [])

  const goStep = (n) => {
    setShowErrors(false)
    setParams({ step: String(resolveWizardStep(n, 'create')) })
  }

  useEffect(() => {
    if (!wizardStepNeedsRedirect(rawStep, mode)) return
    setParams({ step: String(step) }, { replace: true, state: location.state })
  }, [rawStep, mode, step, setParams, location.state])

  // Leaving Plan unmounts the generator. Don't keep a stale "saving" phase
  // and hide the actions when the user comes back.
  useEffect(() => {
    if (step !== STEPS.length) setPlanPhase('idle')
  }, [step])

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
  const earlierErrors = [...new Set([...errors[1], ...errors[2]])]

  const next = () => {
    if (stepBlocked) return setShowErrors(true)
    goStep(step + 1)
  }

  // Generate/save/skip all persist the trip. Basics and order still have to be
  // valid — the URL can open Plan directly, the buttons cannot skip that.
  const runPlan = (action) => {
    if (earlierErrors.length) return setShowErrors(true)
    action?.()
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

  const planCanAct = planPhase === 'idle' || planPhase === 'failed' || planPhase === 'planFailed'
  const footer = step === STEPS.length ? (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => goStep(step - 1)}>← Back</Button>
        <span className="text-xs text-slate-400">Step {step} of {STEPS.length}</span>
      </div>
      {planCanAct && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => runPlan(planApi.current?.skip)}>
            Skip — generate without constraints
          </Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => runPlan(planApi.current?.save)}>
            Save without a plan
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => runPlan(planApi.current?.generate)}>
            ✨ Generate itinerary
          </Button>
        </div>
      )}
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      {step > 1
        ? <Button variant="secondary" onClick={() => goStep(step - 1)}>← Back</Button>
        : <Button variant="secondary" onClick={() => navigate('/trips')}>Cancel</Button>}
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-slate-400 sm:inline">Step {step} of {STEPS.length}</span>
        <Button onClick={next}>Next →</Button>
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
      subtitle={draft.meta.title || (mode === 'edit' ? '' : 'Three steps: basics, order, and plan')}
      banner={banner}
      errors={showErrors ? (step === STEPS.length ? earlierErrors : errors[step]) : []}
      footer={footer}
    >
      {step === 1 && (
        <StepCustomers draft={draft} patch={patch} customers={customers} users={users} onCustomerSaved={onCustomerSaved} />
      )}
      {step === 2 && <StepOrder draft={draft} patch={patch} customers={customers} />}
      {step === 3 && (
        <StepGenerate draft={draft} patch={patch} customers={customers} onDone={finish} bindRef={planApi} onPhase={setPlanPhase}>
          <StepChat draft={draft} patch={patch} customerById={customerById} />
        </StepGenerate>
      )}
    </WizardShell>
  )
}
