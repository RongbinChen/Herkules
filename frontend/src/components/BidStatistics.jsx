import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStatistics } from '../api/chinabidding';

function StatCard({ label, value, accent = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ? 'text-blue-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function BidStatistics() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getStatistics().then(setStats).catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_26%),linear-gradient(180deg,_#f8fafc,_#e2e8f0)] px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">

        {/* ── Header banner ──────────────────────────────────────────── */}
        <header className="banner-simple relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-4 md:px-7">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
                <div className="flex items-center rounded-lg bg-white px-2 py-1.5">
                  <img src="/brand/hrc.png" alt="HRC logo" className="h-8 w-auto object-contain sm:h-9" />
                </div>
                <div className="h-8 w-px bg-slate-200 sm:h-9" />
                <div className="flex items-center rounded-lg bg-white px-2 py-1.5">
                  <img src="/brand/wasi.png" alt="WASI logo" className="h-8 w-auto object-contain sm:h-9" />
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-slate-400">Tender Intelligence</p>
                <p className="text-[1rem] font-medium leading-6 text-slate-700 sm:text-[1.08rem]">
                  Statistics and regional breakdown of collected bidding projects.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 xl:justify-end">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Modules
              </button>
              <button
                onClick={() => navigate('/chinabidding')}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                ← Project List
              </button>
            </div>
          </div>
        </header>

        {!stats ? (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-24 text-sm text-slate-400 shadow-sm">
            <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading statistics…
          </div>
        ) : (
          <>
            {/* ── KPI cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total Projects" value={stats.total} accent />
              <StatCard label="New This Week"  value={stats.recentCount} />
              <StatCard label="New Projects"   value={stats.newProjects} />
              <StatCard label="Past Projects"  value={stats.pastProjects} />
              <StatCard label="Published"      value={stats.publishedCount} />
              <StatCard label="Closed"         value={stats.closedCount} />
            </div>

            {/* ── Top regions table ──────────────────────────────────── */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Top 10 Regions</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">#</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Region</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Projects</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.topRegions.map((item, index) => (
                      <tr key={index} className="transition hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-400 tabular-nums">{index + 1}</td>
                        <td className="px-5 py-3 font-medium text-slate-800">{item.region || '—'}</td>
                        <td className="px-5 py-3 text-right">
                          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                            {item.count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default BidStatistics;
