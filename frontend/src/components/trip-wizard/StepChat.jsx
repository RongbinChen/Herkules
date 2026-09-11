import { useState } from 'react'
import { tripsAPI } from '../../api/api'
import { Button, Card, Textarea } from '../ui'
import { buildChatContext } from './context'

// One box, not an interview.
//
// This step used to ask nine questions one turn at a time. Nobody answered it
// that way — people pasted the whole trip in a single message and then got
// asked eight more questions about what they had just written. So the box takes
// the paragraph, and one pass turns it into the bullet list the planner reads.
//
// Whatever the model could not find, it says so underneath rather than asking:
// a missing return flight is worth knowing about, and worth ignoring when it
// does not matter yet.
const PLACEHOLDER = `Paste or type everything you know about this trip, in any language. For example:

我们的飞机将于 11:00 左右到西安咸阳机场，第一天拜访西安的客户，第二天拜访汉中的客户，从西安到汉中可以安排坐火车过去。如果时间排得开，第二天（9 月 15 日）回家，Uwe 回上海，我回北京。`

export default function StepChat({ draft, patch, customerById }) {
  const [brief, setBrief] = useState(draft.brief || '')
  const [loading, setLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [missing, setMissing] = useState([])
  const [ranOn, setRanOn] = useState(null)

  const setConstraints = (value) =>
    patch((d) => ({ ...d, constraints: value, constraintsEdited: true }))

  async function readBrief() {
    const text = brief.trim()
    if (!text || loading) return
    setAiError('')
    setLoading(true)
    patch((d) => ({ ...d, brief: text }))
    try {
      const { data } = await tripsAPI.planBrief({
        brief: text,
        context: buildChatContext(draft, customerById),
      })
      setMissing(data.missing || [])
      setRanOn(data.model || null)
      // Hand-edited constraints are a decision; the reader does not overwrite
      // them, it offers its version and lets the person choose.
      if (!draft.constraintsEdited) {
        patch((d) => ({ ...d, constraints: data.constraints || '' }))
      }
    } catch (e) {
      setAiError(e.response?.data?.error || 'Could not read that. Write the constraints on the right and continue.')
    } finally {
      setLoading(false)
    }
  }

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
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* ── The brief ── */}
      <div className="flex min-h-[420px] flex-col">
        <Card className="flex flex-1 flex-col p-4">
          <h3 className="text-sm font-semibold text-slate-700">Tell the planner about this trip</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            One box. Write it however you would tell a colleague — flights, who you must see, what has
            to happen on which day, when you fly home.
          </p>
          <Textarea
            rows={12}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={PLACEHOLDER}
            className="mt-3 flex-1 text-sm"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={readBrief} disabled={!brief.trim() || loading}>
              {loading ? 'Reading…' : '✨ Turn this into constraints'}
            </Button>
            {ranOn && !loading && (
              <span className="text-xs text-slate-400">
                Read {ranOn === 'local' ? 'on the local model' : 'in the cloud'} · edit anything on the right
              </span>
            )}
          </div>

          {aiError && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {aiError}
            </p>
          )}

          {/* Told, not asked. The step never blocks on these — a trip with an
              unbooked return flight is still worth planning. */}
          {missing.length > 0 && !loading && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-600">Still unknown — add it above if it matters:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                {missing.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* ── Always-visible side panel. The constraints are the thing that
             actually reaches the planner, so they are editable at all times
             rather than hidden behind the conversation. ── */}
      <div className="space-y-3">
        <Card className="p-3.5">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Planning constraints</h3>
          <p className="mb-2 text-xs text-slate-400">
            {draft.constraintsEdited
              ? 'Edited by hand — reading the brief again will not overwrite this.'
              : 'This is what the planner actually reads. Filled in from your brief.'}
          </p>
          <Textarea
            rows={8}
            value={draft.constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder={'- COSCO can only meet Wednesday morning\n- No factory visits at weekends'}
            className="text-xs"
          />
        </Card>

        <Card className="p-3.5">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Flights</h3>
            <Button size="sm" variant="secondary" onClick={addFlight}>+ Add</Button>
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Bookings you already hold. The planner treats these as fixed.
          </p>
          {draft.meta.flights.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">None recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {draft.meta.flights.map((f, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-1.5">
                  <div className="flex gap-1">
                    <input value={f.date || ''} onChange={(e) => updateFlight(i, 'date', e.target.value)} placeholder="8 Sep" className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-brand-400" aria-label="Date" />
                    <input value={f.flightNo || ''} onChange={(e) => updateFlight(i, 'flightNo', e.target.value)} placeholder="CA4501" className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-brand-400" aria-label="Flight number" />
                    <button type="button" onClick={() => removeFlight(i)} className="shrink-0 px-1 text-slate-300 hover:text-rose-500" aria-label="Remove flight">✕</button>
                  </div>
                  {/* Departure and arrival, separately and labelled. One box
                      called "Time" left it ambiguous and mostly empty — and the
                      arrival is the one the whole day hangs on: it decides
                      whether an afternoon visit is possible at all. The planner
                      is forbidden to invent it, so an empty box costs a real
                      answer. */}
                  <div className="mt-1 flex gap-1">
                    <input value={f.routing || ''} onChange={(e) => updateFlight(i, 'routing', e.target.value)} placeholder="PVG → XIY" title="Use 3-letter airport codes — they let the planner look up airport↔customer driving times" className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-brand-400" aria-label="Routing" />
                    <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                      dep
                      <input value={f.depart ?? f.time ?? ''} onChange={(e) => updateFlight(i, 'depart', e.target.value)} placeholder="06:55" className="w-12 rounded border border-slate-200 px-1 py-1 text-xs outline-none focus:border-brand-400" aria-label="Departure time" />
                    </label>
                    <label className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-brand-600">
                      arr
                      <input value={f.arrive || ''} onChange={(e) => updateFlight(i, 'arrive', e.target.value)} placeholder="11:00" title="Arrival decides what fits into that day — the planner never guesses it" className="w-12 rounded border border-brand-200 px-1 py-1 text-xs outline-none focus:border-brand-400" aria-label="Arrival time" />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}
