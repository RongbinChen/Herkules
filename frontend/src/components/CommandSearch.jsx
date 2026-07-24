import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchAPI, visitReportsAPI } from '../api/api'
import { statusMeta, tierMeta } from '../constants/customer'

// Slash commands the box understands.
const COMMANDS = [
  { key: 'customer', icon: '🤝', label: '/customer', hint: 'Search customers' },
  { key: 'project', icon: '📋', label: '/project', hint: 'Search tender projects' },
  { key: 'report', icon: '📝', label: '/report', hint: 'Search visit reports' },
]
const CMD_BY_KEY = Object.fromEntries(COMMANDS.map((c) => [c.key, c]))

const STAGE_LABEL = { TENDER: 'Tender', CHANGE: 'Change', EVALUATION: 'Evaluation', AWARD: 'Award' }
const OUR_STATUS = {
  WATCHING: 'Watching', PREPARING: 'Preparing', SUBMITTED: 'Submitted', SHORTLISTED: 'Shortlisted',
  WON: 'Won', LOST: 'Lost', ABANDONED: 'Abandoned',
}
const fmtDate = (d) => { try { return new Date(d).toISOString().slice(0, 10) } catch { return '' } }

// Parse the raw input into { mode, type, query }.
//  mode 'palette'  → user is still typing the command (show command menu)
//  mode 'search'   → "/type <query>" is complete (run the search)
//  mode 'idle'     → empty / not a command yet
function parseInput(raw) {
  const s = raw.trimStart()
  if (!s) return { mode: 'idle' }
  if (s[0] !== '/') return { mode: 'idle' }
  const m = s.match(/^\/(\w+)\s+(.*)$/)
  if (m && CMD_BY_KEY[m[1].toLowerCase()]) {
    return { mode: 'search', type: m[1].toLowerCase(), query: m[2].trim() }
  }
  // still typing the command word → palette, filtered by the partial
  const partial = s.slice(1).toLowerCase()
  return { mode: 'palette', partial }
}

export default function CommandSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [raw, setRaw] = useState('')
  const [results, setResults] = useState(null) // { type, results } | null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(null)

  const parsed = parseInput(raw)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced live search when the input is a complete "/type query".
  useEffect(() => {
    if (parsed.mode !== 'search' || !parsed.query) { setResults(null); setLoading(false); return }
    let ignore = false
    setLoading(true)
    setError('')
    const t = setTimeout(async () => {
      try {
        const { data } = await searchAPI.query(parsed.type, parsed.query)
        if (!ignore) setResults(data)
      } catch (e) {
        if (!ignore) { setError('Search failed'); setResults(null) }
      } finally {
        if (!ignore) setLoading(false)
      }
    }, 300)
    return () => { ignore = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.mode, parsed.type, parsed.query])

  const pickCommand = (key) => {
    setRaw(`/${key} `)
    inputRef.current?.focus()
  }

  const paletteItems = parsed.mode === 'palette'
    ? COMMANDS.filter((c) => c.key.startsWith(parsed.partial || ''))
    : []

  async function downloadReport(r) {
    setDownloading(r.id)
    try {
      const res = await visitReportsAPI.exportDocx(r.id)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(r.title || 'visit-report').replace(/[^\w.\- ]+/g, '_').slice(0, 80)}.docx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch {
      window.alert('Failed to export Word document')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => navigate('/')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            ← Modules
          </button>
        </div>

        <h1 className="mb-1 text-xl font-bold text-slate-800 sm:text-2xl">Search</h1>
        <p className="mb-4 text-sm text-slate-500">
          Type <code className="rounded bg-slate-100 px-1 font-mono text-brand-700">/</code> then a command
          — <code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/customer</code>,
          {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/project</code>,
          {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/report</code> — and a keyword.
        </p>

        {/* Command box */}
        <div className="relative">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
            {parsed.mode === 'search' && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
                {CMD_BY_KEY[parsed.type].icon} {parsed.type}
              </span>
            )}
            <input
              ref={inputRef}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="/customer waldrich…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              autoComplete="off"
              spellCheck={false}
            />
            {raw && (
              <button onClick={() => { setRaw(''); setResults(null); inputRef.current?.focus() }}
                className="shrink-0 text-slate-300 hover:text-slate-500" aria-label="Clear">✕</button>
            )}
          </div>

          {/* Command palette */}
          {parsed.mode === 'palette' && paletteItems.length > 0 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {paletteItems.map((c) => (
                <button key={c.key} onClick={() => pickCommand(c.key)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50">
                  <span className="text-lg">{c.icon}</span>
                  <span className="font-mono text-sm font-semibold text-slate-700">{c.label}</span>
                  <span className="text-xs text-slate-400">{c.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Empty-state command hints */}
        {parsed.mode === 'idle' && !raw && (
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {COMMANDS.map((c) => (
              <button key={c.key} onClick={() => pickCommand(c.key)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-brand-300 hover:bg-slate-50">
                <span className="text-lg">{c.icon}</span>
                <span>
                  <span className="block font-mono text-xs font-semibold text-slate-700">{c.label}</span>
                  <span className="block text-[11px] text-slate-400">{c.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="mt-5">
          {loading && <p className="py-8 text-center text-sm text-slate-400">Searching…</p>}
          {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

          {!loading && !error && results && (
            results.results.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No matches for “{parsed.query}”.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {results.results.length} {results.type}{results.results.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-2">
                  {results.type === 'customer' && results.results.map((c) => (
                    <CustomerCard key={c.id} c={c} onOpen={() => navigate(`/customers/${c.id}`)} />
                  ))}
                  {results.type === 'project' && results.results.map((p) => (
                    <ProjectCard key={p.threadKey} p={p} onOpen={() => navigate('/chinabidding/tracking')}
                      onCustomer={(cid) => navigate(`/customers/${cid}`)} />
                  ))}
                  {results.type === 'report' && results.results.map((r) => (
                    <ReportCard key={r.id} r={r} onOpen={() => navigate('/visit-reports')}
                      onCustomer={(cid) => navigate(`/customers/${cid}`)}
                      onDownload={() => downloadReport(r)} downloading={downloading === r.id} />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function CustomerCard({ c, onOpen }) {
  const s = statusMeta(c.status)
  const t = tierMeta(c.tier)
  return (
    <button onClick={onOpen} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{c.name}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${t.cls}`}>{t.label}</span>
      </div>
      {c.address && <p className="mt-0.5 truncate text-xs text-slate-400">{c.address}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${s.cls}`}>{s.label}</span>
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">📋 {c.projectCount} projects</span>
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">📝 {c.reportCount} reports</span>
      </div>
    </button>
  )
}

function ProjectCard({ p, onOpen, onCustomer }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
      <button onClick={onOpen} className="block w-full text-left">
        <span className="block font-semibold text-slate-800">{p.projectName}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">
          {[p.purchaser, p.region].filter(Boolean).join(' · ') || p.threadKey}
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {p.bidStage && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">{STAGE_LABEL[p.bidStage] || p.bidStage}</span>}
        {p.tracking?.ourStatus && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{OUR_STATUS[p.tracking.ourStatus] || p.tracking.ourStatus}</span>}
        {p.equipmentType && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">{p.equipmentType}</span>}
        {p.deadline && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">Due {fmtDate(p.deadline)}</span>}
        {(p.customers || []).map((cu) => (
          <button key={cu.id} onClick={() => onCustomer(cu.id)}
            className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-100">
            👤 {cu.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function ReportCard({ r, onOpen, onCustomer, onDownload, downloading }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left font-semibold text-slate-800 hover:text-brand-600">
          {r.title}
        </button>
        <button onClick={onDownload} disabled={downloading}
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
          {downloading ? '…' : '⬇ Word'}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>{fmtDate(r.visitDate)}</span>
        {r.customer && (
          <button onClick={() => onCustomer(r.customer.id)} className="font-semibold text-brand-600 hover:underline">
            👤 {r.customer.name}
          </button>
        )}
        {r.author?.name && <span>By {r.author.name}</span>}
        {r.status && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">{r.status}</span>}
      </div>
      {r.summary && <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{r.summary}</p>}
    </div>
  )
}
