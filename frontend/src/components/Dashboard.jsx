import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <span className="font-semibold text-slate-800">Herkules</span>
          </div>
          <div className="flex items-center gap-3">
            {user?.name && <span className="hidden text-sm text-slate-500 sm:inline">{user.name}</span>}
            <button
              onClick={logout}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : 'Welcome'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Select a module to get started.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <button
              key={m.path}
              onClick={() => navigate(m.path)}
              className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
            >
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ring-1 ${m.badge}`}>
                {m.icon}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-semibold text-slate-800">
                  {m.title}
                  <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500">→</span>
                </span>
                <span className="mt-1 block text-sm leading-snug text-slate-500">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
