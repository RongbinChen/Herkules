import { useState } from 'react'
import { tripsAPI } from '../../api/api'
import ChatComposer from '../chat/ChatComposer'
import ChatThread from '../chat/ChatThread'
import { Button, Card, Textarea } from '../ui'
import { buildChatContext } from './context'

// Shown before the first request so the panel is never blank — and so the first
// real call happens after the user has typed something, which means a DeepSeek
// outage cannot leave them staring at an empty screen with no way in.
const OPENING = {
  role: 'assistant',
  content:
    "I'll help you pin down the requirements for this trip. First: are the flights or trains already booked? If so, tell me the dates and services; if not, roughly when do you want to travel?",
}

export default function StepChat({ draft, patch, customerById }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [manual, setManual] = useState(false)

  const messages = draft.chat.length ? draft.chat : [OPENING]

  const setConstraints = (value) =>
    patch((d) => ({ ...d, constraints: value, constraintsEdited: true }))

  async function send(text) {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setAiError('')
    // Keep the user's turn in the thread even if the request fails, so Retry
    // re-sends exactly what they wrote.
    const next = [...messages, { role: 'user', content }]
    patch((d) => ({ ...d, chat: next }))
    setInput('')
    setLoading(true)
    try {
      const { data } = await tripsAPI.planChat({
        messages: next.map(({ role, content: c }) => ({ role, content: c })),
        context: buildChatContext(draft, customerById),
      })
      patch((d) => ({ ...d, chat: [...next, { role: 'assistant', content: data.reply }] }))
    } catch (e) {
      setAiError(e.response?.data?.error || 'The planning assistant is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  const retry = () => {
    const lastUser = [...draft.chat].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    // Drop the turn we are about to re-send so it isn't duplicated.
    patch((d) => ({ ...d, chat: d.chat.slice(0, d.chat.findLastIndex((m) => m.role === 'user')) }))
    send(lastUser.content)
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
      {/* ── Interview ── */}
      <div className="flex min-h-[420px] flex-col">
        {aiError && (
          <Card className="mb-3 border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">Planning assistant unavailable</p>
            <p className="mt-1 text-sm text-amber-700">{aiError}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={retry}>Retry</Button>
              <Button size="sm" variant="secondary" onClick={() => { setManual(true); setAiError('') }}>
                Write constraints myself
              </Button>
            </div>
            <p className="mt-2 text-xs text-amber-600">
              You can continue to the next step either way — the interview is optional.
            </p>
          </Card>
        )}

        {!manual && (
          <>
            <ChatThread messages={messages} loading={loading} loadingLabel="Thinking…" className="mb-3" />
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={() => send()}
              disabled={loading}
              placeholder="Answer, or tell me anything else about the trip…"
              sendDisabled={!input.trim() || loading}
            />
          </>
        )}

        {manual && (
          <Card className="p-4">
            <p className="text-sm text-slate-500">
              Interview skipped. Write the constraints in the panel and continue — the planner reads that
              text directly.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setManual(false)}>
              Back to the assistant
            </Button>
          </Card>
        )}
      </div>

      {/* ── Always-visible side panel. The constraints are the thing that
             actually reaches the planner, so they are editable at all times
             rather than hidden behind the conversation. ── */}
      <div className="space-y-3">
        <Card className="p-3.5">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Planning constraints</h3>
          <p className="mb-2 text-xs text-slate-400">
            {draft.constraintsEdited
              ? 'Edited by hand — the assistant will not overwrite this.'
              : 'Filled in from the conversation when you continue.'}
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
                  <div className="mt-1 flex gap-1">
                    <input value={f.routing || ''} onChange={(e) => updateFlight(i, 'routing', e.target.value)} placeholder="PEK → TAO" className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-brand-400" aria-label="Routing" />
                    <input value={f.time || ''} onChange={(e) => updateFlight(i, 'time', e.target.value)} placeholder="06:55" className="w-16 shrink-0 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-brand-400" aria-label="Time" />
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
