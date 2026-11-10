/**
 * Project Follow-up — what happens to an order after it is won.
 *
 * Hot Projects ends at "won"; this starts there. The unit of work is a date
 * somebody has to hit: a letter of credit the buyer must open, a shipment
 * window the credit expires with, a payment, an acceptance. Every one of them
 * quietly costs money when it slips, and none of them announce themselves —
 * hence the reminder mail, which is the actual point of the module. The screen
 * exists to keep those dates correct.
 *
 * One page, two views: the list, and one record expanded. The record is a route
 * (/followups/:id) rather than a modal so a reminder mail can link straight at
 * it.
 */
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { followUpsAPI, usersAPI, customersAPI, contractsAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import useContractUnlock from '../hooks/useContractUnlock'
import { watchOpenOrdersRefresh } from '../utils/openOrdersRefresh'
import { docTypeMeta, displayFilename } from '../constants/contract'
import { Button, Input, Select, Textarea, Badge } from './ui'

// Re-exported so a render test wraps NewModal in this module's own context.
export { AuthProvider } from '../context/AuthContext'

const STATUSES = [
  { key: 'ACTIVE', label: 'Active', tone: 'emerald' },
  { key: 'ON_HOLD', label: 'On hold', tone: 'amber' },
  { key: 'COMPLETED', label: 'Completed', tone: 'slate' },
  { key: 'CANCELLED', label: 'Cancelled', tone: 'slate' },
]
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))

// The four groups the timeline is split into. Money and paperwork are chased by
// different people, and a flat list of sixteen dates reads as a wall.
const GROUPS = [
  { key: 'contract', label: 'Contract' },
  { key: 'lc', label: 'Letter of credit' },
  { key: 'money', label: 'Payments & guarantees' },
  { key: 'exec', label: 'Execution' },
]

// Roles that come up on a machine-tool export order. Free text is still
// allowed — this is a shortcut, not a schema.
const CONTACT_ROLES = ['Purchasing', 'Technical', 'Finance', 'Issuing bank', 'Forwarder', 'Customs broker', 'Site contact']

// Every date on the timeline is agreed in one of these two, so they are what
// the picker offers first. The rest of the customer's file are one click away.
const CONTRACT_PRIMARY = ['COMMERCIAL', 'TECHNICAL']
const fmtKB = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const serialText = (value) => String(value ?? '').trim()

const fmtDate = (d) => { try { return d ? format(new Date(d), 'yyyy-MM-dd') : '' } catch { return '' } }
const todayCN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const daysTo = (d) => Math.round((new Date(`${fmtDate(d)}T00:00:00Z`) - new Date(`${todayCN()}T00:00:00Z`)) / 86400000)

// How a date reads at a glance. Overdue is the only state that gets a loud
// colour: everything else is just "not yet".
function dueTone(m) {
  // Short enough to sit on one line in the status column; the full date is on
  // the element's title.
  if (m.doneAt) return { cls: 'text-emerald-600', text: '✓ Done', title: `Completed ${fmtDate(m.doneAt)}` }
  if (!m.dueDate) return { cls: 'text-slate-300', text: '' }
  const d = daysTo(m.dueDate)
  if (d < 0) return { cls: 'font-semibold text-rose-600', text: `${-d}d over` }
  if (d === 0) return { cls: 'font-semibold text-rose-500', text: 'Today' }
  if (d <= 14) return { cls: 'font-semibold text-amber-600', text: `in ${d}d` }
  return { cls: 'text-slate-500', text: `in ${d}d` }
}

// Machine model and serial are ordinary order data. The price is not drawn
// here: ContractValueLabel waits for this team's PIN, and a locked or
// restricted payload never becomes an amount just because the string is set.
export function FollowUpFactLine({ f, unlocked = false, onRequestUnlock }) {
  const serial = serialText(f.machineSerial)
  return (
    <>
      {f.machineType && <span>🛠 {f.machineType}</span>}
      {serial && <span title="Machine serial">Serial {serial}</span>}
      <ContractValueLabel followUp={f} unlocked={unlocked} onRequestUnlock={onRequestUnlock} />
    </>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────
export function FollowUpRow({ f, onOpen }) {
  const next = f.next
  const tone = next ? dueTone(next) : null
  return (
    <li
      onClick={() => onOpen(f.id)}
      className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow"
    >
      <div className="flex flex-wrap items-center gap-2">
        {f.overdueCount > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
            {f.overdueCount} overdue
          </span>
        )}
        <span className="font-semibold text-slate-800">{f.title}</span>
        {f.orderNo && <span className="text-xs text-slate-400">#{f.orderNo}</span>}
        {serialText(f.machineSerial) && <span className="text-xs text-slate-400" title="Machine serial">Serial {serialText(f.machineSerial)}</span>}
        {f.status !== 'ACTIVE' && <Badge tone="slate">{STATUS_LABEL[f.status]}</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-[11px] text-slate-400">
        {f.customer?.name && <span>🏭 {f.customer.name}</span>}
        {f.owner?.name && <span>👤 {f.owner.name}</span>}
        <span>{f.doneCount}/{f.totalDated} milestones done</span>
        {f._count?.contacts > 0 && <span>{f._count.contacts} contacts</span>}
      </div>
      {next && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <span className="text-slate-400">Next</span>
          <span className="font-medium text-slate-700">{next.label || next.meta?.en || next.kind}</span>
          <span className="text-slate-400">{fmtDate(next.dueDate)}</span>
          <span className={tone.cls}>{tone.text}</span>
        </div>
      )}
    </li>
  )
}

// ── Milestone row ────────────────────────────────────────────────────────────
function MilestoneRow({ f, item, canManage, onChanged }) {
  const m = item.row
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const tone = m ? dueTone(m) : { cls: 'text-slate-300', text: '' }

  const save = async (data) => {
    setBusy(true)
    try { await followUpsAPI.saveMilestone(f.id, item.kind, data); await onChanged() }
    catch (e) { window.alert(e.response?.data?.error || 'Save failed') }
    finally { setBusy(false) }
  }

  const notify = async () => {
    setBusy(true)
    try {
      const { data } = await followUpsAPI.notifyMilestone(f.id, item.kind)
      window.alert(data.sent
        ? `Sent to ${data.to}${data.cc ? `, cc ${data.cc}` : ''}`
        : 'Not sent — SMTP is not configured on the server, or nobody is assigned to this milestone')
    } catch (e) { window.alert(e.response?.data?.error || 'Send failed') }
    finally { setBusy(false) }
  }

  return (
    <li className={`rounded-xl border px-3 py-2 ${m?.doneAt ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(m?.doneAt)}
          disabled={!canManage || !m?.dueDate || busy}
          onChange={(e) => save({ done: e.target.checked })}
          title={item.kind === 'PAYMENT_DOWN'
            ? (m?.doneAt ? 'Down payment confirmed' : 'Confirm when the down payment has actually arrived. The date alone is only the contract’s expectation.')
            : (m?.dueDate ? 'Ticking it off stops the reminders' : 'Set a date first')}
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 disabled:opacity-40"
        />
        <span className={`text-sm ${m?.doneAt ? 'text-slate-400 line-through' : 'font-medium text-slate-700'}`}>
          {m?.label || item.en}
        </span>
        <span className="text-[11px] text-slate-300">{item.zh}</span>
        <span className="flex-1" />
        {/* Wrapped rather than sized directly: the shared Input carries
            `w-full`, which wins over a width passed in className — Tailwind
            resolves those two by stylesheet order, not by attribute order. */}
        <div className="w-[9.5rem] shrink-0">
          <Input
            type="date"
            value={fmtDate(m?.dueDate)}
            disabled={!canManage || busy}
            onChange={(e) => save({ dueDate: e.target.value || null })}
            className="py-1 text-xs"
          />
        </div>
        <span title={tone.title} className={`w-16 shrink-0 text-right text-[11px] ${tone.cls}`}>{tone.text}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-[11px] font-semibold text-slate-400 transition hover:text-brand-600"
        >
          {open ? 'Less' : 'More'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          <Input
            placeholder="Note — goes into the reminder email"
            defaultValue={m?.notes || ''}
            disabled={!canManage}
            onBlur={(e) => (e.target.value !== (m?.notes || '')) && save({ notes: e.target.value })}
            className="py-1 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>Remind</span>
            <span className="inline-block w-28">
              <Input
                defaultValue={(m?.remindDaysBefore ?? item.lead).join(', ')}
                disabled={!canManage}
                onBlur={(e) => {
                  const days = e.target.value.split(/[,，\s]+/).map(Number).filter((n) => n > 0)
                  save({ remindDaysBefore: days })
                }}
                className="py-1 text-xs"
              />
            </span>
            <span>days before, then every 3 days once overdue</span>
            <span className="flex-1" />
            {canManage && m?.dueDate && !m?.doneAt && (
              <button onClick={notify} disabled={busy}
                className="rounded-lg border border-brand-200 px-2 py-1 font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50">
                ✉ Send now
              </button>
            )}
            {canManage && m && (
              <button
                onClick={async () => {
                  if (!window.confirm('Clear this milestone\u2019s date and note?')) return
                  await followUpsAPI.clearMilestone(f.id, item.kind); await onChanged()
                }}
                className="font-semibold text-slate-400 transition hover:text-rose-500">Clear</button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

// ── Contacts ─────────────────────────────────────────────────────────────────
function ContactCard({ f, c, canManage, onChanged }) {
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState(c)
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))

  if (edit) {
    return (
      <li className="rounded-xl border border-brand-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={form.name || ''} onChange={set('name')} placeholder="Name *" className="py-1 text-xs" />
          <Input value={form.role || ''} onChange={set('role')} placeholder="Role (purchasing / issuing bank / forwarder…)" list="fu-roles" className="py-1 text-xs" />
          <Input value={form.company || ''} onChange={set('company')} placeholder="Company" className="py-1 text-xs" />
          <Input value={form.title || ''} onChange={set('title')} placeholder="Title" className="py-1 text-xs" />
          <Input value={form.phone || ''} onChange={set('phone')} placeholder="Phone" className="py-1 text-xs" />
          <Input value={form.email || ''} onChange={set('email')} placeholder="Email" className="py-1 text-xs" />
          <Input value={form.wechat || ''} onChange={set('wechat')} placeholder="WeChat" className="py-1 text-xs" />
          <Input value={form.notes || ''} onChange={set('notes')} placeholder="Note" className="py-1 text-xs" />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setForm(c); setEdit(false) }}>Cancel</Button>
          <Button size="sm" onClick={async () => {
            if (!form.name?.trim()) return window.alert('Name is required')
            await followUpsAPI.updateContact(f.id, c.id, form); setEdit(false); await onChanged()
          }}>Save</Button>
        </div>
      </li>
    )
  }
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800">{c.name}</span>
        {c.role && <Badge tone="brand">{c.role}</Badge>}
        {c.title && <span className="text-[11px] text-slate-400">{c.title}</span>}
        <span className="flex-1" />
        {canManage && (
          <>
            <button onClick={() => setEdit(true)} className="text-[11px] font-semibold text-slate-400 hover:text-brand-600">Edit</button>
            <button
              onClick={async () => {
                if (!window.confirm(`Delete contact ${c.name}?`)) return
                await followUpsAPI.deleteContact(f.id, c.id); await onChanged()
              }}
              className="text-[11px] font-semibold text-slate-400 hover:text-rose-500">Delete</button>
          </>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-[11px] text-slate-500">
        {c.company && <span>{c.company}</span>}
        {/* Tel/mailto rather than plain text: on a phone this is the whole
            reason to open the record. */}
        {c.phone && <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="text-brand-600 hover:underline">📞 {c.phone}</a>}
        {c.email && <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="text-brand-600 hover:underline">✉ {c.email}</a>}
        {c.wechat && <span>💬 {c.wechat}</span>}
        {c.notes && <span className="text-slate-400">{c.notes}</span>}
      </div>
    </li>
  )
}

// Reads the machine model, contract value and contract number out of the
// selected files, and applies them to fields the person has not filled in.
//
// Two rules make this safe to run automatically. It only ever writes into an
// EMPTY field — a value someone typed is a decision, and a document is not
// allowed to overturn it silently; where the field is already filled the
// suggestion is offered as a chip instead. And it is a suggestion either way:
// the model read the contract, the person signed it.
function useContractPrefill({ fileIds, token, team, values, onFill }) {
  const [state, setState] = useState({ busy: false, suggestions: {}, sources: [], ran: false })
  // What this hook last wrote into each field. A field still holding that exact
  // value is ours to replace; anything else the person typed, and a document
  // does not get to overturn it. Without this, switching to another customer
  // left the first customer's machine model in place — the rule "never
  // overwrite a filled field" cannot tell a typed value from one we filled a
  // moment ago.
  const mine = useRef({})
  const key = fileIds.slice().sort().join(',')

  useEffect(() => {
    if (!token || !fileIds.length) {
      // Clearing the selection clears what the selection put there, and only
      // that — a value someone typed over the top of it survives.
      const clear = {}
      for (const [field, v] of Object.entries(mine.current)) {
        if (String(values[field] ?? '').trim() === v) clear[field] = ''
      }
      mine.current = {}
      if (Object.keys(clear).length) onFill(clear)
      setState({ busy: false, suggestions: {}, sources: [], ran: false })
      return
    }
    let ignore = false
    setState((s) => ({ ...s, busy: true }))
    followUpsAPI.prefill(fileIds, team, token)
      .then(({ data }) => {
        if (ignore) return
        setState({ busy: false, suggestions: data.suggestions || {}, sources: data.sources || [], ran: true })
        const fill = {}
        for (const [field, s] of Object.entries(data.suggestions || {})) {
          const current = String(values[field] ?? '').trim()
          if (!current || current === mine.current[field]) {
            fill[field] = s.value
            mine.current[field] = s.value
          }
        }
        if (Object.keys(fill).length) onFill(fill)
      })
      .catch(() => { if (!ignore) setState({ busy: false, suggestions: {}, sources: [], ran: true }) })
    return () => { ignore = true }
    // Keyed on the selection alone: re-running because someone typed in the
    // machine field would spend GPU to answer a question already answered.
  }, [key, token, team]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

// One line under the form telling the reader where the values came from, and
// offering the ones that could not be applied because the field was taken.
function PrefillNote({ state, values, onUse }) {
  if (state.busy) return <p className="text-[11px] text-brand-600">Reading machine model and value from the contracts… (about a minute for a file nobody has read yet)</p>
  if (!state.ran) return null
  const offline = state.sources.some((s) => s.reason === 'dgx-offline')
  const unread = state.sources.filter((s) => s.reason === 'not-read')
  const conflicts = Object.entries(state.suggestions)
    .filter(([f, s]) => String(values[f] ?? '').trim() && values[f] !== s.value)
  const applied = Object.keys(state.suggestions).length - conflicts.length

  return (
    <div className="space-y-1 text-[11px]">
      {applied > 0 && <p className="text-emerald-600">✓ Filled {applied} field(s) from the contracts — change anything that looks wrong.</p>}
      {conflicts.map(([field, s]) => (
        <p key={field} className="text-slate-500">
          The contract says {field === 'machineType' ? 'machine' : field === 'contractValue' ? 'value' : 'contract no.'}
          <span className="mx-1 font-semibold text-slate-700">{s.value}</span>
          <button type="button" onClick={() => onUse(field, s.value)} className="font-semibold text-brand-600 hover:underline">use it</button>
        </p>
      ))}
      {offline && <p className="text-amber-600">DGX is offline, so contracts nobody has read yet cannot be read now — fill these in by hand; it does not block anything.</p>}
      {!offline && unread.length > 0 && (
        <p className="text-slate-400">{unread.length} file(s) are still being transcribed and cannot be read yet.</p>
      )}
      {state.ran && !applied && !conflicts.length && !offline && !unread.length && (
        <p className="text-slate-400">Nothing readable in the contracts for these fields — fill them in by hand.</p>
      )}
    </div>
  )
}

// Proposed milestones from the linked contracts. Nothing is written until Apply
// (on a record) or until the create dialog is submitted with the box checked.
// Rows that already have a date are shown struck as "kept" and the server
// skips them unless Replace is checked.
function TimelineSuggest({ token, fileIds, followUpId, catalogue, existing, onPlan, onApplied, onLock }) {
  const [busy, setBusy] = useState(false)
  const [proposals, setProposals] = useState(null)
  const [sources, setSources] = useState([])
  const [baseDate, setBaseDate] = useState(null)
  const [delivery, setDelivery] = useState(null)
  const [error, setError] = useState('')
  const [replace, setReplace] = useState(false)
  const [include, setInclude] = useState(true)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null)
  const meta = useMemo(() => new Map((catalogue || []).map((c) => [c.kind, c])), [catalogue])
  const key = (fileIds || []).slice().sort((a, b) => a - b).join(',')
  const ready = Boolean(token) && (fileIds || []).length > 0

  useEffect(() => {
    setProposals(null)
    setSources([])
    setBaseDate(null)
    setDelivery(null)
    setResult(null)
    setError('')
    onPlan?.([])
  }, [key, followUpId]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (deliveryStart) => {
    if (!ready) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const { data } = followUpId
        ? await followUpsAPI.suggestRecordTimeline(followUpId, token, deliveryStart)
        : await followUpsAPI.suggestTimeline(fileIds, token, deliveryStart)
      const list = data.proposals || []
      setProposals(list)
      setSources(data.sources || [])
      setBaseDate(data.baseDate || null)
      setDelivery(data.deliveryStart || null)
      onPlan?.(include ? list : [])
      if (deliveryStart && followUpId) await onApplied?.()
    } catch (e) {
      if (e.response?.status === 401) onLock?.()
      setError(e.response?.status === 401
        ? 'The contract session expired — enter the PIN again.'
        : 'Could not read a timeline from the contracts.')
      setProposals(null)
      onPlan?.([])
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setApplying(true)
    setError('')
    try {
      const { data } = await followUpsAPI.applyTimeline(followUpId, proposals || [], replace)
      setResult(data)
      await onApplied?.()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not apply the timeline')
    } finally {
      setApplying(false)
    }
  }

  const offline = sources.some((s) => s.reason === 'dgx-offline')
  const unread = sources.filter((s) => s.reason === 'not-read')
  const byExisting = new Map((existing || []).map((m) => [m.kind, m]))

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button size="sm" variant="secondary" disabled={!ready || busy} onClick={() => load()}>
          {busy ? 'Reading the contracts…' : 'Fill timeline from contract'}
        </Button>
        <p className="text-[11px] text-slate-500">
          {busy
            ? 'A contract nobody has summarised yet takes about a minute.'
            : 'Suggests letter-of-credit, payment and delivery dates. Nothing is written until you apply.'}
        </p>
      </div>
      {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
      {proposals && (
        <div className="mt-3">
          {baseDate && (
            <p className="mt-2 text-[11px] text-slate-500">Signed date {baseDate}.</p>
          )}
          {delivery?.rule === 'SIGNED' && (
            <p className="mt-1 text-[11px] text-slate-600">
              This contract counts delivery from the signing date.
              {delivery.source === 'manual' ? ' Using the basis you chose.' : ''}
            </p>
          )}
          {delivery?.rule === 'PAYMENT_DOWN' && (
            <p className="mt-1 text-[11px] text-slate-600">
              This contract counts delivery from receipt of the down payment. Later dates move when you confirm that receipt.
              {delivery.source === 'manual' ? ' Using the basis you chose.' : ''}
            </p>
          )}
          {delivery?.ambiguous && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-900">
                This contract does not say whether delivery time starts at signing or when the down payment arrives.
                Choose a basis to calculate those dates. Until then they stay blank for you to type.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => load('SIGNED')}>From signing</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => load('PAYMENT_DOWN')}>From down payment</Button>
              </div>
            </div>
          )}
          {delivery?.rule && delivery.source === 'manual' && !delivery.ambiguous && (
            <div className="mt-1">
              <button type="button" disabled={busy} onClick={() => load(delivery.rule === 'SIGNED' ? 'PAYMENT_DOWN' : 'SIGNED')}
                className="text-[11px] font-semibold text-slate-400 hover:text-brand-600">
                Count delivery from {delivery.rule === 'SIGNED' ? 'the down payment' : 'signing'} instead
              </button>
            </div>
          )}
          {proposals.length === 0 ? (
            <p className="mt-1 text-[11px] text-slate-500">
              {offline
                ? 'DGX is offline, and the saved summary did not contain dates. Fill the timeline by hand.'
                : 'No dates in these contracts could be turned into milestones. Fill the timeline by hand.'}
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {proposals.map((p) => {
                const item = meta.get(p.kind)
                const row = byExisting.get(p.kind)
                const filled = Boolean(row && (row.dueDate || row.doneAt))
                const skip = Boolean(followUpId) && filled && !replace
                return (
                  <li key={p.kind} className={`rounded-xl border px-3 py-2 ${skip ? 'border-slate-100 bg-white/60' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                      <span className={`text-sm font-medium ${skip ? 'text-slate-400' : 'text-slate-800'}`}>{item?.en || p.kind}</span>
                      {item?.zh && <span className="text-[11px] text-slate-300">{item.zh}</span>}
                      {p.docType && <Badge tone={docTypeMeta(p.docType).tone}>{docTypeMeta(p.docType).short}</Badge>}
                      <span className={`text-xs font-semibold tabular-nums sm:ml-auto ${p.dueDate ? 'text-slate-700' : 'text-slate-400'}`}>
                        {p.dueDate || 'No date'}
                      </span>
                      {p.done && <span className="text-[10px] font-semibold text-emerald-600">Will mark done</span>}
                      {p.confirmReceipt && (
                        <span className="text-[10px] font-semibold text-amber-700">Theoretical — confirm receipt</span>
                      )}
                      {p.needsStart && (
                        <span className="text-[10px] font-semibold text-amber-700">Needs a delivery basis</span>
                      )}
                      {skip && <span className="text-[10px] font-semibold text-slate-400">Kept — already filled</span>}
                    </div>
                    {p.notes && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{p.notes}</p>}
                  </li>
                )
              })}
            </ul>
          )}
          {proposals.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {followUpId ? (
                <>
                  <label className="flex items-center gap-2 text-[11px] text-slate-600">
                    <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
                    Replace dates already filled
                  </label>
                  <Button size="sm" disabled={applying} onClick={apply}>
                    {applying ? 'Applying…' : replace ? 'Replace timeline' : 'Apply to empty milestones'}
                  </Button>
                </>
              ) : (
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input type="checkbox" checked={include}
                    onChange={(e) => {
                      setInclude(e.target.checked)
                      onPlan?.(e.target.checked ? proposals : [])
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
                  Apply these dates when creating
                </label>
              )}
            </div>
          )}
          {offline && proposals.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">DGX is offline. These dates come from the saved summary only.</p>
          )}
          {!offline && unread.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">{unread.length} file(s) are still being transcribed.</p>
          )}
          {result && (
            <p className="mt-2 text-[11px] text-emerald-700">
              Applied {result.applied?.length || 0}.
              {result.skipped?.length > 0 ? ` Skipped ${result.skipped.length} that already had a date.` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Commercial contracts (and a technical agreement filed with them) that no
// live follow-up is tracking. A matching FAC, or a commercial marked closed
// on the Contracts page, is execution finished and stays off this list.
// The names stay behind the team PIN. The status tabs below are a different
// list: they filter ProjectFollowUp rows that already exist.
//
// Fetched when this section mounts (every visit to the list), and again when
// the user comes back to the tab or a contract is marked closed / reopened.
// The unlock token does not change for those, so it cannot be the only trigger.
function OpenOrders({ onCreate }) {
  const { user } = useAuth()
  const { unlock, team, setTeam, doUnlock, busy, error: pinError, configured, lock } = useContractUnlock(
    user?.team === 'WRC' ? 'WRC' : 'HRC',
  )
  const [pin, setPin] = useState('')
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const token = unlock?.token || null

  useEffect(() => {
    if (!token) { setOrders(null); return undefined }
    let ignore = false
    let seen = false
    let req = 0
    let timer = 0
    setError('')

    const load = () => {
      const mine = ++req
      followUpsAPI.openOrders(token)
        .then(({ data }) => {
          if (ignore || mine !== req) return
          seen = true
          setError('')
          setOrders(data.orders || [])
        })
        .catch((e) => {
          if (ignore || mine !== req) return
          if (e.response?.status === 401) { lock(); setError(''); return }
          // A refresh that fails leaves the list already on screen. Wiping it
          // would hide every candidate because one request blipped.
          if (seen) return
          setError('Could not list contracts without a follow-up.')
          setOrders(null)
        })
    }

    // Focus and visibility often arrive together when the tab is shown again.
    const schedule = () => {
      if (ignore) return
      clearTimeout(timer)
      timer = setTimeout(() => { if (!ignore) load() }, 50)
    }

    load()
    const unwatch = watchOpenOrdersRefresh((reason) => {
      if (ignore) return
      if (reason === 'invalidate' || reason === 'storage') load()
      else schedule()
    })
    return () => {
      ignore = true
      clearTimeout(timer)
      unwatch()
    }
  }, [token, lock])

  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-bold text-slate-800">Contracts without a follow-up</h2>
        {orders && <span className="text-[11px] font-semibold text-amber-700">{orders.length}</span>}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Commercial contracts still in execution that are not linked to a live or completed follow-up.
        A matching FAC, or a contract marked closed on Contracts, stays off this list.
      </p>

      {!unlock ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-block w-24">
            <Select value={team} onChange={(e) => setTeam(e.target.value)} className="bg-white py-1 text-xs">
              {['WRC', 'HRC'].map((t) => (
                <option key={t} value={t} disabled={Array.isArray(configured) && !configured.includes(t)}>{t}</option>
              ))}
            </Select>
          </span>
          <span className="inline-block w-32">
            <Input type="password" value={pin} placeholder="Team PIN" className="bg-white py-1 text-xs"
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doUnlock(pin) } }} />
          </span>
          <Button size="sm" variant="secondary" disabled={busy || !pin.trim()} onClick={() => doUnlock(pin)}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
          {pinError && <span className="text-[11px] text-rose-600">{pinError}</span>}
        </div>
      ) : error ? (
        <p className="mt-3 text-[11px] text-rose-600">{error}</p>
      ) : orders === null ? (
        <p className="mt-3 text-[11px] text-slate-400">Looking through {unlock.team} contracts…</p>
      ) : orders.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-500">Every readable {unlock.team} commercial contract is already followed up or finished.</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {orders.map((order) => (
            <li key={order.fileIds.join('-')} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">{order.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    {order.customerName && <span>{order.customerName}</span>}
                    {order.orderNo && <span>#{order.orderNo}</span>}
                    {order.komNo && order.komNo !== order.orderNo && <span>Kom. {order.komNo}</span>}
                    {order.signedDate && <span>Signed {order.signedDate}</span>}
                    <span className="rounded border border-slate-200 px-1 py-px text-[10px] font-semibold text-slate-500">{order.team}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {order.files.map((f) => (
                      <span key={f.id} className="inline-flex max-w-full items-center gap-1">
                        <Badge tone={docTypeMeta(f.docType).tone}>{docTypeMeta(f.docType).short}</Badge>
                        <span className="max-w-[14rem] truncate text-[10px] text-slate-500" title={f.filename}>{displayFilename(f.filename)}</span>
                      </span>
                    ))}
                  </div>
                  {order.files.some((f) => !f.summarised) && (
                    <p className="mt-1 text-[10px] text-slate-400">Not summarised yet — creating the follow-up will read it.</p>
                  )}
                  {order.alsoOpen?.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      This customer already has a live follow-up ({order.alsoOpen.map((f) => f.title).join(', ')}). Create another only if this contract is a different order.
                    </p>
                  )}
                </div>
                <Button size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => onCreate(order)}>
                  Create follow-up
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Contract picker ──────────────────────────────────────────────────────────
// Contract files live behind the contracts module's team PIN. This is a link
// into that module, not a second way in: the same unlock, the same team scope,
// the same server-side check. Locked, it shows a PIN prompt rather than a list
// of filenames — the names are part of what the PIN withholds.
function ContractPicker({ customerId, selected, onChange, note }) {
  const { user } = useAuth()
  const { unlock, team, setTeam, doUnlock, busy, error, configured, lock } = useContractUnlock(
    user?.team === 'WRC' ? 'WRC' : 'HRC',
  )
  const [pin, setPin] = useState('')
  const [files, setFiles] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!unlock || !customerId) { setFiles(null); return }
    let ignore = false
    setLoadError('')
    contractsAPI.list(customerId, unlock.token)
      .then((r) => { if (!ignore) setFiles(r.data || []) })
      .catch((err) => {
        if (ignore) return
        // An unlock lasts 45 minutes on the server but its token sits in
        // sessionStorage until the tab closes, so a stale one leaves the picker
        // looking open while every request 401s. Swallowing that used to render
        // as "this customer has no contracts", which is a different statement
        // and a false one — the files were there the whole time.
        if (err.response?.status === 401) { lock(); setLoadError('') }
        else setLoadError('Could not read the contract list. Try again.')
        setFiles(null)
      })
    return () => { ignore = true }
  }, [unlock, customerId, lock, retry])

  if (!customerId) {
    return <p className="text-[11px] text-slate-400">Link a customer first, then their contracts can be picked.</p>
  }

  if (!unlock) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] text-slate-500">Contract files sit behind a team PIN. Enter it to pick this customer’s commercial contract and technical agreement.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-block w-24">
            <Select value={team} onChange={(e) => setTeam(e.target.value)} className="py-1 text-xs">
              {['WRC', 'HRC'].map((t) => (
                <option key={t} value={t} disabled={Array.isArray(configured) && !configured.includes(t)}>{t}</option>
              ))}
            </Select>
          </span>
          <span className="inline-block w-32">
            <Input type="password" value={pin} placeholder="Team PIN" className="py-1 text-xs"
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doUnlock(pin) } }} />
          </span>
          <Button size="sm" variant="secondary" disabled={busy || !pin.trim()} onClick={() => doUnlock(pin)}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
          {error && <span className="text-[11px] text-rose-600">{error}</span>}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <p className="text-[11px] text-rose-600">
        {loadError}{' '}
        <button type="button" onClick={() => { setLoadError(''); setRetry((n) => n + 1) }} className="font-semibold underline">retry</button>
      </p>
    )
  }
  if (files === null) return <p className="text-[11px] text-slate-400">Loading contracts…</p>

  const shown = showAll ? files : files.filter((f) => CONTRACT_PRIMARY.includes(f.docType))
  const hiddenCount = files.length - shown.length

  return (
    <div>
      {shown.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          {files.length === 0
            ? `No contract files for this customer under ${unlock.team}.`
            : 'No commercial contract or technical agreement for this customer.'}
        </p>
      ) : (
        <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
          {shown.map((f) => {
            const on = selected.includes(f.id)
            return (
              <li key={f.id}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(on ? selected.filter((x) => x !== f.id) : [...selected, f.id])}
                    className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-600"
                  />
                  <Badge tone={docTypeMeta(f.docType).tone}>{docTypeMeta(f.docType).short}</Badge>
                  {/* Filename then note, stacked: one customer with two orders
                      running has near-identical filenames, and the note is the
                      line that tells them apart. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-slate-700" title={f.filename}>
                      {displayFilename(f.filename)}
                    </span>
                    {f.note && (
                      <span className="block truncate text-[10px] text-slate-500" title={f.note}>{f.note}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{fmtKB(f.size)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
        <span>{unlock.team} · {selected.length} selected</span>
        {(hiddenCount > 0 || showAll) && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="font-semibold text-brand-600 hover:underline">
            {showAll ? 'Contracts & agreements only' : `Show all types (+${hiddenCount})`}
          </button>
        )}
        <span className="flex-1" />
        {note}
      </div>
    </div>
  )
}

// The price is drawn only when this view is unlocked and the payload says so.
// A locked record can still say the number exists; the button asks for the
// same team PIN the contract files use. A stale `contractValue` left on the
// object is not rendered — the flags decide, not the presence of a string.
export function ContractValueLabel({ followUp, unlocked = false, onRequestUnlock }) {
  if (!followUp) return null
  if (followUp.contractValueHidden) {
    return (
      <span className="text-slate-400" title={`Visible to ${followUp.team} and admins, after that team's PIN`}>
        🔒 Contract value restricted
      </span>
    )
  }
  const amount = String(followUp.contractValue ?? '').trim()
  if (unlocked && followUp.contractValueLocked !== true && amount) {
    return <span>💰 {amount}</span>
  }
  if (followUp.hasContractValue || amount) {
    return (
      <button
        type="button"
        onClick={onRequestUnlock}
        className="font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-brand-600"
      >
        🔒 Enter {followUp.team} PIN to view
      </button>
    )
  }
  return null
}

// A locked or restricted price is not an empty field. Treating it as empty
// would offer to overwrite a number the form is not allowed to show.
export function missingContractFields(f) {
  const missing = []
  if (!String(f.machineType ?? '').trim()) missing.push('machineType')
  const heldBack = f.contractValueHidden || (f.contractValueLocked && f.hasContractValue)
  if (!heldBack && !String(f.contractValue ?? '').trim()) missing.push('contractValue')
  if (!String(f.orderNo ?? '').trim()) missing.push('orderNo')
  return missing
}

// ── Linked contracts on the detail page ──────────────────────────────────────
// Locked, this says how many are attached and nothing else: the count is
// ordinary project data, the filenames are not.
function LinkedContracts({ f, catalogue, onChanged, onPatch }) {
  const { user } = useAuth()
  const { unlock, team, setTeam, doUnlock, busy, error, configured, lock } = useContractUnlock(
    f.team === 'WRC' || f.team === 'HRC' ? f.team : (user?.team === 'WRC' ? 'WRC' : 'HRC'),
  )
  const [pin, setPin] = useState('')
  const [files, setFiles] = useState(null)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState([])
  const [filling, setFilling] = useState(false)
  const count = f._count?.contractFiles ?? 0
  // Only offered while something is still missing — a button that overwrites
  // what a colleague typed is not a convenience. A price the PIN is still
  // holding is not missing.
  const missing = missingContractFields(f)

  // The same read the create dialog does, run after the fact: contracts are
  // often attached once the order is already on file.
  const fillFromContracts = async () => {
    setFilling(true)
    try {
      const { data } = await followUpsAPI.prefill((files || []).map((x) => x.id), f.team, unlock.token)
      const patch = {}
      for (const k of missing) if (data.suggestions?.[k]?.value) patch[k] = data.suggestions[k].value
      if (!Object.keys(patch).length) {
        const offline = (data.sources || []).some((x) => x.reason === 'dgx-offline')
        window.alert(offline ? 'DGX is offline, so contracts nobody has read yet cannot be read now.' : 'Nothing readable in the contracts for machine / value / contract no.')
      } else {
        await onPatch(patch)
      }
    } catch { window.alert('Read failed') }
    finally { setFilling(false) }
  }

  const load = useCallback(async () => {
    if (!unlock) return
    try {
      const { data } = await followUpsAPI.contracts(f.id, unlock.token)
      setFiles(data)
      setPicked(data.map((x) => x.id))
    } catch (err) {
      // Same rule as the picker: a stale unlock is not "no contracts". Drop the
      // expired token so the PIN prompt comes back instead of an empty list.
      if (err.response?.status === 401) lock()
      setFiles(null)
    }
  }, [unlock, f.id, lock])
  useEffect(() => { load() }, [load])

  const download = async (file) => {
    try {
      const res = await contractsAPI.download(file.id, unlock.token)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = file.filename; a.click()
      URL.revokeObjectURL(url)
    } catch { window.alert('Download failed') }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">
          Contract basis <span className="text-slate-300">{count}</span>
        </h3>
        {unlock && f.canManage && (
          <div className="flex gap-2">
            {!editing && missing.length > 0 && (files?.length ?? 0) > 0 && (
              <Button size="sm" variant="secondary" disabled={filling} onClick={fillFromContracts}>
                {filling ? 'Reading…' : 'Fill from contracts'}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done' : 'Pick contracts'}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">Every date on the timeline is agreed in these documents — where they disagree, the contract wins.</p>

      {!unlock ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">
            {count > 0 ? `${count} contract file(s) linked.` : 'No contracts linked yet.'}
            {' '}The files sit behind a team PIN — enter it to view or change them.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-block w-24">
              <Select value={team} onChange={(e) => setTeam(e.target.value)} className="py-1 text-xs">
                {['WRC', 'HRC'].map((t) => (
                  <option key={t} value={t} disabled={Array.isArray(configured) && !configured.includes(t)}>{t}</option>
                ))}
              </Select>
            </span>
            <span className="inline-block w-32">
              <Input id="followup-contract-pin" type="password" value={pin} placeholder="Team PIN" className="py-1 text-xs"
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doUnlock(pin) } }} />
            </span>
            <Button size="sm" variant="secondary" disabled={busy || !pin.trim()} onClick={() => doUnlock(pin)}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </Button>
            {error && <span className="text-[11px] text-rose-600">{error}</span>}
          </div>
        </div>
      ) : editing ? (
        <div className="mt-3">
          <ContractPicker
            customerId={f.customerId}
            selected={picked}
            onChange={setPicked}
            note={(
              <button
                onClick={async () => {
                  await followUpsAPI.linkContracts(f.id, picked, unlock.token)
                  setEditing(false); await load(); await onChanged()
                }}
                className="font-semibold text-brand-600 hover:underline">Save selection</button>
            )}
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {(files || []).map((x) => (
            <li key={x.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <Badge tone={docTypeMeta(x.docType).tone}>{docTypeMeta(x.docType).short}</Badge>
              <button onClick={() => download(x)} title={x.filename}
                className="min-w-0 flex-1 text-left transition hover:text-brand-600">
                <span className="block truncate text-xs font-medium text-slate-700">{displayFilename(x.filename)}</span>
                {x.note && <span className="block truncate text-[10px] text-slate-500" title={x.note}>{x.note}</span>}
              </button>
              <span className="shrink-0 text-[10px] text-slate-400">{fmtKB(x.size)}</span>
            </li>
          ))}
          {files && files.length === 0 && (
            <li className="py-3 text-center text-xs text-slate-400">
              No contracts linked{f.canManage ? ' — use “Pick contracts” to attach them' : ''}.
            </li>
          )}
        </ul>
      )}
      {unlock && !editing && f.canManage && (files?.length ?? 0) > 0 && (
        <TimelineSuggest
          token={unlock.token}
          fileIds={(files || []).map((x) => x.id)}
          followUpId={f.id}
          catalogue={catalogue}
          existing={f.milestones}
          onApplied={onChanged}
          onLock={lock}
        />
      )}
    </div>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────
function Detail({ id, catalogue, users, onBack, onChanged }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { unlock, setTeam, switchTeam } = useContractUnlock(user?.team === 'WRC' ? 'WRC' : 'HRC')
  const [f, setF] = useState(null)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', role: '', company: '', phone: '', email: '' })
  const reqSeq = useRef(0)
  const alignedTeam = useRef(false)

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    const { data } = await followUpsAPI.get(id, unlock?.token || null)
    if (seq !== reqSeq.current) return
    setF(data)
  }, [id, unlock?.token])
  useEffect(() => { load() }, [load])
  useEffect(() => { setF(null) }, [id])

  // Drop the figure the moment the unlock no longer covers this order, so a
  // lock does not leave the price in state while the refetch is in flight.
  // The label also refuses to draw it; this keeps every other reader honest.
  useLayoutEffect(() => {
    setF((current) => {
      if (!current || current.contractValueHidden) return current
      const open = Boolean(unlock?.token) && unlock.team === current.team
      if (open) return current
      if (current.contractValueLocked && !current.contractValue) return current
      const hasContractValue = Boolean(String(current.contractValue ?? '').trim() || current.hasContractValue)
      return { ...current, contractValue: null, contractValueLocked: true, hasContractValue }
    })
  }, [unlock?.token, unlock?.team])

  // The PIN prompt defaults to whoever is logged in. The price on this record
  // opens with this record's team, so point the prompt there once, while
  // nothing is unlocked yet.
  useEffect(() => {
    if (alignedTeam.current || !f?.team || unlock) return
    if (f.team !== 'WRC' && f.team !== 'HRC') return
    alignedTeam.current = true
    setTeam(f.team)
  }, [f?.team, unlock, setTeam])

  const refresh = async () => { await load(); onChanged?.() }

  const revealValue = async () => {
    if (!f?.team) return
    const focusPin = () => {
      const el = document.getElementById('followup-contract-pin')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus()
    }
    if (!unlock) {
      setTeam(f.team)
      focusPin()
      return
    }
    if (unlock.team === f.team) return
    const ok = await switchTeam(f.team)
    if (!ok) setTimeout(focusPin, 60)
  }

  if (!f) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  const canManage = f.canManage
  const byKind = new Map(f.milestones.map((m) => [m.kind, m]))

  const patch = async (data) => {
    try { await followUpsAPI.update(f.id, data, unlock?.token || null); await refresh() }
    catch (e) { window.alert(e.response?.data?.error || 'Save failed') }
  }

  // The customer's standing contact list is the obvious starting point, but it
  // is a different list — copied in, not linked, because a project contact
  // moves on while the customer record stays.
  const importFromCustomer = async () => {
    const raw = Array.isArray(f.customer?.contacts) ? f.customer.contacts : []
    const seed = raw.length ? raw : (f.customer?.contactName
      ? [{ name: f.customer.contactName, phone: f.customer.contactPhone, email: f.customer.email }]
      : [])
    if (!seed.length) return window.alert('This customer record has no contacts')
    const have = new Set(f.contacts.map((c) => c.name))
    const fresh = seed.filter((c) => c.name && !have.has(c.name))
    if (!fresh.length) return window.alert('Every contact on the customer record is already here')
    for (const c of fresh) {
      await followUpsAPI.addContact(f.id, {
        name: c.name, title: c.title || null, phone: c.phone || null,
        email: c.email || null, company: f.customer?.name || null,
      })
    }
    await refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <button onClick={onBack} className="text-xs font-semibold text-slate-400 transition hover:text-brand-600">← Back to list</button>
      </div>

      {/* Head */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">{f.title}</h2>
          {f.orderNo && <span className="text-sm text-slate-400">#{f.orderNo}</span>}
          <span className="flex-1" />
          <div className="w-40 shrink-0">
            <Select
              value={f.status}
              disabled={!canManage}
              onChange={(e) => patch({ status: e.target.value })}
              className="py-1 text-xs"
            >
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {f.customer && (
            <button onClick={() => navigate(`/customers/${f.customer.id}`)} className="font-medium text-brand-600 hover:underline">
              🏭 {f.customer.name} ↗
            </button>
          )}
          {f.hotProject && (
            <button onClick={() => navigate('/hotprojects')} className="text-brand-600 hover:underline">🔥 From Hot Projects ↗</button>
          )}
          {/* Restricted, locked and empty are three different facts. The
              amount is drawn only from an unlocked payload. */}
          <FollowUpFactLine
            f={f}
            unlocked={Boolean(unlock?.token) && unlock.team === f.team}
            onRequestUnlock={revealValue}
          />
          <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{f.team}</span>
          <span className="flex items-center gap-1">
            👤 Owner
            <span className="inline-block w-36">
              <Select
                value={f.ownerId || ''}
                disabled={!canManage}
                onChange={(e) => patch({ ownerId: e.target.value || null })}
                className="py-0.5 text-xs"
              >
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </span>
          </span>
        </div>
        {f.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{f.notes}</p>}
      </div>

      {/* Contracts — placed above the timeline because it is where the
          timeline's dates come from, not an appendix to them. */}
      <LinkedContracts f={f} catalogue={catalogue} onChanged={refresh} onPatch={patch} />

      {/* Milestones */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">Milestones</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">
          A milestone only reminds once it has a date. Use “Fill timeline from contract”
          above to suggest them, or type a date here. Mail goes out on each of its lead days,
          then every 3 days once overdue, until it is ticked off — to the owner
          and blind copied to Rongbin Chen.
        </p>
        <div className="mt-3 space-y-4">
          {GROUPS.map((g) => {
            const items = catalogue.filter((c) => c.group === g.key)
            if (!items.length) return null
            return (
              <div key={g.key}>
                <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.label}</h4>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <MilestoneRow
                      key={item.kind}
                      f={f}
                      item={{ ...item, row: byKind.get(item.kind) }}
                      canManage={canManage}
                      onChanged={refresh}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* Contacts */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <datalist id="fu-roles">{CONTACT_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800">Contacts <span className="text-slate-300">{f.contacts.length}</span></h3>
          {canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={importFromCustomer}>Import from customer</Button>
              <Button size="sm" onClick={() => setAdding((v) => !v)}>＋ Add</Button>
            </div>
          )}
        </div>
        {adding && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={newContact.name} onChange={(e) => setNewContact((s) => ({ ...s, name: e.target.value }))} placeholder="Name *" className="py-1 text-xs" />
              <Input value={newContact.role} onChange={(e) => setNewContact((s) => ({ ...s, role: e.target.value }))} placeholder="Role (purchasing / issuing bank / forwarder…)" list="fu-roles" className="py-1 text-xs" />
              <Input value={newContact.company} onChange={(e) => setNewContact((s) => ({ ...s, company: e.target.value }))} placeholder="Company" className="py-1 text-xs" />
              <Input value={newContact.phone} onChange={(e) => setNewContact((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone" className="py-1 text-xs" />
              <Input value={newContact.email} onChange={(e) => setNewContact((s) => ({ ...s, email: e.target.value }))} placeholder="Email" className="py-1 text-xs" />
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={async () => {
                if (!newContact.name.trim()) return window.alert('Name is required')
                await followUpsAPI.addContact(f.id, newContact)
                setNewContact({ name: '', role: '', company: '', phone: '', email: '' })
                setAdding(false); await refresh()
              }}>Save</Button>
            </div>
          </div>
        )}
        <ul className="mt-3 space-y-2">
          {f.contacts.map((c) => <ContactCard key={c.id} f={f} c={c} canManage={canManage} onChanged={refresh} />)}
          {f.contacts.length === 0 && <li className="py-4 text-center text-xs text-slate-400">No contacts yet</li>}
        </ul>
      </div>

      {/* Log */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">Log</h3>
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note what happened…" />
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!note.trim()} onClick={async () => {
              await followUpsAPI.addUpdate(f.id, { content: note.trim() }); setNote(''); await refresh()
            }}>＋ Add</Button>
          </div>
        </div>
        <ol className="mt-3 space-y-2">
          {f.updates.map((u) => (
            <li key={u.id} className="border-l-2 border-slate-100 pl-3">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-semibold">{fmtDate(u.createdAt)}</span>
                {u.author?.name && <span>✍️ {u.author.name}</span>}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{u.content}</p>
            </li>
          ))}
          {f.updates.length === 0 && <li className="py-3 text-center text-xs text-slate-400">Nothing logged yet</li>}
        </ol>
      </div>
    </div>
  )
}

// ── New record modal ─────────────────────────────────────────────────────────
export function NewModal({ users, catalogue, seed, onClose, onCreated }) {
  const { user } = useAuth()
  // The team owns the record's contract value, so it is chosen up front rather
  // than inferred later. Defaults to the creator's own team; someone in neither
  // (team OTHER) starts on HRC and picks.
  const [form, setForm] = useState({
    title: seed?.title || '',
    orderNo: seed?.orderNo || '',
    customerId: seed?.customerId || '',
    customerName: seed?.customerName || '',
    machineType: seed?.machineType || '',
    machineSerial: '',
    contractValue: '',
    ownerId: '',
    notes: '',
    team: seed?.team || (['WRC', 'HRC'].includes(user?.team) ? user.team : 'HRC'),
  })
  const [customers, setCustomers] = useState([])
  const [contractIds, setContractIds] = useState(seed?.fileIds || [])
  const [timelinePlan, setTimelinePlan] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Re-read on every render rather than held in state: the picker writes the
  // unlock into sessionStorage, and this is the only thing that needs it here.
  const unlockToken = (() => {
    try { return JSON.parse(sessionStorage.getItem('contractUnlock') || 'null')?.token || null }
    catch { return null }
  })()
  const prefill = useContractPrefill({
    fileIds: contractIds,
    token: unlockToken,
    team: form.team,
    values: form,
    onFill: (fields) => setForm((s) => ({ ...s, ...fields })),
  })
  useEffect(() => { customersAPI.getAll().then((r) => setCustomers(r.data || [])).catch(() => {}) }, [])
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))
  const q = form.customerName.trim().toLowerCase()
  const matches = q && !form.customerId ? customers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10) : []

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">New follow-up</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs font-semibold text-slate-600">
            Project / order name *
            <Input value={form.title} onChange={set('title')} placeholder="e.g. Qingdao Haixi - 2 x CNC crankshaft lathes" className="mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Order / contract no.
              <Input value={form.orderNo} onChange={set('orderNo')} className="mt-1" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Owner
              <Select value={form.ownerId} onChange={set('ownerId')} className="mt-1">
                <option value="">Me</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Team
              <Select value={form.team} onChange={set('team')} className="mt-1">
                <option value="WRC">WRC</option>
                <option value="HRC">HRC</option>
              </Select>
              <span className="mt-0.5 block font-normal text-[10px] text-slate-400">
                Only this team and admins can read the contract value, and only after that team’s PIN.
              </span>
            </label>
          </div>
          <div className="text-xs font-semibold text-slate-600">
            Customer
            <div className="relative mt-1">
              <Input
                value={form.customerName}
                placeholder="Type to search and link a customer record"
                // Typing again unlinks the customer, so the files picked for the
                // old one go with it — they belong to a different customer and
                // the server would refuse them anyway.
                onChange={(e) => { setContractIds([]); setForm((s) => ({ ...s, customerName: e.target.value, customerId: '' })) }}
              />
              {matches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setContractIds([]); setForm((s) => ({ ...s, customerId: c.id, customerName: c.name })) }}
                        className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">{c.name}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {form.customerId && <span className="mt-1 block text-[10px] font-bold text-emerald-600">✓ Linked to customer record</span>}
          </div>
          {/* The timeline's dates are all agreed in these two documents, so the
              files get attached at creation — by the time someone is filling in
              a letter-of-credit date, the contract that states it should
              already be one click away. */}
          <div className="text-xs font-semibold text-slate-600">
            Contracts (commercial / technical — pick any)
            <div className="mt-1 font-normal">
              <ContractPicker
                customerId={form.customerId || null}
                selected={contractIds}
                onChange={setContractIds}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Machine model
              <Input value={form.machineType} onChange={set('machineType')} className="mt-1" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Machine serial
              <Input value={form.machineSerial} onChange={set('machineSerial')} placeholder="Optional" className="mt-1" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Contract value
              <Input value={form.contractValue} onChange={set('contractValue')} placeholder="e.g. EUR 4.2m" className="mt-1" />
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-600">
            Notes
            <Textarea rows={2} value={form.notes} onChange={set('notes')} className="mt-1" />
          </label>
          <PrefillNote
            state={prefill}
            values={form}
            onUse={(field, value) => setForm((s) => ({ ...s, [field]: value }))}
          />
          {contractIds.length > 0 && (
            <TimelineSuggest
              token={unlockToken}
              fileIds={contractIds}
              catalogue={catalogue}
              onPlan={setTimelinePlan}
            />
          )}
          {contractIds.length === 0 && (
            <p className="text-[11px] text-slate-400">Pick the commercial contract to suggest the execution dates. A date is what starts the reminders.</p>
          )}
          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={async () => {
            if (!form.title.trim()) { setErr('Project name is required'); return }
            setErr(''); setSaving(true)
            try {
              const { data } = await followUpsAPI.create({ ...form, customerId: form.customerId || null }, unlockToken)
              // Linking is a second call because the record has no id until the
              // first one returns. A failure here is not worth throwing the
              // created record away for — the detail page can link them.
              if (contractIds.length) {
                const u = JSON.parse(sessionStorage.getItem('contractUnlock') || 'null')
                if (u?.token) {
                  await followUpsAPI.linkContracts(data.id, contractIds, u.token)
                    .catch(() => window.alert('The record was created, but the contracts were not linked — attach them on the record itself.'))
                }
              }
              if (timelinePlan.length) {
                await followUpsAPI.applyTimeline(data.id, timelinePlan, false)
                  .catch(() => window.alert('The record was created, but the milestone dates were not applied — use “Fill timeline from contract” on the record.'))
              }
              onCreated(data.id)
            } catch (e) { setErr(e.response?.data?.error || 'Could not create'); setSaving(false) }
          }}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ProjectFollowUps() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { user } = useAuth()
  const [catalogue, setCatalogue] = useState([])
  const [users, setUsers] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [mine, setMine] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [seed, setSeed] = useState(null)
  // The create dialog and this list are on screen together, and each keeps its
  // own copy of the contract unlock. Bumping the key when the dialog closes
  // makes the list re-read the token the dialog just stored.
  const [ordersKey, setOrdersKey] = useState(0)
  const closeNew = () => { setNewOpen(false); setSeed(null); setOrdersKey((n) => n + 1) }

  useEffect(() => {
    followUpsAPI.catalogue().then((r) => setCatalogue(r.data)).catch(() => {})
    usersAPI.getVisible().then((r) => setUsers(r.data)).catch(() => {})
  }, [])
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t) }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await followUpsAPI.list({
        ...(status ? { status } : {}),
        ...(qDebounced ? { q: qDebounced } : {}),
        ...(mine && user?.id ? { ownerId: user.id } : {}),
      })
      setRows(data)
    } catch (e) { console.error('Failed to load follow-ups', e) }
    finally { setLoading(false) }
  }, [status, qDebounced, mine, user?.id])
  useEffect(() => { load() }, [load])

  const overdueTotal = useMemo(() => rows.reduce((n, r) => n + (r.overdueCount || 0), 0), [rows])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">📌 Project Follow-up</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Order execution: letter-of-credit, payment and acceptance dates, with email reminders as they come due
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate('/')}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Dashboard
            </button>
            <Button onClick={() => { setSeed(null); setNewOpen(true) }}>＋ New</Button>
          </div>
        </div>

        {id ? (
          <Detail
            key={id}
            id={id}
            catalogue={catalogue}
            users={users}
            onBack={() => navigate('/followups')}
            onChanged={load}
          />
        ) : (
          <>
            <OpenOrders key={ordersKey} onCreate={(order) => { setSeed(order); setNewOpen(true) }} />
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setStatus('')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${status === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  Live
                </button>
                {STATUSES.map((s) => (
                  <button key={s.key} onClick={() => setStatus(s.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${status === s.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setMine((v) => !v)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${mine ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  Mine
                </button>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project / order no. / serial / customer / contact"
                  className="w-56 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" />
              </div>
            </div>

            <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
              <span>{rows.length} project{rows.length === 1 ? '' : 's'}</span>
              {overdueTotal > 0 && <span className="font-semibold text-rose-600">{overdueTotal} milestone{overdueTotal === 1 ? '' : 's'} overdue</span>}
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                No follow-ups yet. Create one from a contract above, or open one for a won order and put its dates in.
              </div>
            ) : (
              <ul className="space-y-3">
                {rows.map((f) => <FollowUpRow key={f.id} f={f} onOpen={(x) => navigate(`/followups/${x}`)} />)}
              </ul>
            )}
          </>
        )}
      </div>

      {newOpen && (
        <NewModal users={users} catalogue={catalogue} seed={seed}
          onClose={closeNew}
          onCreated={(newId) => { closeNew(); navigate(`/followups/${newId}`) }} />
      )}
    </div>
  )
}
