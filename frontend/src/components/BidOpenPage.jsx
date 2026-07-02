import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  uploadBidOpening, listBidOpenings, deleteBidOpening,
  createManualBidOpening, downloadBidTemplate,
  fetchBidResults, getBidResults, getEmailStatus,
  listSavedSearches, createSavedSearch, deleteSavedSearch, updateSavedSearch,
} from '../api/chinabidding'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { key: 'opening', label: 'Bid Opening' },
  { key: 'track', label: 'Evaluation / Award' },
  { key: 'watch', label: 'Subscriptions' },
]

const STAGE_META = {
  change: { label: 'Tender Changes', cls: 'bg-orange-500' },
  evaluation: { label: 'Evaluation Results', cls: 'bg-violet-500' },
  award: { label: 'Tender Awards', cls: 'bg-emerald-600' },
  tender: { label: 'New Tenders', cls: 'bg-blue-500' },
}

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-US') : '—'
}

// Manual entry form — same columns as the Excel template
const EMPTY_BIDDER = { name: '', country: '', priceTerm: '', currency: '', price: '', deliveryTime: '', destination: '', note: '' }

function ManualEntryForm({ onSaved, onCancel }) {
  const [head, setHead] = useState({ projectName: '', biddingNo: '', openDate: '', purchaser: '' })
  const [bidders, setBidders] = useState([{ ...EMPTY_BIDDER }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cell = 'rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-sky-500 focus:bg-white'

  function setBidder(i, field, v) {
    setBidders((prev) => prev.map((b, idx) => (idx === i ? { ...b, [field]: v } : b)))
  }
  function addRow() { setBidders((prev) => [...prev, { ...EMPTY_BIDDER }]) }
  function removeRow(i) { setBidders((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)) }

  async function submit() {
    const filled = bidders.filter((b) => b.name.trim())
    if (!head.projectName.trim() && !head.biddingNo.trim() && filled.length === 0) {
      return setError('Enter at least a project name / bidding no, or one bidder')
    }
    setSaving(true); setError('')
    try {
      const rec = await createManualBidOpening({ ...head, bidders: filled })
      onSaved(rec)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-slate-800">Enter a bid-opening record</p>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input value={head.projectName} onChange={(e) => setHead({ ...head, projectName: e.target.value })} placeholder="Project name" className={cell} />
        <input value={head.biddingNo} onChange={(e) => setHead({ ...head, biddingNo: e.target.value })} placeholder="Bidding / IFB No." className={cell} />
        <input type="date" value={head.openDate} onChange={(e) => setHead({ ...head, openDate: e.target.value })} className={cell} title="Bid opening date" />
        <input value={head.purchaser} onChange={(e) => setHead({ ...head, purchaser: e.target.value })} placeholder="End user / Purchaser" className={cell} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="px-2 py-2">#</th><th className="px-2 py-2">Bidder*</th><th className="px-2 py-2">Country</th>
              <th className="px-2 py-2">Term</th><th className="px-2 py-2">Currency</th><th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">Delivery</th><th className="px-2 py-2">Destination</th><th className="px-2 py-2">Remark</th><th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {bidders.map((b, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5"><input value={b.name} onChange={(e) => setBidder(i, 'name', e.target.value)} className={`${cell} w-40`} /></td>
                <td className="px-2 py-1.5"><input value={b.country} onChange={(e) => setBidder(i, 'country', e.target.value)} className={`${cell} w-24`} /></td>
                <td className="px-2 py-1.5"><input value={b.priceTerm} onChange={(e) => setBidder(i, 'priceTerm', e.target.value)} className={`${cell} w-20`} placeholder="CIF" /></td>
                <td className="px-2 py-1.5"><input value={b.currency} onChange={(e) => setBidder(i, 'currency', e.target.value)} className={`${cell} w-20`} placeholder="Euro" /></td>
                <td className="px-2 py-1.5"><input value={b.price} onChange={(e) => setBidder(i, 'price', e.target.value)} className={`${cell} w-32`} /></td>
                <td className="px-2 py-1.5"><input value={b.deliveryTime} onChange={(e) => setBidder(i, 'deliveryTime', e.target.value)} className={`${cell} w-28`} /></td>
                <td className="px-2 py-1.5"><input value={b.destination} onChange={(e) => setBidder(i, 'destination', e.target.value)} className={`${cell} w-24`} /></td>
                <td className="px-2 py-1.5"><input value={b.note} onChange={(e) => setBidder(i, 'note', e.target.value)} className={`${cell} w-40`} /></td>
                <td className="px-2 py-1.5"><button onClick={() => removeRow(i)} className="rounded px-1.5 py-1 text-xs text-red-500 hover:bg-red-50">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={addRow} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-sky-600 hover:bg-sky-50">+ Add bidder</button>
        <div className="flex-1" />
        <button onClick={submit} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save record'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}

// ── Bid Opening tab ──────────────────────────────────────────────────────────
function OpeningTab() {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const [records, setRecords] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [manualOpen, setManualOpen] = useState(false)

  async function handleTemplate() {
    try { await downloadBidTemplate() } catch (err) { setError(err.message) }
  }

  async function load() {
    try { setRecords(await listBidOpenings()) } catch (e) { console.error(e) }
  }
  useEffect(() => { load() }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const rec = await uploadBidOpening(file)
      setRecords((prev) => [rec, ...prev])
      setExpanded(rec.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(rec) {
    if (!window.confirm(`Delete bid-opening record "${rec.projectName || rec.fileName}"?`)) return
    try { await deleteBidOpening(rec.id); load() } catch (err) { window.alert(err.message) }
  }

  // Inline evaluation/award results for a record, keyed by its bidding No.
  const [resultPanel, setResultPanel] = useState(null) // { recId, data, phase, error }

  async function openResults(rec) {
    if (resultPanel?.recId === rec.id) { setResultPanel(null); return } // toggle off
    if (!rec.biddingNo) {
      setResultPanel({ recId: rec.id, data: null, phase: '', error: 'This record has no bidding No.' })
      return
    }
    setResultPanel({ recId: rec.id, data: null, phase: 'local', error: '' })
    try {
      const data = await getBidResults(rec.biddingNo)
      setResultPanel({ recId: rec.id, data, phase: '', error: '' })
    } catch (err) {
      setResultPanel({ recId: rec.id, data: null, phase: '', error: err.message })
    }
  }

  async function fetchResultsLive(rec) {
    setResultPanel((p) => ({ ...p, recId: rec.id, phase: 'live', error: '' }))
    try {
      const data = await fetchBidResults(rec.biddingNo)
      setResultPanel({ recId: rec.id, data, phase: '', error: '', fetched: true })
    } catch (err) {
      setResultPanel((p) => ({ ...(p || {}), recId: rec.id, phase: '', error: err.message }))
    }
  }

  // One-click watch: subscribe to this bidding No so the daily scrape notifies
  // (in-app + email) as soon as evaluation/award announcements are published.
  async function subscribeNo(rec) {
    try {
      await createSavedSearch({
        name: `No. ${rec.biddingNo}`,
        keyword: rec.biddingNo,
        autoMonitor: true,
        emailNotify: true,
      })
      setResultPanel((p) => ({ ...p, subscribed: true }))
    } catch (err) {
      setResultPanel((p) => ({ ...p, error: err.message }))
    }
  }

  const [copiedId, setCopiedId] = useState(null)
  const [toast, setToast] = useState('')
  async function handleShare(rec) {
    if (!rec.shareToken) return
    const url = `${window.location.origin}/bidopen/share/${rec.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(rec.id)
      setToast('Share link copied — paste it into WeChat / email to share.')
      setTimeout(() => setCopiedId(null), 2000)
      setTimeout(() => setToast(''), 3000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-sky-300 bg-sky-50/50 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">Add a bid-opening record</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload an .xlsx (AI auto-extracts bidding no / project / date / bidders & prices), or
            <button onClick={handleTemplate} className="mx-1 font-semibold text-sky-600 hover:underline">download the template</button>
            to fill in and upload, or enter it manually.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setManualOpen((v) => !v)} className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50">
            {manualOpen ? 'Close manual entry' : '✎ Enter manually'}
          </button>
          <label className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${uploading ? 'bg-slate-300' : 'bg-sky-600 hover:bg-sky-700'}`}>
            {uploading ? 'Recognizing…' : 'Upload Excel'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading} onChange={handleFile} />
          </label>
        </div>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200">{error}</p>}

      {manualOpen && (
        <ManualEntryForm
          onCancel={() => setManualOpen(false)}
          onSaved={(rec) => { setRecords((prev) => [rec, ...prev]); setExpanded(rec.id); setManualOpen(false) }}
        />
      )}

      {records.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No bid-opening records yet. Upload your first Excel.</p>
      ) : (
        <ul className="space-y-3">
          {records.map((r) => (
            <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{r.projectName || '(project name not recognized)'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    No. <span className="font-mono">{r.biddingNo || '—'}</span> · Opened {fmtDate(r.openDate)}
                    {r.purchaser ? ` · ${r.purchaser}` : ''} · File {r.fileName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="rounded-md px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-50">
                    {expanded === r.id ? 'Collapse' : `Expand (${(r.bidders || []).length} bidders)`}
                  </button>
                  <button
                    onClick={() => openResults(r)}
                    disabled={!r.biddingNo}
                    title={r.biddingNo ? `Follow up evaluation / award results for ${r.biddingNo}` : 'No bidding No. on this record'}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-violet-600 hover:bg-violet-50 disabled:opacity-40"
                  >
                    {resultPanel?.recId === r.id ? 'Hide follow-up' : 'Follow-up'}
                  </button>
                  {r.shareToken && (
                    <button onClick={() => handleShare(r)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                      {copiedId === r.id ? 'Copied ✓' : 'Share'}
                    </button>
                  )}
                  {(r.uploadedById === user?.id || user?.isAdmin) && (
                    <button onClick={() => handleDelete(r)} className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">Delete</button>
                  )}
                </div>
              </div>
              {expanded === r.id && (r.bidders || []).length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Bidder</th>
                        <th className="px-3 py-2">Country</th>
                        <th className="px-3 py-2">Price term</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2">Delivery time</th>
                        <th className="px-3 py-2">Destination</th>
                        <th className="px-3 py-2">Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.bidders.map((b, i) => (
                        <tr key={i} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{b.name}</td>
                          <td className="px-3 py-2 text-slate-600">{b.country || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{[b.priceTerm, b.currency].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-3 py-2 text-slate-700">{b.price || '—'}</td>
                          <td className="px-3 py-2 whitespace-normal text-slate-600">{b.deliveryTime || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{b.destination || '—'}</td>
                          <td className="px-3 py-2 whitespace-normal text-slate-500">{b.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {resultPanel?.recId === r.id && (
                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-700">Evaluation / Award results for <span className="font-mono">{r.biddingNo}</span></p>
                    <button
                      onClick={() => fetchResultsLive(r)}
                      disabled={!r.biddingNo || resultPanel.phase === 'live'}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {resultPanel.phase === 'live' ? 'Fetching… (1-2 min)' : '⟳ Fetch from chinabidding'}
                    </button>
                  </div>
                  {resultPanel.error && <p className="text-sm font-medium text-red-600">{resultPanel.error}</p>}
                  {resultPanel.phase === 'local' && <p className="py-4 text-center text-sm text-slate-400">Searching…</p>}
                  {resultPanel.data && (() => {
                    const d = resultPanel.data
                    const hasResults = (d.evaluation?.length || 0) + (d.award?.length || 0) > 0
                    const others = [...(d.change || []), ...(d.tender || [])]
                    const Item = ({ p }) => (
                      <li className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline">{p.projectName}</a>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          <span>Published {fmtDate(p.publishDate)}</span>
                          {p.winner && <span>Winner: <b className="text-slate-700">{p.winner}</b>{p.competitor ? ` (${p.competitor.name})` : ''}</span>}
                          {p.winningPrice && <span>Winning price: {p.winningPrice}</span>}
                        </div>
                      </li>
                    )
                    return (
                      <div className="space-y-3">
                        {hasResults ? (
                          ['award', 'evaluation'].filter((k) => d[k]?.length).map((key) => (
                            <div key={key}>
                              <h4 className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-600">
                                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold text-white ${STAGE_META[key].cls}`}>{STAGE_META[key].label}</span>
                                <span className="text-slate-400">{d[key].length}</span>
                              </h4>
                              <ul className="space-y-1.5">{d[key].map((p) => <Item key={p.id} p={p} />)}</ul>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                            <p className="font-medium">
                              No evaluation / award results published for this No. yet
                              {resultPanel.fetched ? ' (checked chinabidding just now).' : '.'}
                            </p>
                            <p className="mt-1 text-xs text-amber-700">
                              Results usually appear on chinabidding days or weeks after bid opening.
                              {resultPanel.subscribed ? (
                                <span className="ml-1 font-semibold text-emerald-700">Subscribed ✓ — you'll be notified when they're published.</span>
                              ) : (
                                <button onClick={() => subscribeNo(r)} className="ml-1 font-semibold text-sky-700 underline hover:text-sky-900">
                                  Subscribe to this No.
                                </button>
                              )}
                            </p>
                          </div>
                        )}
                        {others.length > 0 && (
                          <div>
                            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Other announcements for this No.</h4>
                            <ul className="space-y-1.5 opacity-80">{others.map((p) => <Item key={p.id} p={p} />)}</ul>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[1200] -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          ✓ {toast}
        </div>
      )}
    </div>
  )
}

// ── Evaluation / Award results tab ───────────────────────────────────────────
function TrackTab() {
  const [biddingNo, setBiddingNo] = useState('')
  const [result, setResult] = useState(null)
  const [phase, setPhase] = useState('') // '' | 'local' | 'live'
  const [error, setError] = useState('')
  const [subs, setSubs] = useState([])

  // Show what's being tracked (subscriptions) right here, so "Subscribe to
  // this No." on a record is immediately visible in this tab too.
  useEffect(() => {
    listSavedSearches().then(setSubs).catch(() => setSubs([]))
  }, [])

  async function queryLocal(no = biddingNo) {
    const q = (no || '').trim()
    if (!q) return
    setBiddingNo(q)
    setPhase('local'); setError('')
    try { setResult(await getBidResults(q)) } catch (err) { setError(err.message) }
    setPhase('')
  }
  async function fetchLive() {
    if (!biddingNo.trim()) return
    setPhase('live'); setError('')
    try { setResult(await fetchBidResults(biddingNo.trim())) } catch (err) { setError(err.message) }
    setPhase('')
  }

  const groups = result ? ['award', 'evaluation', 'change', 'tender'].filter((k) => result[k]?.length) : []

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          value={biddingNo}
          onChange={(e) => setBiddingNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && queryLocal()}
          placeholder="Enter a bidding no, e.g. 0712-254112DG050"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white"
        />
        <button onClick={queryLocal} disabled={!!phase || !biddingNo.trim()} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {phase === 'local' ? 'Searching…' : 'Search local DB'}
        </button>
        <button onClick={fetchLive} disabled={!!phase || !biddingNo.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {phase === 'live' ? 'Fetching… (1-2 min)' : '⟳ Fetch from chinabidding'}
        </button>
        <p className="w-full text-xs text-slate-400">“Search local DB” returns already-stored announcements instantly; “Fetch” searches chinabidding by number for evaluation/award announcements and stores them (slower).</p>
        {subs.length > 0 && (
          <div className="w-full border-t border-slate-100 pt-2">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Tracking ({subs.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {subs.map((s) => (
                <button
                  key={s.id}
                  onClick={() => queryLocal(s.keyword)}
                  title={`${s.name} — click to check results${s.emailNotify ? ' · email on' : ''}`}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition hover:border-sky-400 hover:text-sky-700 ${biddingNo === s.keyword ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  {s.keyword}
                  {s.emailNotify && <span className="ml-1 opacity-60">✉</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200">{error}</p>}

      {result && (
        result.total === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No announcements found for this number. Try “Fetch from chinabidding”.</p>
        ) : (
          <div className="space-y-5">
            {groups.map((key) => (
              <section key={key}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold text-white ${STAGE_META[key].cls}`}>{STAGE_META[key].label}</span>
                  <span className="text-slate-400">{result[key].length}</span>
                </h3>
                <ul className="space-y-2">
                  {result[key].map((p) => (
                    <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 hover:text-blue-600 hover:underline">
                        {p.projectName}
                      </a>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                        <span>Published {fmtDate(p.publishDate)}</span>
                        {p.winner && <span>Winner: <b className="text-slate-700">{p.winner}</b>{p.competitor ? ` (${p.competitor.name})` : ''}</span>}
                        {p.winningPrice && <span>Winning price: {p.winningPrice}</span>}
                        {p.purchaser && <span>Purchaser: {p.purchaser}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ── Subscriptions tab ────────────────────────────────────────────────────────
function WatchTab() {
  const [subs, setSubs] = useState([])
  const [emailConfigured, setEmailConfigured] = useState(null)
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [emailNotify, setEmailNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try { setSubs(await listSavedSearches()) } catch (e) { console.error(e) }
  }
  useEffect(() => {
    load()
    getEmailStatus().then((s) => setEmailConfigured(s.emailConfigured)).catch(() => setEmailConfigured(false))
  }, [])

  async function handleCreate() {
    if (!keyword.trim()) return setError('Enter a bidding no or keyword')
    setSaving(true); setError('')
    try {
      await createSavedSearch({ name: name.trim() || keyword.trim(), keyword: keyword.trim(), autoMonitor: true, emailNotify })
      setName(''); setKeyword('')
      load()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function toggle(sub, field) {
    try {
      await updateSavedSearch(sub.id, { [field]: !sub[field] })
      load()
    } catch (err) { window.alert(err.message) }
  }

  async function handleDelete(sub) {
    if (!window.confirm(`Delete subscription "${sub.name}"?`)) return
    try { await deleteSavedSearch(sub.id); load() } catch (err) { window.alert(err.message) }
  }

  return (
    <div>
      {emailConfigured === false && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
          ⚠️ Email sending is not configured yet (set SMTP_HOST/SMTP_USER/SMTP_PASS in the server .env). Until then, only in-app bell notifications are sent, not emails.
        </p>
      )}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2 font-semibold text-slate-800">New subscription</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Bidding no or keyword, e.g. 0712-254112DG050 / roll grinder"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)"
            className="w-44 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white" />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={emailNotify} onChange={(e) => setEmailNotify(e.target.checked)} className="h-4 w-4 accent-sky-600" />
            Email
          </label>
          <button onClick={handleCreate} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Saving…' : '+ Subscribe'}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">Runs daily at 08:00, scraping chinabidding per subscription (incl. evaluation/award announcements). New matches trigger an in-app notification, plus email when enabled.</p>
        {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      </div>

      {subs.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No subscriptions yet.</p>
      ) : (
        <ul className="space-y-2">
          {subs.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{s.name}</p>
                <p className="text-xs text-slate-400">Keyword / No.: <span className="font-mono">{s.keyword}</span>{s.lastRunAt ? ` · last run ${new Date(s.lastRunAt).toLocaleString('en-US')}` : ' · not run yet'}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.autoMonitor} onChange={() => toggle(s, 'autoMonitor')} className="h-4 w-4 accent-sky-600" />
                Daily watch
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.emailNotify} onChange={() => toggle(s, 'emailNotify')} className="h-4 w-4 accent-sky-600" />
                Email
              </label>
              <button onClick={() => handleDelete(s)} className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Page shell ───────────────────────────────────────────────────────────────
export default function BidOpenPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('opening')

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-slate-400">Bid Tracking</p>
              <p className="text-[1rem] font-medium text-slate-700">Bid opening records · Evaluation / award tracking · Subscriptions</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/chinabidding')} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                ← Project List
              </button>
              <button onClick={() => navigate('/')} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                Modules
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t.key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </header>

        {tab === 'opening' && <OpeningTab />}
        {tab === 'track' && <TrackTab />}
        {tab === 'watch' && <WatchTab />}
      </div>
    </div>
  )
}
