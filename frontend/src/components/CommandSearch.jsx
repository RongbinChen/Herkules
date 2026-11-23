import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchAPI, visitReportsAPI, assistantAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import useContractUnlock from '../hooks/useContractUnlock'
import DeleteReportButton from './visit-report/DeleteReportButton'
import { useVRLang } from '../i18n/visitReports'
import { statusMeta, tierMeta } from '../constants/customer'
import ChatThread from './chat/ChatThread'
import ChatComposer from './chat/ChatComposer'
import SourceCards from './chat/SourceCards'
import {
  COMMANDS, CMD_BY_KEY, parseInput, resultHref, examplesForLang, TOOL_LABEL,
} from '../utils/commandSearch'
import { resolveReplyLang } from '../../../shared/assistantLang.js'

const STAGE_LABEL = { TENDER: 'Tender', CHANGE: 'Change', EVALUATION: 'Evaluation', AWARD: 'Award' }
const OUR_STATUS = {
  WATCHING: 'Watching', PREPARING: 'Preparing', SUBMITTED: 'Submitted', SHORTLISTED: 'Shortlisted',
  WON: 'Won', LOST: 'Lost', ABANDONED: 'Abandoned',
}
const fmtDate = (d) => { try { return new Date(d).toISOString().slice(0, 10) } catch { return '' } }

function toChatMessage(m) {
  return {
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    steps: m.steps || [],
    sources: m.sources || [],
    suggestions: m.suggestions || [],
    isError: false,
    redacted: m.redacted === true,
  }
}

export default function CommandSearch() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reportLang] = useVRLang()
  const { unlock, team, setTeam, doUnlock, lock, busy, error: pinError, setError: setPinError } = useContractUnlock()
  const inputRef = useRef(null)
  const [raw, setRaw] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(null)
  const [chat, setChat] = useState([])
  const [chatLoading, setChatLoading] = useState(false)
  const [lang, setLang] = useState(() => localStorage.getItem('assistantLang') || 'auto')
  const pickLang = (v) => { setLang(v); localStorage.setItem('assistantLang', v) }
  const [threadId, setThreadId] = useState(null)
  const [threads, setThreads] = useState([])
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')

  const parsed = parseInput(raw)

  useEffect(() => {
    let ignore = false
    assistantAPI.listThreads().then(async ({ data }) => {
      if (ignore) return
      const list = data || []
      setThreads(list)
      if (!list.length) return
      const { data: thread } = await assistantAPI.getThread(list[0].id, unlock?.token, lang === 'auto' ? undefined : lang)
      if (ignore) return
      setThreadId(thread.id)
      setChat((thread.messages || []).map(toChatMessage))
    }).catch(() => {})
    return () => { ignore = true }
    // Load once on mount; unlock/lang refetch is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!threadId) return
    let ignore = false
    assistantAPI.getThread(threadId, unlock?.token, lang === 'auto' ? undefined : lang)
      .then(({ data }) => {
        if (ignore) return
        setChat((data.messages || []).map(toChatMessage))
      })
      .catch(() => {})
    return () => { ignore = true }
  }, [unlock?.token, threadId, lang])

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
        next.filter((m) => m.role === 'user' || m.role === 'assistant').map(({ role, content }) => ({ role, content })),
        lang === 'auto' ? undefined : lang,
        { threadId, token: unlock?.token },
      )
      if (data.threadId && data.threadId !== threadId) setThreadId(data.threadId)
      setChat([...next, {
        role: 'assistant',
        content: data.reply,
        steps: data.steps || [],
        sources: data.sources || [],
        suggestions: data.suggestions || [],
        redacted: data.redacted === true,
      }])
      assistantAPI.listThreads().then((r) => setThreads(r.data || [])).catch(() => {})
    } catch (e) {
      setChat([...next, { role: 'assistant', content: e.response?.data?.error || 'The assistant is temporarily unavailable, please retry.', isError: true }])
    } finally {
      setChatLoading(false)
    }
  }

  async function startFresh() {
    try {
      const { data } = await assistantAPI.createThread()
      setThreadId(data.id)
      setChat([])
      setResults(null)
      setRaw('')
      assistantAPI.listThreads().then((r) => setThreads(r.data || [])).catch(() => {})
    } catch {
      setThreadId(null)
      setChat([])
    }
  }

  async function openThread(id) {
    try {
      const { data } = await assistantAPI.getThread(id, unlock?.token, lang === 'auto' ? undefined : lang)
      setThreadId(data.id)
      setChat((data.messages || []).map(toChatMessage))
    } catch {
      setError('Failed to open conversation')
    }
  }

  async function submitPin(e) {
    e.preventDefault()
    setPinError('')
    if (await doUnlock(pin.trim(), team)) {
      setPin('')
      setPinOpen(false)
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
  const examples = examplesForLang(lang)
  const replyLang = resolveReplyLang(lang === 'auto' ? undefined : lang, chat)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-4 sm:py-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => navigate('/')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            ← Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold shadow-sm">
              {[{ k: 'auto', t: 'Auto' }, { k: 'zh', t: '中文' }, { k: 'en', t: 'EN' }].map((o) => (
                <button key={o.k} onClick={() => pickLang(o.k)} title="AI 回复语言 / Reply language"
                  className={`px-3 py-1.5 transition ${lang === o.k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {o.t}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPinOpen((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                unlock ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}>
              {unlock ? `🔓 ${unlock.team}` : '🔒 PIN'}
            </button>
            {threads.length > 0 && (
              <select
                value={threadId || ''}
                onChange={(e) => { const id = Number(e.target.value); if (id) openThread(id) }}
                className="max-w-[10rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
                title="Conversations"
              >
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>{t.title || 'Conversation'}</option>
                ))}
              </select>
            )}
            {(chat.length > 0 || threadId) && (
              <button onClick={startFresh}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50">
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {pinOpen && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            {unlock ? (
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>{unlock.team} contracts are unlocked in this tab. Ask AI can answer contract questions and show follow-up amounts for this team.</span>
                <button type="button" onClick={() => { lock(); setPinOpen(false) }}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-500 hover:bg-slate-50">Lock</button>
              </div>
            ) : (
              <form onSubmit={submitPin} className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-slate-500">
                  Team
                  <select value={team} onChange={(e) => setTeam(e.target.value)}
                    className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                    <option value="HRC">HRC</option>
                    <option value="WRC">WRC</option>
                  </select>
                </label>
                <label className="min-w-[8rem] flex-1 text-xs font-semibold text-slate-500">
                  Team PIN
                  <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off"
                    className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                </label>
                <button type="submit" disabled={!pin.trim() || busy}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                  {busy ? 'Checking…' : 'Unlock'}
                </button>
                {pinError && <p className="w-full text-xs text-rose-600">{pinError}</p>}
              </form>
            )}
          </div>
        )}

        {showWelcome && (
          <div className="mb-4">
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">✦ AI Assistant</h1>
            <p className="mt-1 text-sm text-slate-500">
              Ask anything — I answer from real workspace data (customers, tenders, bid openings,
              hot projects, visit reports, trips, calendar, due reminders, project follow-up,
              GMT field service, and contracts after you unlock the team PIN)
              and can create calendar events.
              Slash commands ({COMMANDS.map((c) => (
                <code key={c.key} className="mx-0.5 rounded bg-slate-100 px-1 font-mono text-slate-600">{c.label}</code>
              ))}) still work for instant search.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {examples.map((ex) => (
                <button key={ex} onClick={() => send(ex)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50/40">
                  💬 {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.length > 0 && (
          <ChatThread
            messages={chat}
            loading={chatLoading}
            loadingLabel="Querying data…"
            className="mb-4"
            renderMeta={(m) => (
              <>
                {m.steps?.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-50 pt-2">
                    <span className="text-[10px] text-slate-300">Queried</span>
                    {m.steps.map((s, si) => (
                      <span key={si} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {TOOL_LABEL[s.tool] || s.tool}{s.count != null ? ` ${s.count}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <SourceCards sources={m.sources} lang={replyLang} />
                {m.suggestions?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.suggestions.map((s) => (
                      <button key={s.key || s.prompt} type="button" onClick={() => send(s.prompt)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50">
                        {s.prompt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          />
        )}

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
                      <CustomerCard key={c.id} c={c} onOpen={() => navigate(resultHref('customer', c))} />
                    ))}
                    {results.type === 'project' && results.results.map((p) => (
                      <ProjectCard key={p.threadKey} p={p} onOpen={() => navigate(resultHref('project', p))}
                        onCustomer={(cid) => navigate(`/customers/${cid}?from=search`)} />
                    ))}
                    {results.type === 'report' && results.results.map((r) => (
                      <ReportCard key={r.id} r={r} onOpen={() => navigate(resultHref('report', r))}
                        onCustomer={(cid) => navigate(`/customers/${cid}?from=search`)}
                        onDownload={() => downloadReport(r)} downloading={downloading === r.id}
                        user={user}
                        lang={reportLang}
                        onDeleted={(deleted) => setResults((prev) => (
                          prev && prev.type === 'report'
                            ? { ...prev, results: prev.results.filter((row) => row.id !== deleted.id) }
                            : prev
                        ))}
                      />
                    ))}
                    {results.type === 'followup' && results.results.map((f) => (
                      <SimpleCard key={f.id} title={f.title} href={resultHref('followup', f)}
                        meta={[f.customer?.name, f.status, f.orderNo, f.owner?.name].filter(Boolean)} />
                    ))}
                    {results.type === 'trip' && results.results.map((t) => (
                      <SimpleCard key={t.id} title={t.title} href={resultHref('trip', t)}
                        meta={[fmtDate(t.startTime), (t.assignees || []).map((a) => a.name).join(', ')].filter(Boolean)} />
                    ))}
                    {results.type === 'hot' && results.results.map((h) => (
                      <SimpleCard key={h.id} title={h.customer || `Hot project ${h.id}`} href={resultHref('hot', h)}
                        meta={[h.category, h.machineType, h.processor, h.priority].filter(Boolean)} />
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        )}

        <ChatComposer
          value={raw}
          onChange={setRaw}
          onSubmit={send}
          inputRef={inputRef}
          placeholder={chat.length ? 'Ask a follow-up…' : 'Ask anything, or type / for quick search…'}
          onClear={() => { setRaw(''); setResults(null) }}
          showSend={!raw.startsWith('/')}
          sendDisabled={!raw.trim() || chatLoading}
          leftSlot={parsed.mode === 'search' && CMD_BY_KEY[parsed.type] && (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
              {CMD_BY_KEY[parsed.type].icon} {parsed.type}
            </span>
          )}
        >
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

function SimpleCard({ title, href, meta = [] }) {
  const navigate = useNavigate()
  return (
    <button onClick={() => href && navigate(href)}
      className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm">
      <span className="block font-semibold text-slate-800">{title}</span>
      {meta.length > 0 && (
        <span className="mt-1 block truncate text-xs text-slate-400">{meta.join(' · ')}</span>
      )}
    </button>
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

function ReportCard({ r, onOpen, onCustomer, onDownload, downloading, user, lang, onDeleted }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left font-semibold text-slate-800 hover:text-brand-600">
          {r.title}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <DeleteReportButton report={r} user={user} lang={lang} onDeleted={onDeleted} />
          <button onClick={onDownload} disabled={downloading}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            {downloading ? '…' : '⬇ Word'}
          </button>
        </div>
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
