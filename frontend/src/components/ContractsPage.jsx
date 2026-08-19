import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { contractsAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Input, Select } from './ui'
import { CONTRACT_DOC_TYPES, DOC_TYPE_ORDER, docTypeMeta, ocrMeta, ocrNeedsBadge } from '../constants/contract'
import useContractUnlock from '../hooks/useContractUnlock'
import ContractUploadModal from './ContractUploadModal'

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
        </div>

        {items.length === 0 ? (
          <Card className="p-10 text-center text-sm text-slate-400">
            {loading ? 'Loading…' : 'No contract files match these filters.'}
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
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
                  <button
                    onClick={() => navigate(`/customers/${f.customer.id}`)}
                    className="mt-0.5 block max-w-full truncate text-left text-xs font-medium text-slate-500 transition hover:text-brand-600"
                  >
                    {f.customer?.name}
                  </button>
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
            ))}
          </ul>
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
