import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { eventsAPI } from '../api/api'
import { listProjectThreads } from '../api/chinabidding'
import { Button, Card } from './ui'

// Lifecycle stage → compact badge for the Watching panel.
const WATCH_STAGES = {
  TENDER: { en: 'Tender', cls: 'bg-sky-50 text-sky-600' },
  CHANGE: { en: 'Change', cls: 'bg-slate-100 text-slate-500' },
  EVALUATION: { en: 'Evaluation', cls: 'bg-indigo-50 text-indigo-600' },
  AWARD: { en: 'Award', cls: 'bg-emerald-50 text-emerald-600' },
}

// One watched project row: stage, name, purchaser, deadline. Click → tracking board.
function WatchingRow({ t }) {
  const navigate = useNavigate()
  const stage = WATCH_STAGES[t.currentStage] || null
  const deadline = t.deadline ? new Date(t.deadline) : null
  const overdue = deadline && deadline < new Date()
  // At EVALUATION the date is the end of the public-notice window — the last
  // day to object, not a bid deadline. Same field, different meaning.
  const dueLabel = t.currentStage === 'EVALUATION' ? 'Objection until' : 'Deadline'
  return (
    <li>
      <button
        // threadKey, not projectCode: the tracking page groups by threadKey and
        // its search box never looked at projectCode, so this used to land on an
        // empty list. projectCode is also unreliable here — when the detail page
        // yields no bidding number it falls back to the URL slug, which matches
        // nothing anywhere ("263250845-BidResult").
        onClick={() => navigate(`/chinabidding/tracking?q=${encodeURIComponent(t.threadKey || t.projectName || '')}`)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition hover:bg-brand-50/50"
      >
        {/* Mobile: badges on line 1, full project name wraps on line 2; ≥sm: single truncated row */}
        {stage ? (
          <span className={`order-1 min-w-[5.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold ${stage.cls}`}>
            {stage.en}{t.retendered ? ' ↻' : ''}
          </span>
        ) : (
          <span className="order-1 min-w-[5.5rem] shrink-0" aria-hidden="true" />
        )}
        <span className="order-3 w-full min-w-0 text-sm font-medium text-slate-700 sm:order-2 sm:w-auto sm:flex-1 sm:truncate" title={t.projectName}>
          {t.projectName}
          {t.purchaser && <span className="ml-2 hidden text-xs text-slate-400 sm:inline">{t.purchaser}</span>}
        </span>
        {deadline && (
          <span className={`order-2 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold sm:order-3 ${overdue ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-600'}`}>
            {dueLabel} {deadline.toISOString().slice(0, 10)}
          </span>
        )}
      </button>
    </li>
  )
}

const MODULES = [
  {
    path: '/calendar',
    icon: '📅',
    title: 'Calendar',
    desc: 'Create, view and manage your schedule',
    badge: 'bg-sky-50 text-sky-600 ring-sky-100',
  },
  {
    path: '/hotprojects',
    icon: '🔥',
    title: 'Hot Projects',
    desc: 'Internal open & potential projects tracking (confidential)',
    badge: 'bg-orange-50 text-orange-600 ring-orange-100',
  },
  {
    path: '/visit-reports',
    icon: '📝',
    title: 'Visit Reports',
    desc: 'Turn on-site notes & photos into AI-structured visit reports',
    badge: 'bg-rose-50 text-rose-600 ring-rose-100',
  },
  {
    path: '/customers',
    icon: '🤝',
    title: 'Customers',
    desc: 'Manage customers, tiers, tags and map',
    badge: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  },
  {
    // Visible to everyone: the PIN is the gate, not the tile. Hiding the
    // entrance would only mean people never learn the module exists.
    path: '/contracts',
    icon: '📁',
    title: 'Contracts',
    desc: 'Commercial contracts, technical agreements, quotations, FAT & FAC — behind a team PIN',
    badge: 'bg-slate-100 text-slate-600 ring-slate-200',
  },
  {
    path: '/trips',
    icon: '🗺️',
    title: 'Trips',
    desc: 'Auto-generate site-visit itineraries with map, shareable with anyone',
    badge: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  },
  {
    // Bid Opening lives under ChinaBidding as a tab, but it is a destination in
    // its own right — people come to record or look up an opening result, not
    // to browse scraped tenders. Sitting next to ChinaBidding keeps that
    // relationship visible.
    path: '/chinabidding/bidopen',
    icon: '🔨',
    title: 'Bid Opening',
    desc: 'Record and compare bid opening results, shareable with anyone',
    badge: 'bg-violet-50 text-violet-600 ring-violet-100',
  },
  {
    path: '/chinabidding',
    icon: '📋',
    title: 'ChinaBidding',
    desc: 'Scrape and analyze China bidding projects',
    badge: 'bg-amber-50 text-amber-600 ring-amber-100',
  },
]

// One due reminder row with owner actions: done / postpone / delete.
function ReminderRow({ ev, onResolved }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [pickDate, setPickDate] = useState(false)
  const overdue = new Date(ev.start) < new Date()

  const resolve = async (action, newDate) => {
    setBusy(true)
    try {
      await eventsAPI.resolveReminder(ev.id, { action, newDate })
      onResolved(ev.id)
    } catch {
      window.alert('Action failed, please retry')
    } finally { setBusy(false) }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${overdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
        {new Date(ev.start).toISOString().slice(0, 10)}{overdue ? ' · overdue' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={ev.title}>
        {ev.title}
        {ev.customer && <span className="ml-2 text-xs text-slate-400">🤝 {ev.customer.name}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {ev.visitReportId && (
          <button onClick={() => navigate(`/visit-reports/${ev.visitReportId}`)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">📝</button>
        )}
        <button disabled={busy} onClick={() => resolve('done')}
          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">✓ Done</button>
        {!pickDate ? (
          <button disabled={busy} onClick={() => setPickDate(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">↻ Postpone</button>
        ) : (
          <input type="date" autoFocus disabled={busy}
            className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs"
            onChange={(e) => { if (e.target.value) resolve('postpone', e.target.value) }}
            onBlur={() => setPickDate(false)} />
        )}
        <button disabled={busy} onClick={() => resolve('hold')}
          title="Keep the reminder without a due date — it leaves this list but stays on record (on hold)"
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">⏸ No timeframe</button>
        <button disabled={busy} onClick={() => { if (window.confirm('Delete this reminder?')) resolve('delete') }}
          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50">🗑</button>
      </span>
    </li>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [reminders, setReminders] = useState([])
  const [watching, setWatching] = useState([])
  useEffect(() => {
    eventsAPI.dueReminders().then((r) => setReminders(r.data || [])).catch(() => {})
    listProjectThreads({ ourStatus: 'WATCHING' }).then((t) => setWatching(t || [])).catch(() => {})
  }, [])
  const onResolved = (id) => setReminders((prev) => prev.filter((e) => e.id !== id))

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Brand accent bar */}
      <div className="h-1 w-full bg-brand-600" />

      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-3 sm:px-6">
          {/* Sized by height, not by a fixed container width. The two marks have
              very different aspect ratios (395x97 and 261x48), so the old
              w-48 + max-w-[44%] pair silently squashed WALDRICH below the shared
              h-5 — they were not even the same height on screen. */}
          <div className="flex shrink-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <img src="/brand/hrc.png" alt="HERKULES" className="h-5 w-auto object-contain sm:h-9" />
            <div className="h-5 w-px shrink-0 bg-slate-200 sm:h-9" />
            <img src="/brand/wasi.png" alt="WALDRICH SIEGEN" className="h-5 w-auto object-contain sm:h-9" />
          </div>
          <div className="flex items-center gap-3">
            {user?.name && <span className="hidden text-sm text-slate-500 sm:inline">{user.name}</span>}
            <Button variant="secondary" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
            Herkules China · Sales Workspace
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : 'Welcome'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Select a module to get started.</p>
        </div>

        {/* Due reminders — owner decides: done / postpone / delete */}
        {reminders.length > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3 shadow-sm sm:mb-8">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">⏰ Reminders due — your decision</h2>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">{reminders.length}</span>
            </div>
            <ul className="divide-y divide-amber-100">
              {reminders.map((ev) => <ReminderRow key={ev.id} ev={ev} onResolved={onResolved} />)}
            </ul>
          </div>
        )}

        {/* Watching projects — the bids we're actively monitoring, front and center */}
        {watching.length > 0 && (
          <div className="mb-6 rounded-2xl border-2 border-brand-200 bg-white px-4 py-3 shadow-sm sm:mb-8">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                👁 Watching Projects
                <span className="ml-2 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-700">{watching.length}</span>
              </h2>
              <button
                onClick={() => navigate('/chinabidding/tracking?ourStatus=WATCHING')}
                className="text-xs font-semibold text-brand-600 hover:underline"
              >
                View all →
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {watching.slice(0, 5).map((t) => <WatchingRow key={t.threadKey} t={t} />)}
            </ul>
            {watching.length > 5 && (
              <div className="pt-1 text-xs text-slate-400">+{watching.length - 5} more — View all</div>
            )}
          </div>
        )}

        {/* Unified command search launcher */}
        <button
          onClick={() => navigate('/search')}
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md sm:mb-8"
        >
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <span className="text-sm text-slate-400">
            ✦ Ask AI — 客户 / 招投标 / 拜访报告 / 日历 · or type
            {' '}<code className="rounded bg-slate-100 px-1 font-mono text-brand-700">/customer</code>
            {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-500">/project</code>
            {' '}<code className="rounded bg-slate-100 px-1 font-mono text-slate-500">/report</code>
          </span>
        </button>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Card
              key={m.path}
              as="button"
              hover
              onClick={() => navigate(m.path)}
              className="group flex items-start gap-4 p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 hover:border-brand-200"
            >
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ring-1 ${m.badge}`}>
                {m.icon}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-semibold text-slate-800">
                  {m.title}
                  <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600">→</span>
                </span>
                <span className="mt-1 block text-sm leading-snug text-slate-500">{m.desc}</span>
              </span>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
