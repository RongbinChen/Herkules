import { Button, Card, Input, Textarea } from '../ui'

// Step 3 — planning constraints.
//
// The multi-turn AI interview lands here in the next change. Until then this is
// the manual path, which has to keep working regardless: the assistant runs on
// DeepSeek and the wizard must never dead-end when that account is out of
// balance or unreachable.
export default function StepChat({ draft, patch }) {
  const setConstraints = (value) =>
    patch((d) => ({ ...d, constraints: value, constraintsEdited: true }))

  const addFlight = () =>
    patch((d) => ({
      ...d,
      meta: { ...d.meta, flights: [...d.meta.flights, { date: '', flightNo: '', routing: '', time: '', notes: '' }] },
    }))

  const updateFlight = (i, field, value) =>
    patch((d) => ({
      ...d,
      meta: { ...d.meta, flights: d.meta.flights.map((f, idx) => (idx === i ? { ...f, [field]: value } : f)) },
    }))

  const removeFlight = (i) =>
    patch((d) => ({ ...d, meta: { ...d.meta, flights: d.meta.flights.filter((_, idx) => idx !== i) } }))

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Planning constraints</h2>
        <p className="mb-3 text-xs text-slate-400">
          Anything the planner should respect: fixed appointments, working hours, how hard you want to
          push each day, factories that don't receive visitors at weekends.
        </p>
        <Textarea
          rows={8}
          value={draft.constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder={'- COSCO can only meet Wednesday morning\n- No factory visits at weekends\n- At most two customers per day'}
        />
      </Card>

      <Card className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Flights (optional)</h2>
          <Button size="sm" variant="secondary" onClick={addFlight}>+ Add</Button>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Bookings you already hold. The planner treats these as fixed and builds the days around them.
        </p>

        {draft.meta.flights.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No flights recorded.</p>
        ) : (
          <div className="space-y-2">
            {draft.meta.flights.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 p-2">
                <Input value={f.date || ''} onChange={(e) => updateFlight(i, 'date', e.target.value)} placeholder="8 Sep" className="w-24 py-1.5 text-xs" aria-label="Flight date" />
                <Input value={f.flightNo || ''} onChange={(e) => updateFlight(i, 'flightNo', e.target.value)} placeholder="CA4501" className="w-28 py-1.5 text-xs" aria-label="Flight number" />
                <Input value={f.routing || ''} onChange={(e) => updateFlight(i, 'routing', e.target.value)} placeholder="PEK → TAO" className="w-32 py-1.5 text-xs" aria-label="Routing" />
                <Input value={f.time || ''} onChange={(e) => updateFlight(i, 'time', e.target.value)} placeholder="06:55" className="w-20 py-1.5 text-xs" aria-label="Departure time" />
                <Input value={f.notes || ''} onChange={(e) => updateFlight(i, 'notes', e.target.value)} placeholder="Notes" className="min-w-[100px] flex-1 py-1.5 text-xs" aria-label="Flight notes" />
                <button
                  type="button"
                  onClick={() => removeFlight(i)}
                  className="shrink-0 px-1 text-slate-300 transition hover:text-rose-500"
                  aria-label="Remove flight"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
