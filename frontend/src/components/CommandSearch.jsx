import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchAPI, visitReportsAPI, assistantAPI } from '../api/api'
import { statusMeta, tierMeta } from '../constants/customer'

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
  'COSCO 最近的拜访情况和项目进展怎么样？',
  '最近 6 个月哪些竞争对手中标最多？',
  '下周有哪些日程安排？',
  '帮我安排下周二上午拜访 COSCO',
]

const TOOL_LABEL = {
  search_customers: '客户', get_customer: '客户档案', search_projects: '招投标',
  get_bidding_stats: '市场统计', search_reports: '拜访报告', get_report: '报告全文',
  search_events: '日历', create_event: '✚ 创建日程',
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

// ── Minimal markdown rendering for assistant replies ─────────────────────────
function inline(s) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p)
}

function Md({ text }) {
  const out = []
  let list = []
  const flush = (k) => {
    if (list.length) { out.push(<ul key={`l${k}`} className="ml-4 list-disc space-y-0.5">{list}</ul>); list = [] }
  }
  String(text || '').split('\n').forEach((ln, i) => {
    const t = ln.trim()
    if (/^[-*•] /.test(t)) { list.push(<li key={i}>{inline(t.slice(2))}</li>); return }
    flush(i)
    if (!t) return
    if (/^-{3,}$/.test(t)) { out.push(<hr key={i} className="my-2 border-slate-100" />); return }
    const h = t.match(/^#{1,4}\s+(.*)/)
    if (h) { out.push(<p key={i} className="mt-1.5 font-bold text-slate-800">{inline(h[1])}</p>); return }
    out.push(<p key={i}>{inline(t)}</p>)
  })
  flush('end')
  return <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">{out}</div>
}

export default function CommandSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const endRef = useRef(null)
  const [raw, setRaw] = useState('')
  // Slash structured search
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(null)
  // AI chat
  const [chat, setChat] = useState([])
  const [chatLoading, setChatLoading] = useState(false)

  const parsed = parseInput(raw)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat, chatLoading])

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
      const { data } = await assistantAPI.chat(next.map(({ role, content }) => ({ role, content })))
      setChat([...next, { role: 'assistant', content: data.reply, steps: data.steps || [] }])
    } catch (e) {
      setChat([...next, { role: 'assistant', content: e.response?.data?.error || '助手暂时不可用，请稍后重试。', isError: true }])
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
          {chat.length > 0 && (
            <button onClick={() => setChat([])}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50">
              ✕ 清空对话
            </button>
          )}
        </div>

        {/* Welcome / hints */}
        {showWelcome && (
          <div className="mb-4">
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">✦ AI 助手</h1>
            <p className="mt-1 text-sm text-slate-500">
              直接提问 —— 我会查询客户、招投标、拜访报告、日历的真实数据来回答，也能帮你创建日程。
              斜杠命令（<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/customer</code>
              {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/project</code>
              {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-600">/report</code>）仍可直接快搜。
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
          <div className="mb-4 flex-1 space-y-3">
            {chat.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className={`max-w-[95%] rounded-2xl rounded-bl-md border bg-white px-4 py-3 shadow-sm ${m.isError ? 'border-rose-200' : 'border-slate-200'}`}>
                    <Md text={m.content} />
                    {m.steps?.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-50 pt-2">
                        <span className="text-[10px] text-slate-300">已查询</span>
                        {m.steps.map((s, si) => (
                          <span key={si} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                            {TOOL_LABEL[s.tool] || s.tool}{s.count != null ? ` ${s.count}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400 shadow-sm">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  正在查询数据…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
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
        )}

        {/* Input (sticky at bottom) */}
        <div className="sticky bottom-3 mt-auto">
          <div className="relative">
            <form
              onSubmit={(e) => { e.preventDefault(); send() }}
              className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-lg focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"
            >
              {parsed.mode === 'search' && (
                <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
                  {CMD_BY_KEY[parsed.type].icon} {parsed.type}
                </span>
              )}
              <input
                ref={inputRef}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={chat.length ? '继续提问…' : '问我任何问题，或输入 / 快搜…'}
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                autoComplete="off"
                spellCheck={false}
              />
              {raw && (
                <button type="button" onClick={() => { setRaw(''); setResults(null); inputRef.current?.focus() }}
                  className="shrink-0 text-slate-300 hover:text-slate-500" aria-label="Clear">✕</button>
              )}
              {!raw.startsWith('/') && (
                <button type="submit" disabled={!raw.trim() || chatLoading}
                  className="shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-40">
                  发送
                </button>
              )}
            </form>

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
          </div>
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
