import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getProjects, getScrapeJob, searchByKeyword,
         listSavedSearches, createSavedSearch, deleteSavedSearch, runSavedSearch,
         getUpdates, runDailyJob,
         getProjectThread, listFollows, followProject, unfollowProject,
         listNotifications, markNotificationRead, markAllNotificationsRead } from '../api/chinabidding';

const PREDEFINED_TAGS = ['georg', 'pomini', 'INNSE', 'Waldrich Coburg', 'DANIELI', 'SMS', 'VAI'];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS  =  7 * 24 * 60 * 60 * 1000;
// NEW = publishDate within 30 days (recently published tender)
const isNewProject = p => p.publishDate && (Date.now() - new Date(p.publishDate).getTime()) < THIRTY_DAYS_MS;
const isUpdated    = p => p.lastStatusChange && (Date.now() - new Date(p.lastStatusChange).getTime()) < SEVEN_DAYS_MS;

// "YYYY-MM" → { startDate, endDate } covering that whole month (inclusive)
function monthToRange(month) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return { startDate: '', endDate: '' };
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const STATUS_STYLES = {
  PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED:    'bg-red-50 text-red-700 ring-1 ring-red-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
};

// Chinabidding announcement categories (matches the site's filter tabs).
const CATEGORY_BADGE = {
  'New Tenders':        'bg-blue-500 text-white',
  'Tender Changes':     'bg-orange-500 text-white',
  'Evaluation Results': 'bg-violet-500 text-white',
  'Tender Awards':      'bg-emerald-600 text-white',
};

// Resolve a project's Chinabidding category from infoClass, falling back to the
// binary biddingType when infoClass is unknown.
function categoryOf(project) {
  if (project.infoClass && CATEGORY_BADGE[project.infoClass]) return project.infoClass;
  return project.biddingType === 'NEW' ? 'New Tenders' : 'Tender Awards';
}

function BidTypeBadge({ project }) {
  const label = categoryOf(project);
  const cls = CATEGORY_BADGE[label] || 'bg-slate-500 text-white';
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function BidProjectList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  // Filters may be pre-set via URL query (deep links from the Statistics page):
  // ?equipmentType= / ?purchaser= / ?region= / ?month=YYYY-MM
  const monthParam = searchParams.get('month') || '';
  const monthRange = monthParam ? monthToRange(monthParam) : { startDate: '', endDate: '' };
  const [filters, setFilters] = useState({
    biddingType: '', status: '',
    equipmentType: searchParams.get('equipmentType') || '',
    purchaser: searchParams.get('purchaser') || '',
    region: searchParams.get('region') || '',
    startDate: monthRange.startDate,
    endDate: monthRange.endDate,
  });
  const [periodLabel, setPeriodLabel] = useState(monthParam); // display-only chip label
  const [searchKeyword, setSearchKeyword] = useState('');

  const [savedSearches, setSavedSearches] = useState([]);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [newSearchKeyword, setNewSearchKeyword] = useState('');
  const [runningSearchId, setRunningSearchId] = useState(null);
  const [updates, setUpdates] = useState({ newProjects: [], statusChanged: [] });
  const [showUpdates, setShowUpdates] = useState(false);
  const [dailyRunning, setDailyRunning] = useState(false);
  const [dailyStatus, setDailyStatus] = useState('');
  const [searchPhase, setSearchPhase] = useState(''); // 'live' | 'done' | ''

  // Follows / notifications / thread timeline
  const [followedIds, setFollowedIds] = useState(new Set());
  const [notif, setNotif] = useState({ items: [], unreadCount: 0 });
  const [showNotif, setShowNotif] = useState(false);
  const [threadData, setThreadData] = useState(null); // { project, thread } | null
  const [threadLoading, setThreadLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
    loadSavedSearches();
    loadUpdates();
    loadFollows();
    loadNotifications();
  }, []);

  const loadUpdates = async () => {
    try { setUpdates(await getUpdates(7)); } catch {}
  };

  const loadFollows = async () => {
    try {
      const follows = await listFollows();
      setFollowedIds(new Set(follows.map(f => f.projectId)));
    } catch {}
  };

  const loadNotifications = async () => {
    try { setNotif(await listNotifications()); } catch {}
  };

  const toggleFollow = async (projectId) => {
    try {
      if (followedIds.has(projectId)) {
        await unfollowProject(projectId);
        setFollowedIds(prev => { const s = new Set(prev); s.delete(projectId); return s; });
      } else {
        await followProject(projectId);
        setFollowedIds(prev => new Set(prev).add(projectId));
      }
    } catch (error) { console.error('Failed to toggle follow:', error); }
  };

  const openThread = async (projectId) => {
    setThreadLoading(true);
    try { setThreadData(await getProjectThread(projectId)); }
    catch (error) { console.error('Failed to load thread:', error); }
    setThreadLoading(false);
  };

  const handleNotifClick = async (n) => {
    if (!n.readAt) {
      try { await markNotificationRead(n.id); loadNotifications(); } catch {}
    }
    if (n.project?.sourceUrl) window.open(n.project.sourceUrl, '_blank');
  };

  const handleMarkAllRead = async () => {
    try { await markAllNotificationsRead(); loadNotifications(); } catch {}
  };

  const fetchProjects = async (page = 1, filterOverride = null) => {
    setLoading(true);
    try {
      const params = { page, limit: 20, ...filters, ...(filterOverride || {}) };
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

  const handleRunDaily = async () => {
    if (!confirm('Run full data refresh?\n\nThis will scrape Machining + Medical + 机床 + 磨床 + all your keyword subscriptions. It runs in the background and may take several minutes.')) return;
    setDailyRunning(true);
    setDailyStatus('Starting…');
    try {
      const { jobId } = await runDailyJob();
      setDailyStatus('Running…');
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const job = await getScrapeJob(jobId);
        if (job.status === 'DONE') {
          setDailyStatus(`Done — ${job.itemsSaved} new projects`);
          await fetchProjects();
          await loadUpdates();
          break;
        }
        if (job.status === 'FAILED') {
          setDailyStatus('Failed: ' + (job.error || 'unknown error'));
          break;
        }
      }
    } catch (err) {
      setDailyStatus('Error: ' + err.message);
    } finally {
      setDailyRunning(false);
      setTimeout(() => setDailyStatus(''), 8000);
    }
  };

  const handlePageChange = (newPage) => { fetchProjects(newPage); };

  const handleTagClick = async (tag) => {
    setSearchLoading(true);
    setSearchPhase('live');
    setSearchKeyword(tag);
    try {
      // searchByKeyword now fetches from chinabidding.com, saves to DB, returns rich records
      const result = await searchByKeyword(tag);
      setProjects(result.data || []);
      setPagination(result.pagination || { page: 1, totalPages: 1, total: result.data?.length || 0 });
      setSearchPhase('done');
      setTimeout(() => setSearchPhase(''), 4000);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchPhase('');
    }
    setSearchLoading(false);
  };

  const handleSearch = () => { if (searchKeyword.trim()) handleTagClick(searchKeyword.trim()); };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_26%),linear-gradient(180deg,_#f8fafc,_#e2e8f0)] px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">

        {/* ── Header banner ──────────────────────────────────────────── */}
        <header className="banner-simple relative rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-4 md:px-7">
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

              {/* Notification bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotif(v => !v)}
                  className="relative flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {notif.unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {notif.unreadCount > 99 ? '99+' : notif.unreadCount}
                    </span>
                  )}
                </button>

                {showNotif && (
                  <div className="absolute right-0 z-[60] mt-2 w-96 max-w-[90vw] rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <span className="text-sm font-bold text-slate-800">通知 Notifications</span>
                      {notif.unreadCount > 0 && (
                        <button onClick={handleMarkAllRead} className="text-xs font-semibold text-blue-600 hover:underline">
                          全部已读
                        </button>
                      )}
                    </div>
                    <ul className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                      {notif.items.length === 0 ? (
                        <li className="px-4 py-8 text-center text-sm text-slate-400">暂无通知</li>
                      ) : notif.items.map(n => (
                        <li
                          key={n.id}
                          onClick={() => handleNotifClick(n)}
                          className={`cursor-pointer px-4 py-3 text-sm transition hover:bg-slate-50 ${n.readAt ? 'text-slate-400' : 'text-slate-700'}`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-base">
                              {n.type === 'OWN_WIN' ? '🏆' : n.type === 'COMPETITOR_WIN' ? '⚔️' : n.type === 'INTEREST_WIN' ? '👀' : n.type === 'DEADLINE_SOON' ? '⏰' : n.type === 'STATUS_CHANGE' ? '🔄' : '📌'}
                            </span>
                            <div className="min-w-0">
                              <p className={`leading-snug ${!n.readAt ? 'font-semibold' : ''}`}>{n.message}</p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {n.project?.publishDate
                                  ? `发布日期：${new Date(n.project.publishDate).toLocaleDateString('zh-CN')}`
                                  : new Date(n.createdAt).toLocaleDateString('zh-CN')}
                              </p>
                            </div>
                            {!n.readAt && <span className="mt-1.5 ml-auto h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={handleRunDaily}
                  disabled={dailyRunning}
                  className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {dailyRunning ? '⟳ Running…' : '⟳ Refresh Data'}
                </button>
                {dailyStatus && (
                  <span className={`text-xs font-medium ${dailyStatus.startsWith('Done') ? 'text-emerald-600' : dailyStatus.startsWith('Fail') || dailyStatus.startsWith('Error') ? 'text-red-500' : 'text-slate-400'}`}>
                    {dailyStatus}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Recent Updates Panel ───────────────────────────────────── */}
        {(updates.newProjects.length > 0 || updates.statusChanged.length > 0) && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowUpdates(v => !v)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition"
            >
              <span className="flex items-center gap-2">
                <span className="text-base">🔔</span>
                Updates in the last 7 days
                {updates.newProjects.length > 0 && (
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white">{updates.newProjects.length} NEW</span>
                )}
                {updates.statusChanged.length > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{updates.statusChanged.length} UPDATED</span>
                )}
              </span>
              <svg className={`h-4 w-4 text-amber-600 transition-transform ${showUpdates ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showUpdates && (
              <div className="border-t border-amber-200 px-5 py-4 space-y-4">
                {updates.newProjects.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-700">New Projects</p>
                    <ul className="space-y-1.5">
                      {updates.newProjects.slice(0, 10).map(p => (
                        <li key={p.id} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">NEW</span>
                          <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-blue-600 hover:underline line-clamp-1">
                            {p.projectName}
                          </a>
                          <span className="shrink-0 text-xs text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</span>
                        </li>
                      ))}
                      {updates.newProjects.length > 10 && <li className="text-xs text-slate-400">…and {updates.newProjects.length - 10} more</li>}
                    </ul>
                  </div>
                )}
                {updates.statusChanged.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">Status Changes</p>
                    <ul className="space-y-1.5">
                      {updates.statusChanged.slice(0, 10).map(p => (
                        <li key={p.id} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">UPD</span>
                          <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-blue-600 hover:underline line-clamp-1">
                            {p.projectName}
                          </a>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[p.status] || STATUS_STYLES.CANCELLED}`}>{p.status}</span>
                        </li>
                      ))}
                      {updates.statusChanged.length > 10 && <li className="text-xs text-slate-400">…and {updates.statusChanged.length - 10} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
                  onClick={() => { setSearchKeyword(''); setSearchPhase(''); fetchProjects(1); }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              {searchPhase === 'done' && (
                <span className="text-xs font-medium text-emerald-600">✓ Saved to DB</span>
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
                <option value="">All Projects</option>
                <option value="NEW">New Tenders</option>
                <option value="PAST">Past Tenders</option>
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
              {[
                { key: 'equipmentType', label: '设备类型', value: filters.equipmentType, params: ['equipmentType'] },
                { key: 'purchaser',     label: '采购方',   value: filters.purchaser,     params: ['purchaser'] },
                { key: 'region',        label: '地区',     value: filters.region,        params: ['region'] },
                { key: 'period',        label: '月份',     value: periodLabel,           params: ['month'], clears: { startDate: '', endDate: '' } },
              ].filter(c => c.value).map(c => (
                <span key={c.key} className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600">
                  {c.label}：{c.value}
                  <button
                    onClick={() => {
                      const override = c.clears ? { ...c.clears } : { [c.key]: '' };
                      setFilters(f => ({ ...f, ...override }));
                      if (c.key === 'period') setPeriodLabel('');
                      c.params.forEach(p => searchParams.delete(p));
                      setSearchParams(searchParams, { replace: true });
                      fetchProjects(1, override);
                    }}
                    className="text-blue-400 hover:text-blue-700"
                    title={`清除${c.label}筛选`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Project List ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {searchLoading || loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {searchLoading
                  ? 'Fetching from chinabidding.com and saving details… (may take ~30s)'
                  : 'Loading…'}
              </div>
              {searchLoading && (
                <p className="text-xs text-slate-400">First search per keyword takes longer — subsequent searches are instant</p>
              )}
            </div>
          ) : projects.length === 0 ? (
            <div className="py-20 text-center text-sm text-slate-400">
              No projects found. Try refreshing data or adjusting filters.
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {projects.map((project) => (
                  <li key={project.id} className="group px-5 py-4 transition hover:bg-slate-50 sm:px-6">
                    {/* Row 1: star + title + type badge + date */}
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="flex flex-1 min-w-0 items-start gap-2">
                        <button
                          onClick={() => toggleFollow(project.id)}
                          title={followedIds.has(project.id) ? '取消关注' : '关注此项目（状态变更/截止临近会收到提醒）'}
                          className={`mt-0.5 shrink-0 text-base leading-none transition ${
                            followedIds.has(project.id) ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 hover:text-amber-400'
                          }`}
                        >
                          {followedIds.has(project.id) ? '★' : '☆'}
                        </button>
                        <a
                          href={project.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 text-[0.93rem] font-bold leading-snug text-slate-800 hover:text-blue-600 hover:underline"
                        >
                          {isNewProject(project) && (
                            <span className="mr-1.5 inline-block translate-y-[-1px] rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">NEW</span>
                          )}
                          {!isNewProject(project) && isUpdated(project) && (
                            <span className="mr-1.5 inline-block translate-y-[-1px] rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">UPD</span>
                          )}
                          {project.projectName || '—'}
                        </a>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <BidTypeBadge project={project} />
                        {project.publishDate && (
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            Time：{new Date(project.publishDate).toLocaleDateString('zh-CN')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Row 2: summary (DeepSeek) or raw content preview */}
                    {(project.summary || project.rawContent) && (
                      <p className={`mt-1.5 line-clamp-2 text-xs leading-relaxed ${project.summary ? 'text-slate-700' : 'text-slate-400'}`}>
                        {project.summary || project.rawContent.slice(0, 220)}
                      </p>
                    )}

                    {/* Row 3: tags */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {project.equipmentType && (
                        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                          {project.equipmentType}
                        </span>
                      )}
                      {project.purchaser && (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                          采购方：{project.purchaser.slice(0, 30)}
                        </span>
                      )}
                      {project.winner && (
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                          project.competitorId
                            ? 'border-red-200 bg-red-50 text-red-600'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                        }`}>
                          中标：{project.winner.slice(0, 36)}{project.winningPrice ? `（${project.winningPrice}）` : ''}
                        </span>
                      )}
                      {project.region && (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                          Region：{project.region.slice(0, 40)}
                        </span>
                      )}
                      {project.deadline && (
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                          new Date(project.deadline) < new Date()
                            ? 'border-red-200 bg-red-50 text-red-500'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}>
                          Deadline：{new Date(project.deadline).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                      {project.budget && (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                          Budget：{project.budget}
                        </span>
                      )}
                      {project.threadKey && (
                        <button
                          onClick={() => openThread(project.id)}
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-blue-300 hover:text-blue-600"
                        >
                          ⧉ 项目线索
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
                <span className="text-slate-400">
                  {pagination.total ?? projects.length} project{(pagination.total ?? projects.length) !== 1 ? 's' : ''}
                  {searchKeyword ? ` matching "${searchKeyword}"` : ''}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1 || !!searchKeyword}
                    className="rounded-full border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <span className="text-slate-500">Page {pagination.page} / {pagination.totalPages || 1}</span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages || !!searchKeyword}
                    className="rounded-full border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Thread timeline modal ──────────────────────────────────────── */}
      {(threadData || threadLoading) && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => setThreadData(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {threadLoading ? (
              <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
            ) : (
              <>
                <div className="mb-1 flex items-start justify-between gap-4">
                  <h3 className="text-base font-bold text-slate-800">项目生命周期</h3>
                  <button onClick={() => setThreadData(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <p className="mb-4 text-xs text-slate-400">
                  Bidding NO：{threadData.project.threadKey} — 同一项目的全部公告（招标 → 变更 → 评标 → 中标）
                </p>
                <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
                  {threadData.thread.map(t => (
                    <li key={t.id} className="relative">
                      <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
                        /award/i.test(t.infoClass || '') ? 'bg-emerald-500'
                        : /evaluation/i.test(t.infoClass || '') ? 'bg-amber-400'
                        : /change/i.test(t.infoClass || '') ? 'bg-orange-400'
                        : 'bg-blue-500'
                      }`} />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-slate-600">{t.infoClass || (t.biddingType === 'PAST' ? 'Tender Awards' : 'New Tenders')}</span>
                        {t.publishDate && <span>{new Date(t.publishDate).toLocaleDateString('zh-CN')}</span>}
                      </div>
                      <a
                        href={t.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 block text-sm font-semibold text-slate-800 hover:text-blue-600 hover:underline"
                      >
                        {t.projectName}
                      </a>
                      {t.summary && <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">{t.summary}</p>}
                      {t.winner && (
                        <p className="mt-1 text-xs font-medium text-emerald-600">
                          中标：{t.winner}{t.winningPrice ? `（${t.winningPrice}）` : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BidProjectList;
