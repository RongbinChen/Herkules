import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { contractsAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Input, Select } from './ui'
import { CONTRACT_DOC_TYPES, DOC_TYPE_ORDER, docTypeMeta, ocrMeta, ocrNeedsBadge } from '../constants/contract'
import useContractUnlock from '../hooks/useContractUnlock'
import ContractUploadModal from './ContractUploadModal'
import ContractAsk from './ContractAsk'

const PAGE = 50
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export default function ContractsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

  const {
    unlock, team, setTeam, doUnlock, switchTeam, lock, busy, error, setError,
    configured, masterSet, refreshPinStatus, handleAuthError,
  } = useContractUnlock(user?.team === 'WRC' ? 'WRC' : 'HRC')

  const [pin, setPin] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({})
  const [docType, setDocType] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState(null) // the file being re-categorised
  // Grouping is a view over the rows already loaded, not a server query. With a
  // customer filter active there is only ever one group, so it turns itself off.
  const [grouped, setGrouped] = useState(true)
  const [collapsed, setCollapsed] = useState(() => new Set())

  // Deep link from the customer card: ?customerId=12 lands here pre-filtered.
  const customerId = params.get('customerId') || ''
  const [customerName, setCustomerName] = useState('')

  const isAdmin = user?.isAdmin === true

  // Hand-rolled debounce; the project has no lodash and one input does not
  // justify adding it.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setOffset(0) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async (append = false) => {
    if (!unlock) return
    setLoading(true)
    try {
      const { data } = await contractsAPI.listAll({
        ...(docType ? { docType } : {}),
        ...(customerId ? { customerId } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        limit: PAGE,
        offset: append ? offset : 0,
      }, unlock.token)
      setItems((prev) => (append ? [...prev, ...data.items] : data.items))
      setTotal(data.total)
      if (!append) setOffset(0)
      // The customer filter shows a name, and the only place it can come from
      // when arriving by deep link is the rows themselves.
      if (customerId && data.items[0]?.customer?.name) setCustomerName(data.items[0].customer.name)
      setError('')
    } catch (e) {
      if (handleAuthError(e)) setItems([])
      else setError(e.response?.data?.error || 'Failed to load contract files')
    } finally {
      setLoading(false)
    }
  }, [unlock, docType, customerId, debouncedQ, offset, handleAuthError, setError])

  const loadSummary = useCallback(async () => {
    if (!unlock) return
    try {
      const { data } = await contractsAPI.summary(unlock.token)
      setCounts(data.counts || {})
    } catch { /* chips just show no numbers */ }
  }, [unlock])

  useEffect(() => { load(false) }, [unlock, docType, customerId, debouncedQ]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSummary() }, [loadSummary])

  async function submitPin(e) {
    e?.preventDefault()
    if (await doUnlock(pin)) setPin('')
  }

  async function doDownload(f) {
    try {
      const res = await contractsAPI.download(f.id, unlock.token)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = f.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      if (!handleAuthError(e)) setError('Download failed')
    }
  }

  async function saveEdit() {
    try {
      await contractsAPI.patch(editing.id, { docType: editing.docType, note: editing.note || null }, unlock.token)
      setEditing(null)
      await load(false)
      await loadSummary()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update')
    }
  }

  async function doDelete(f) {
    if (!window.confirm(`Delete “${f.filename}”? This cannot be undone.`)) return
    try {
      await contractsAPI.remove(f.id, unlock.token)
      await load(false)
      await loadSummary()
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed')
    }
  }

  const canEdit = (f) => isAdmin || f.uploadedBy?.id === user?.id

  // Groups cover the rows fetched so far; "Load more" grows the existing groups
  // rather than opening a second block for a customer that already has one.
  const groups = useMemo(() => {
    const byCustomer = new Map()
    for (const f of items) {
      const id = f.customer?.id ?? 0
      if (!byCustomer.has(id)) byCustomer.set(id, { id, name: f.customer?.name || 'Unknown customer', files: [] })
      byCustomer.get(id).files.push(f)
    }
    return [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [items])

  const showGrouped = grouped && !customerId

  const toggleGroup = (id) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // One row, rendered either standalone or inside a customer group — the group
  // header already names the customer, so the row drops that line there.
  const renderRow = (f, { showCustomer = true, boxed = true } = {}) => (
    <li
      key={f.id}
      className={`flex items-start justify-between gap-3 p-3 ${
        boxed ? 'rounded-xl border border-slate-200 bg-white' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge tone={docTypeMeta(f.docType).tone}>{docTypeMeta(f.docType).short}</Badge>
          {/* Only shown while a file is unreadable — a green tick on every
              row once the backlog clears would be noise. */}
          {ocrNeedsBadge(f.ocrStatus) && (
            <Badge tone={ocrMeta(f.ocrStatus).tone} title={ocrMeta(f.ocrStatus).zh}>
              {ocrMeta(f.ocrStatus).label}
            </Badge>
          )}
          <button onClick={() => doDownload(f)} className="min-w-0 truncate text-left text-sm font-semibold text-slate-800 transition hover:text-brand-600">
            {f.filename}
          </button>
        </div>
        {showCustomer && (
          <button
            onClick={() => navigate(`/customers/${f.customer.id}`)}
            className="mt-0.5 block max-w-full truncate text-left text-xs font-medium text-slate-500 transition hover:text-brand-600"
          >
            {f.customer?.name}
          </button>
        )}
        {f.note && <p className="mt-0.5 truncate text-[11px] text-slate-500">{f.note}</p>}
        <p className="mt-0.5 text-[11px] text-slate-400">
          {fmtSize(f.size)} · {f.uploadedBy?.name || 'Unknown user'} · {format(new Date(f.createdAt), 'yyyy-MM-dd')}
        </p>
      </div>
      {canEdit(f) && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => setEditing({ id: f.id, docType: f.docType, note: f.note || '' })} className="text-xs font-semibold text-slate-400 transition hover:text-brand-600">Edit</button>
          <button onClick={() => doDelete(f)} className="text-xs font-semibold text-slate-400 transition hover:text-rose-500">Delete</button>
        </div>
      )}
    </li>
  )

  // ── Locked ─────────────────────────────────────────────────────────────────
  if (!unlock) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="mx-auto max-w-lg">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900">Contracts</h1>
            <Button variant="secondary" size="sm" onClick={() => navigate('/')}>Modules</Button>
          </div>
          <Card className="p-6">
            <p className="mb-4 text-sm text-slate-500">
              Contract files are kept per team. Enter that team’s PIN to view or add files.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {['WRC', 'HRC'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTeam(k)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    team === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            {configured && !configured.includes(team) && !(isAdmin && masterSet) && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No PIN has been set for {team} yet.{isAdmin ? ' Set one from a customer’s Contracts card.' : ' Ask an admin to set one.'}
              </p>
            )}
            {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
            <form onSubmit={submitPin} className="flex gap-2">
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={isAdmin && masterSet ? `${team} PIN or master PIN` : `${team} PIN`}
                autoComplete="off"
              />
              <Button type="submit" size="sm" disabled={!pin.trim() || busy}>{busy ? 'Checking…' : 'Unlock'}</Button>
            </form>
            {isAdmin && masterSet && (
              <p className="mt-2 text-[11px] text-slate-400">
                Your master PIN opens either team, and switching afterwards will not ask again.
              </p>
            )}
          </Card>
        </div>
      </div>
    )
  }

  // ── Unlocked ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">
            Contracts <span className="ml-1 text-sm font-semibold text-brand-600">{unlock.team}</span>
          </h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setUploadOpen(true)}>＋ Upload</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/')}>Modules</Button>
          </div>
        </div>

        {/* Team switching is an unlock, not a filter: the token covers one team
            and the server will not serve the other. Saying so up front avoids
            people reading these as tabs and wondering why a click asks for a PIN.
            A master PIN re-unlocks silently, so for an admin holding one these
            do behave like tabs — one unlock per switch, just not one typed. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {['WRC', 'HRC'].map((k) => (
            <button
              key={k}
              disabled={busy}
              onClick={() => { if (k !== unlock.team) switchTeam(k) }}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                unlock.team === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {unlock.team === k ? `🔓 ${k}` : `🔒 ${k}`}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-slate-400">
            {unlock.via === 'master'
              ? 'Master PIN — switching teams needs no retyping'
              : 'Switching teams asks for that team’s PIN'}
          </span>
          <button onClick={lock} className="ml-auto text-xs font-semibold text-slate-400 transition hover:text-slate-600">🔒 Lock</button>
        </div>

        {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

        {/* Ask AI. Seeded with the deep-link customer when arriving from a
            customer's card, but the picker still lets you ask about any of them. */}
        <ContractAsk
          token={unlock.token}
          initialCustomer={customerId && customerName ? { id: Number(customerId), name: customerName } : null}
        />

        {/* Category filter */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setDocType('')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              docType === '' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          {DOC_TYPE_ORDER.map((k) => (
            <button
              key={k}
              onClick={() => setDocType(k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                docType === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {CONTRACT_DOC_TYPES[k].short}
              {counts[k] > 0 && <span className="ml-1 opacity-60">{counts[k]}</span>}
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search file name, note or customer…"
            className="max-w-sm"
          />
          {customerId && (
            <span className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Customer: {customerName || `#${customerId}`}
              <button onClick={() => { params.delete('customerId'); setParams(params); setCustomerName('') }} aria-label="Clear customer filter">✕</button>
            </span>
          )}
          <span className="text-xs text-slate-400">{total} file{total === 1 ? '' : 's'}</span>
          {!customerId && (
            <button
              onClick={() => setGrouped((v) => !v)}
              className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
            >
              {grouped ? '☰ Flat list' : '▤ Group by customer'}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <Card className="p-10 text-center text-sm text-slate-400">
            {loading ? 'Loading…' : 'No contract files match these filters.'}
          </Card>
        ) : showGrouped ? (
          <div className="space-y-3">
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.id)
              return (
                /* One box per customer, not one per file. Rows carrying their
                   own border made every group look the same as the last, which
                   is the thing that made the boundaries hard to find. */
                <section key={g.id} className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                  {/* The header collapses; opening the customer is the small
                      arrow on the right. Putting the navigation on the name
                      would send people to another page on the click they meant
                      as "fold this away". */}
                  <div className={`flex items-center gap-2 bg-slate-100 px-3 py-2 ${isCollapsed ? '' : 'border-b border-slate-200'}`}>
                    <button
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:opacity-70"
                    >
                      <span className="text-xs text-slate-400">{isCollapsed ? '▸' : '▾'}</span>
                      <span className="min-w-0 truncate text-sm font-bold text-slate-800">{g.name}</span>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        {g.files.length}
                      </span>
                    </button>
                    <button
                      onClick={() => navigate(`/customers/${g.id}`)}
                      title={`Open ${g.name}`}
                      aria-label={`Open ${g.name}`}
                      className="shrink-0 text-xs font-semibold text-slate-400 transition hover:text-brand-600"
                    >
                      ↗
                    </button>
                  </div>
                  {!isCollapsed && (
                    <ul className="divide-y divide-slate-100">
                      {g.files.map((f) => renderRow(f, { showCustomer: false, boxed: false }))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        ) : (
          <ul className="space-y-2">{items.map((f) => renderRow(f))}</ul>
        )}

        {items.length < total && (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => { const next = offset + PAGE; setOffset(next); load(true) }}
            >
              {loading ? 'Loading…' : `Load more (${total - items.length} left)`}
            </Button>
          </div>
        )}
      </div>

      {uploadOpen && (
        <ContractUploadModal
          token={unlock.token}
          team={unlock.team}
          initialCustomer={customerId && customerName ? { id: Number(customerId), name: customerName } : null}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { load(false); loadSummary() }}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-16 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-base font-bold text-slate-900">Change type / note</h3>
            <Select value={editing.docType} onChange={(e) => setEditing((s) => ({ ...s, docType: e.target.value }))}>
              {DOC_TYPE_ORDER.map((k) => <option key={k} value={k}>{CONTRACT_DOC_TYPES[k].label}</option>)}
            </Select>
            <Input value={editing.note} onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))} placeholder="Note" maxLength={500} className="mt-2" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
