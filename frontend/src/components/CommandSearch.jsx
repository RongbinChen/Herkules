import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchAPI, visitReportsAPI, assistantAPI } from '../api/api'
import { statusMeta, tierMeta } from '../constants/customer'
import ChatThread from './chat/ChatThread'
import ChatComposer from './chat/ChatComposer'

// Slash commands = instant structured search (no LLM, fast path).
// Anything else typed into the box goes to the AI assistant (DeepSeek tool
// loop over customers / bidding / reports / calendar).
const COMMANDS = [
  { key: 'customer', icon: '🤝', label: '/customer', hint: 'Search customers' },
  { key: 'project', icon: '📋', label: '/project', hint: 'Search tender projects' },
  { key: 'report', icon: '📝', label: '/report', hint: 'Search visit reports' },
]
const CMD_BY_KEY = Object.fromEntries(COMMANDS.map((c) => [c.key, c]))

const EXAMPLES = [
  'How are the recent visits and project progress with COSCO?',
  'Which competitors won the most tenders in the last 6 months?',
  "What's on the calendar next week?",
  'Schedule a visit to COSCO next Tuesday morning',
]

const TOOL_LABEL = {
  search_customers: 'Customers', get_customer: 'Customer profile', search_projects: 'Tenders',
  get_bidding_stats: 'Market stats', search_reports: 'Visit reports', get_report: 'Report',
  search_hot_projects: 'Hot projects', search_bid_openings: 'Bid openings', search_trips: 'Trips',
  search_events: 'Calendar', create_event: '✚ New event',
}

const STAGE_LABEL = { TENDER: 'Tender', CHANGE: 'Change', EVALUATION: 'Evaluation', AWARD: 'Award' }
const OUR_STATUS = {
  WATCHING: 'Watching', PREPARING: 'Preparing', SUBMITTED: 'Submitted', SHORTLISTED: 'Shortlisted',
  WON: 'Won', LOST: 'Lost', ABANDONED: 'Abandoned',
}
const fmtDate = (d) => { try { return new Date(d).toISOString().slice(0, 10) } catch { return '' } }

function parseInput(raw) {
  const s = raw.trimStart()
  if (!s || s[0] !== '/') return { mode: 'idle' }
  const m = s.match(/^\/(\w+)\s+(.*)$/)
  if (m && CMD_BY_KEY[m[1].toLowerCase()]) {
    return { mode: 'search', type: m[1].toLowerCase(), query: m[2].trim() }
  }
  return { mode: 'palette', partial: s.slice(1).toLowerCase() }
}

export default function CommandSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [raw, setRaw] = useState('')
  // Slash structured search
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(null)
  // AI chat
  const [chat, setChat] = useState([])
  const [chatLoading, setChatLoading] = useState(false)
  // Reply language: 'auto' follows the question; 'zh'/'en' force it. Persisted.
  const [lang, setLang] = useState(() => localStorage.getItem('assistantLang') || 'auto')
  const pickLang = (v) => { setLang(v); localStorage.setItem('assistantLang', v) }

  const parsed = parseInput(raw)

  // Desktop-only autofocus and scroll-to-bottom now live in ChatComposer /
  // ChatThread.

  // Debounced structured search for "/type query".
  useEffect(() => {
    if (parsed.mode !== 'search' || !parsed.query) { setResults(null); setLoading(false); return }
    let ignore = false
    setLoading(true)
    setError('')
    const t = setTimeout(async () => {
      try {
        const { data } = await searchAPI.query(parsed.type, parsed.query)
        if (!ignore) setResults(data)
      } catch {
        if (!ignore) { setError('Search failed'); setResults(null) }
      } finally {
        if (!ignore) setLoading(false)
      }
    }, 300)
    return () => { ignore = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.mode, parsed.type, parsed.query])

  const pickCommand = (key) => { setRaw(`/${key} `); inputRef.current?.focus() }

  const paletteItems = parsed.mode === 'palette'
    ? COMMANDS.filter((c) => c.key.startsWith(parsed.partial || ''))
    : []

  async function send(textArg) {
    const text = (textArg ?? raw).trim()
    if (!text || text.startsWith('/') || chatLoading) return
    const next = [...chat, { role: 'user', content: text }]
    setChat(next)
    setRaw('')
    setChatLoading(true)
    try {
      const { data } = await assistantAPI.chat(
        next.map(({ role, content }) => ({ role, content })),
        lang === 'auto' ? undefined : lang,
      )
      setChat([...next, { role: 'assistant', content: data.reply, steps: data.steps || [] }])
    } catch (e) {
      setChat([...next, { role: 'assistant', content: e.response?.data?.error || 'The assistant is temporarily unavailable, please retry.', isError: true }])
    } finally {
      setChatLoading(false)
    }
  }

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

  const showWelcome = chat.length === 0 && parsed.mode === 'idle' && !raw

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => navigate('/')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            ← Modules
          </button>
          <div className="flex items-center gap-2">
            {/* Reply-language toggle */}
            <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold shadow-sm">
              {[{ k: 'auto', t: 'Auto' }, { k: 'zh', t: '中文' }, { k: 'en', t: 'EN' }].map((o) => (
                <button key={o.k} onClick={() => pickLang(o.k)} title="AI 回复语言 / Reply language"
                  className={`px-3 py-1.5 transition ${lang === o.k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {o.t}
                </button>
              ))}
            </div>
            {chat.length > 0 && (
              <button onClick={() => setChat([])}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50">
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Welcome / hints */}
        {showWelcome && (
          <div className="mb-4">
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">✦ AI Assistant</h1>
            <p className="mt-1 text-sm text-slate-500">
              Ask anything — I answer from real workspace data (customers, tenders, bid openings,
              hot projects, visit reports, trips, calendar) and can create calendar events.
              Slash commands (<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/customer</code>
              {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/project</code>
              {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/report</code>) still work for instant search.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => send(ex)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50/40">
                  💬 {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat thread */}
        {chat.length > 0 && (
          <ChatThread
            messages={chat}
            loading={chatLoading}
            loadingLabel="Querying data…"
            className="mb-4"
            renderMeta={(m) => m.steps?.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-50 pt-2">
                <span className="text-[10px] text-slate-300">Queried</span>
                {m.steps.map((s, si) => (
                  <span key={si} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    {TOOL_LABEL[s.tool] || s.tool}{s.count != null ? ` ${s.count}` : ''}
                  </span>
                ))}
              </div>
            )}
          />
        )}

        {/* Slash structured results */}
        {parsed.mode === 'search' && (
          <div className="mb-4">
            {loading && <p className="py-6 text-center text-sm text-slate-400">Searching…</p>}
            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            {!loading && !error && results && (
              results.results.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No matches for “{parsed.query}”.</p>
              ) : (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {results.results.length} {results.type}{results.results.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {results.type === 'customer' && results.results.map((c) => (
                      <CustomerCard key={c.id} c={c} onOpen={() => navigate(`/customers/${c.id}?from=search`)} />
                    ))}
                    {results.type === 'project' && results.results.map((p) => (
                      <ProjectCard key={p.threadKey} p={p} onOpen={() => navigate('/chinabidding/tracking')}
                        onCustomer={(cid) => navigate(`/customers/${cid}?from=search`)} />
                    ))}
                    {results.type === 'report' && results.results.map((r) => (
                      <ReportCard key={r.id} r={r} onOpen={() => navigate(`/visit-reports/${r.id}`)}
                        onCustomer={(cid) => navigate(`/customers/${cid}?from=search`)}
                        onDownload={() => downloadReport(r)} downloading={downloading === r.id} />
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        )}

        {/* Input (sticky at bottom) */}
        <ChatComposer
          value={raw}
          onChange={setRaw}
          onSubmit={send}
          inputRef={inputRef}
          placeholder={chat.length ? 'Ask a follow-up…' : 'Ask anything, or type / for quick search…'}
          onClear={() => { setRaw(''); setResults(null) }}
          // A slash command is dispatched by the debounced search effect, not by
          // submitting — hide Send while the box holds one.
          showSend={!raw.startsWith('/')}
          sendDisabled={!raw.trim() || chatLoading}
          leftSlot={parsed.mode === 'search' && (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
              {CMD_BY_KEY[parsed.type].icon} {parsed.type}
            </span>
          )}
        >
          {/* Command palette (above the input) */}
          {parsed.mode === 'palette' && paletteItems.length > 0 && (
            <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
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
        </ChatComposer>
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
