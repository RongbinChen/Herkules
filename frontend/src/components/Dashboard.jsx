import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Card } from './ui'

const MODULES = [
  {
    path: '/calendar',
    icon: '📅',
    title: 'Calendar',
    desc: 'Create, view and manage your schedule',
    badge: 'bg-sky-50 text-sky-600 ring-sky-100',
  },
  {
    path: '/chinabidding',
    icon: '📋',
    title: 'ChinaBidding',
    desc: 'Scrape and analyze China bidding projects',
    badge: 'bg-amber-50 text-amber-600 ring-amber-100',
  },
  {
    path: '/hotprojects',
    icon: '🔥',
    title: 'Hot Projects',
    desc: 'Internal open & potential projects tracking (confidential)',
    badge: 'bg-orange-50 text-orange-600 ring-orange-100',
  },
  {
    path: '/customers',
    icon: '🤝',
    title: 'Customers',
    desc: 'Manage customers, tiers, tags and map',
    badge: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  },
  {
    path: '/trips',
    icon: '🗺️',
    title: 'Trips',
    desc: 'Auto-generate site-visit itineraries with map, shareable with anyone',
    badge: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  },
  {
    path: '/visit-reports',
    icon: '📝',
    title: 'Visit Reports',
    desc: 'Turn on-site notes & photos into AI-structured visit reports',
    badge: 'bg-rose-50 text-rose-600 ring-rose-100',
  },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Brand accent bar */}
      <div className="h-1 w-full bg-brand-600" />

      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex w-48 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
            <img src="/brand/hrc.png" alt="HERKULES" className="h-5 w-auto max-w-[44%] object-contain" />
            <div className="h-5 w-px shrink-0 bg-slate-200" />
            <img src="/brand/wasi.png" alt="WALDRICH SIEGEN" className="h-5 w-auto max-w-[44%] object-contain" />
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
