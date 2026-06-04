import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, triggerScrape, getScrapeJob, searchByKeyword,
         listSavedSearches, createSavedSearch, deleteSavedSearch, runSavedSearch } from '../api/chinabidding';

const PREDEFINED_TAGS = ['georg', 'pomini', 'INNSE', 'DANIELI', 'SMS', 'VAI'];

const STATUS_STYLES = {
  PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED:    'bg-red-50 text-red-700 ring-1 ring-red-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
};

function BidProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [filters, setFilters] = useState({ biddingType: 'NEW', status: '' });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [scraping, setScraping] = useState(false);
  const [savedSearches, setSavedSearches] = useState([]);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [newSearchKeyword, setNewSearchKeyword] = useState('');
  const [runningSearchId, setRunningSearchId] = useState(null);

  useEffect(() => {
    fetchProjects();
    loadSavedSearches();
  }, []);

  const fetchProjects = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20, ...filters };
      const result = await getProjects(params);
      setProjects(result.data);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
    setLoading(false);
  };

  const loadSavedSearches = async () => {
    try { setSavedSearches(await listSavedSearches()); } catch {}
  };

  const handleCreateSearch = async () => {
    if (!newSearchName.trim() || !newSearchKeyword.trim()) return;
    try {
      await createSavedSearch({ name: newSearchName.trim(), keyword: newSearchKeyword.trim(), autoMonitor: true });
      setNewSearchName(''); setNewSearchKeyword('');
      loadSavedSearches();
    } catch (error) { console.error('Failed to create saved search:', error); }
  };

  const handleDeleteSearch = async (id) => {
    try { await deleteSavedSearch(id); loadSavedSearches(); } catch {}
  };

  const handleRunSearch = async (id) => {
    setRunningSearchId(id);
    try {
      const { jobId } = await runSavedSearch(id);
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const job = await getScrapeJob(jobId);
        if (job.status === 'DONE') { loadSavedSearches(); await fetchProjects(); break; }
        if (job.status === 'FAILED') { alert('Search failed: ' + (job.error || 'unknown')); break; }
      }
    } catch (error) { console.error('Failed to run search:', error); }
    setRunningSearchId(null);
  };

  const handleScrape = async () => {
    if (!confirm('Scrape latest data? This runs in the background and may take a minute.')) return;
    setScraping(true);
    try {
      const { jobId } = await triggerScrape(filters.biddingType);
      for (let i = 0; i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const job = await getScrapeJob(jobId);
        if (job.status === 'DONE') { await fetchProjects(); break; }
        if (job.status === 'FAILED') { alert('Scrape failed: ' + (job.error || 'unknown error')); break; }
      }
    } catch (error) {
      console.error('Scrape failed:', error);
      alert('Failed to start scrape');
    } finally {
      setScraping(false);
    }
  };

  const handlePageChange = (newPage) => { fetchProjects(newPage); };

  const handleTagClick = async (tag) => {
    setSearchLoading(true);
    setSearchKeyword(tag);
    try {
      const result = await searchByKeyword(tag);
      setProjects(result.data || []);
      setPagination({ page: 1, totalPages: 1, total: result.count || 0 });
    } catch (error) { console.error('Search failed:', error); }
    setSearchLoading(false);
  };

  const handleSearch = () => { if (searchKeyword.trim()) handleTagClick(searchKeyword.trim()); };

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
                  Track and analyse China bidding projects for sales opportunities and competitor activity.
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
                onClick={() => navigate('/chinabidding/stats')}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                Statistics
              </button>
              <button
                onClick={handleScrape}
                disabled={scraping}
                className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {scraping ? 'Scraping…' : 'Scrape Data'}
              </button>
            </div>
          </div>
        </header>

        {/* ── Keyword Subscriptions ───────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setShowSubscriptions(v => !v)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              Keyword Subscriptions
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{savedSearches.length}</span>
            </span>
            <svg className={`h-4 w-4 text-slate-400 transition-transform ${showSubscriptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSubscriptions && (
            <div className="border-t border-slate-100 px-5 py-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Subscription name (e.g. Georg competitor)"
                  value={newSearchName}
                  onChange={e => setNewSearchName(e.target.value)}
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition"
                />
                <input
                  placeholder="Keyword (e.g. georg)"
                  value={newSearchKeyword}
                  onChange={e => setNewSearchKeyword(e.target.value)}
                  className="flex-1 min-w-[140px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition"
                />
                <button
                  onClick={handleCreateSearch}
                  disabled={!newSearchName.trim() || !newSearchKeyword.trim()}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  + Add
                </button>
              </div>

              {savedSearches.length === 0 ? (
                <p className="text-sm text-slate-400">No subscriptions yet. Add one above to track keywords automatically.</p>
              ) : (
                <ul className="space-y-2">
                  {savedSearches.map(s => (
                    <li key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm text-slate-800">{s.name}</span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">"{s.keyword}"</span>
                        {s.lastRunAt && (
                          <span className="text-xs text-slate-400">last run {new Date(s.lastRunAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      <div className="flex gap-2 ml-3 shrink-0">
                        <button
                          onClick={() => handleRunSearch(s.id)}
                          disabled={runningSearchId === s.id}
                          className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                          {runningSearchId === s.id ? 'Running…' : '▶ Run'}
                        </button>
                        <button
                          onClick={() => handleDeleteSearch(s.id)}
                          className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── Filters & Quick Search ──────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {/* Quick-search tags */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Quick Search</span>
              {PREDEFINED_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => handleTagClick(tag)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    searchKeyword === tag
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="h-px bg-slate-100 sm:h-6 sm:w-px" />

            {/* Custom search */}
            <div className="flex gap-2">
              <input
                placeholder="Search keyword…"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition w-44"
              />
              <button
                onClick={handleSearch}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Search
              </button>
              {searchKeyword && (
                <button
                  onClick={() => { setSearchKeyword(''); fetchProjects(1); }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="h-px bg-slate-100 sm:h-6 sm:w-px" />

            {/* Type & status filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={filters.biddingType}
                onChange={e => setFilters({ ...filters, biddingType: e.target.value })}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition"
              >
                <option value="NEW">New Projects</option>
                <option value="PAST">Past Projects</option>
              </select>
              <select
                value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition"
              >
                <option value="">All Status</option>
                <option value="PUBLISHED">Published</option>
                <option value="CLOSED">Closed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <button
                onClick={() => fetchProjects(1)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Filter
              </button>
            </div>
          </div>
        </div>

        {/* ── Project Table ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {searchLoading || loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
              <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Project Name</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Region</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Published</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Deadline</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Budget</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {projects.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-sm text-slate-400">
                          No projects found. Try scraping latest data or adjusting filters.
                        </td>
                      </tr>
                    ) : projects.map((project, index) => (
                      <tr key={project.id || index} className="transition hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-800 max-w-sm">
                          <a
                            href={project.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-2 hover:text-blue-600 hover:underline"
                          >
                            {project.projectName || '—'}
                          </a>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{project.projectCode || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{project.region || '—'}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {project.publishDate ? new Date(project.publishDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {project.deadline ? (
                            <span className={new Date(project.deadline) < new Date() ? 'text-red-500 font-semibold' : 'text-slate-600'}>
                              {new Date(project.deadline).toLocaleDateString()}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{project.budget || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[project.status] || STATUS_STYLES.CANCELLED}`}>
                            {project.status || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
                <span className="text-slate-400">
                  {pagination.total} project{pagination.total !== 1 ? 's' : ''}
                  {searchKeyword ? ` matching "${searchKeyword}"` : ''}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1 || !!searchKeyword}
                    className="rounded-full border border-slate-200 px-4 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <span className="text-slate-500">
                    Page {pagination.page} / {pagination.totalPages || 1}
                  </span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages || !!searchKeyword}
                    className="rounded-full border border-slate-200 px-4 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default BidProjectList;
