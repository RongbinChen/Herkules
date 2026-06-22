import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStatistics, getTrends, generateReport } from '../api/chinabidding';

function StatCard({ label, value, accent = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ? 'text-blue-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function Panel({ title, subtitle, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

// Simple horizontal bar list (no chart lib needed).
// onItemClick(name) — when provided, each label becomes a clickable link.
function BarList({ items, color = 'bg-blue-500', onItemClick = null }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <ul className="space-y-2">
      {items.map(i => (
        <li key={i.name} className="flex items-center gap-3 text-xs">
          {onItemClick ? (
            <button
              onClick={() => onItemClick(i.name)}
              title={`查看「${i.name}」的项目`}
              className="w-36 shrink-0 truncate text-left text-slate-600 hover:text-blue-600 hover:underline"
            >
              {i.name}
            </button>
          ) : (
            <span className="w-36 shrink-0 truncate text-slate-600" title={i.name}>{i.name}</span>
          )}
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <div className={`h-full rounded ${color}`} style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right font-semibold text-slate-700">{i.count}</span>
        </li>
      ))}
      {items.length === 0 && <li className="text-xs text-slate-400">暂无数据</li>}
    </ul>
  );
}

// Monthly trend column chart (SVG). onBarClick(month) makes bars clickable.
function MonthlyChart({ monthly, onBarClick = null }) {
  if (!monthly || monthly.length === 0) return <p className="text-xs text-slate-400">暂无数据</p>;
  const W = 640, H = 180, PAD = 24;
  const max = Math.max(...monthly.map(m => m.total), 1);
  const bw = (W - PAD * 2) / monthly.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full">
      {monthly.map((m, i) => {
        const h = (m.total / max) * H;
        return (
          <g key={m.month} onClick={onBarClick ? () => onBarClick(m.month) : undefined} className={onBarClick ? 'cursor-pointer' : ''}>
            {onBarClick && (
              <rect x={PAD + i * bw} y={0} width={bw} height={H} className="fill-transparent" />
            )}
            <rect
              x={PAD + i * bw + bw * 0.15} y={H - h}
              width={bw * 0.7} height={h}
              rx="3" className="fill-blue-500/80 hover:fill-blue-600"
            >
              <title>{m.month}: {m.total} 项目（点击查看）</title>
            </rect>
            <text x={PAD + i * bw + bw / 2} y={H - h - 5} textAnchor="middle" className="fill-slate-600 text-[11px] font-semibold">
              {m.total}
            </text>
            <text x={PAD + i * bw + bw / 2} y={H + 16} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {m.month.slice(2).replace('-', '/')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BidStatistics() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState(null);
  const [months, setMonths] = useState(12);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    getStatistics().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    setTrends(null);
    getTrends(months).then(setTrends).catch(console.error);
  }, [months]);

  const handleGenerateReport = async () => {
    setReportLoading(true);
    try { setReport(await generateReport()); }
    catch (err) { console.error('Report failed:', err); alert('简报生成失败，请重试'); }
    setReportLoading(false);
  };

  const loading = (
    <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-24 text-sm text-slate-400 shadow-sm">
      <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Loading…
    </div>
  );

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
                <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-slate-400">Market Intelligence</p>
                <p className="text-[1rem] font-medium leading-6 text-slate-700 sm:text-[1.08rem]">
                  中国市场招投标趋势、竞争对手动态与销售机会分析
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
              <button
                onClick={handleGenerateReport}
                disabled={reportLoading}
                className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {reportLoading ? '⟳ 生成中…' : '✦ AI 市场简报'}
              </button>
            </div>
          </div>
        </header>

        {/* ── AI Market Report ───────────────────────────────────────── */}
        {report && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm font-bold text-blue-800">✦ AI 市场简报（近 6 个月，基于 {report.basedOn?.projects ?? '-'} 个项目）</h3>
              <button onClick={() => setReport(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
              {report.report || '（生成失败）'}
            </div>
            <p className="mt-3 text-xs text-slate-400">生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')} · 由 DeepSeek 生成，仅供参考</p>
          </div>
        )}

        {!stats ? loading : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total Projects" value={stats.total} accent />
            <StatCard label="New This Week" value={stats.recentCount} />
            <StatCard label="New Tenders" value={stats.newProjects} />
            <StatCard label="Past Tenders" value={stats.pastProjects} />
            <StatCard label="Published" value={stats.publishedCount} />
            <StatCard label="Closed" value={stats.closedCount} />
          </div>
        )}

        {/* ── Time range selector ────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">统计周期</span>
          {[3, 6, 12, 24].map(m => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                months === m
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {m} 个月
            </button>
          ))}
        </div>

        {!trends ? loading : (
          <>
            {/* ── Monthly trend ──────────────────────────────────────── */}
            <Panel title="月度招标趋势" subtitle={`近 ${months} 个月共 ${trends.totalProjects} 个相关项目（按公告发布日期）`}>
              <MonthlyChart monthly={trends.monthly}
                onBarClick={(month) => navigate(`/chinabidding?month=${month}`)} />
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* ── Equipment types ──────────────────────────────────── */}
              <Panel title="设备类型分布" subtitle="DeepSeek 自动分类">
                <BarList items={trends.equipmentTypes} color="bg-blue-500"
                  onItemClick={(name) => navigate(`/chinabidding?equipmentType=${encodeURIComponent(name)}`)} />
              </Panel>

              {/* ── Win ranking ──────────────────────────────────────── */}
              <Panel title="中标排行" subtitle="基于中标公告自动匹配（🏆 本集团 / ⚔️ 竞争对手 / 👀 关注公司）">
                <ul className="space-y-3">
                  {trends.competitorStats.filter(c => c.winCount > 0).map(c => {
                    const own = c.watchType === 'OWN';
                    const interest = c.watchType === 'INTEREST';
                    const icon = own ? '🏆' : interest ? '👀' : '⚔️';
                    const cardCls = own ? 'border-emerald-200 bg-emerald-50/60'
                      : interest ? 'border-sky-200 bg-sky-50/60'
                      : 'border-slate-100 bg-slate-50/60';
                    const badgeCls = own ? 'bg-emerald-50 text-emerald-600 ring-emerald-200'
                      : interest ? 'bg-sky-50 text-sky-600 ring-sky-200'
                      : 'bg-red-50 text-red-600 ring-red-200';
                    return (
                    <li key={c.id} className={`rounded-xl border px-4 py-3 ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                          <span>{icon}</span>{c.name}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${badgeCls}`}>
                          中标 {c.winCount} 次
                        </span>
                      </div>
                      {c.country && <p className="text-xs text-slate-400">{c.country}</p>}
                      {c.recentWins.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {c.recentWins.slice(0, 3).map(w => (
                            <li key={w.id} className="truncate text-xs text-slate-500">
                              <a href={w.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                                · {w.projectName}
                              </a>
                              {w.winningPrice && <span className="ml-1 text-emerald-600">（{w.winningPrice}）</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                  })}
                  {trends.competitorStats.filter(c => c.winCount > 0).length === 0 && (
                    <li className="text-xs text-slate-400">统计周期内暂无中标记录</li>
                  )}
                </ul>
              </Panel>

              {/* ── Active purchasers ────────────────────────────────── */}
              <Panel title="活跃采购单位" subtitle="潜在客户清单（按招标次数）">
                <BarList items={trends.topPurchasers} color="bg-emerald-500"
                  onItemClick={(name) => navigate(`/chinabidding?purchaser=${encodeURIComponent(name)}`)} />
              </Panel>

              {/* ── Regions ──────────────────────────────────────────── */}
              <Panel title="地区分布" subtitle="按项目实施地">
                <BarList items={trends.topRegions} color="bg-amber-500"
                  onItemClick={(name) => navigate(`/chinabidding?region=${encodeURIComponent(name)}`)} />
              </Panel>
            </div>

            {/* ── Upcoming deadlines ─────────────────────────────────── */}
            <Panel title="⏰ 即将截止的招标（销售机会）" subtitle="按截止日期排序">
              {trends.upcomingDeadlines.length === 0 ? (
                <p className="text-xs text-slate-400">暂无未截止的招标项目</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {trends.upcomingDeadlines.map(p => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      {p.sourceUrl ? (
                        <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 hover:text-blue-600 hover:underline">
                          {p.projectName}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{p.projectName}</span>
                      )}
                      <div className="flex shrink-0 items-center gap-2">
                        {p.equipmentType && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600">{p.equipmentType}</span>
                        )}
                        <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-500">
                          截止 {new Date(p.deadline).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

export default BidStatistics;
