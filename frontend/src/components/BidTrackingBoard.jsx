import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjectThreads, saveBidTracking } from '../api/chinabidding';

// ── Lifecycle stages (auto, derived from announcements) ──
const STAGES = [
  { key: 'TENDER', zh: '招标', en: 'Tender' },
  { key: 'CHANGE', zh: '变更', en: 'Change' },
  { key: 'EVALUATION', zh: '评标', en: 'Evaluation' },
  { key: 'AWARD', zh: '中标', en: 'Award' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

// ── Our manual bid status (sales-team view) ──
const OUR_STATUSES = [
  { key: 'WATCHING', en: 'Watching', cls: 'bg-slate-100 text-slate-600' },
  { key: 'PREPARING', en: 'Preparing', cls: 'bg-amber-100 text-amber-700' },
  { key: 'SUBMITTED', en: 'Submitted', cls: 'bg-brand-100 text-brand-700' },
  { key: 'SHORTLISTED', en: 'Shortlisted', cls: 'bg-indigo-100 text-indigo-700' },
  { key: 'WON', en: 'Won', cls: 'bg-green-100 text-green-700' },
  { key: 'LOST', en: 'Lost', cls: 'bg-rose-100 text-rose-700' },
  { key: 'ABANDONED', en: 'Abandoned', cls: 'bg-slate-200 text-slate-500' },
];
const OUR_STATUS_MAP = Object.fromEntries(OUR_STATUSES.map((s) => [s.key, s]));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '—');

// Horizontal stage progress: 招标 → 变更 → 评标 → 中标, current highlighted.
function StageProgress({ current }) {
  const curIdx = current != null ? STAGE_INDEX[current] : -1;
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => {
        const reached = i <= curIdx;
        const isCurrent = i === curIdx;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                isCurrent
                  ? 'bg-brand-600 text-white shadow-sm'
                  : reached
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
              title={s.en}
            >
              {s.en}
            </span>
            {i < STAGES.length - 1 && (
              <span className={`text-xs ${i < curIdx ? 'text-brand-400' : 'text-slate-300'}`}>›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OurStatusBadge({ status }) {
  const s = OUR_STATUS_MAP[status];
  if (!s) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.en}</span>;
}

// Inline manual-tracking editor for one project thread.
function TrackingEditor({ thread, onSaved }) {
  const t = thread.tracking || {};
  const [form, setForm] = useState({
    ourStatus: t.ourStatus || 'WATCHING',
    ourPrice: t.ourPrice || '',
    competitors: t.competitors || '',
    outcome: t.outcome || '',
    note: t.note || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const saved = await saveBidTracking(thread.threadKey, form);
      onSaved(thread.threadKey, saved);
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-bold text-slate-500">Our tracking</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Status
          <select value={form.ourStatus} onChange={set('ourStatus')}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
            {OUR_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.en}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Our price
          <input value={form.ourPrice} onChange={set('ourPrice')} placeholder="e.g. €1.2M"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          Competitors
          <input value={form.competitors} onChange={set('competitors')} placeholder="e.g. INNSE, DANIELI"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          Outcome
          <input value={form.outcome} onChange={set('outcome')} placeholder="Won / lost / closing note"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          Note
          <textarea value={form.note} onChange={set('note')} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
      </div>
      {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
      <div className="mt-2 flex justify-end">
        <button onClick={save} disabled={saving}
          className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function ThreadCard({ thread, onSaved, onCustomer }) {
  const [showEdit, setShowEdit] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-slate-800" title={thread.projectName}>
              {thread.projectName}
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {[thread.purchaser, thread.region, thread.equipmentType].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {thread.tracking?.ourStatus && <OurStatusBadge status={thread.tracking.ourStatus} />}
        </div>

        {/* Auto progress */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StageProgress current={thread.currentStage} />
          <span className="text-[11px] text-slate-400">Updated {fmtDate(thread.lastUpdate)}</span>
        </div>

        {/* Linked customers (cross-reference) */}
        {thread.customers?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.customers.map((c) => (
              <button
                key={c.id}
                onClick={() => onCustomer(c.id)}
                title="Open customer"
                className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                👤 {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Winner / budget */}
        {(thread.winner || thread.budget) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {thread.winner && (
              <span>🏆 Winner: <span className="font-semibold text-slate-800">{thread.winner}</span>
                {thread.winningPrice ? `（${thread.winningPrice}）` : ''}</span>
            )}
            {thread.budget && <span>Budget: {thread.budget}</span>}
          </div>
        )}

        {/* Actions */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button onClick={() => setShowEdit((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
            {thread.tracking ? 'Edit tracking' : '＋ Add tracking'}
          </button>
          <button onClick={() => setShowTimeline((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
            {showTimeline ? 'Hide timeline' : `Timeline (${thread.announcements.length})`}
          </button>
          {thread.tracking?.ourPrice && (
            <span className="text-xs text-slate-500">Price {thread.tracking.ourPrice}</span>
          )}
        </div>

        {showTimeline && (
          <ol className="mt-2 space-y-1.5 border-l-2 border-slate-100 pl-3">
            {thread.announcements.map((a) => (
              <li key={a.id} className="text-xs text-slate-600">
                <span className="text-slate-400">{fmtDate(a.publishDate)}</span>{' '}
                <span className="font-semibold text-slate-700">{a.infoClass || a.bidStage || 'Notice'}</span>
                {a.winner ? ` — Winner: ${a.winner}` : ''}{' '}
                <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">Source↗</a>
              </li>
            ))}
          </ol>
        )}

        {showEdit && <TrackingEditor thread={thread} onSaved={(k, saved) => { onSaved(k, saved); }} />}
      </div>
    </div>
  );
}

export default function BidTrackingBoard() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  const [ourStatus, setOurStatus] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listProjectThreads({ stage, ourStatus, q: qDebounced });
      setThreads(data);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [stage, ourStatus, qDebounced]);

  useEffect(() => { load(); }, [load]);

  const onSaved = (threadKey, saved) => {
    setThreads((prev) => prev.map((t) => (t.threadKey === threadKey ? { ...t, tracking: saved } : t)));
  };

  const trackedCount = threads.filter((t) => t.tracking).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Project Tracking · Lifecycle</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Auto-aggregates each project's tender → evaluation → award progress, plus our own bid tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <button onClick={() => navigate('/')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm">
              Modules
            </button>
            <button onClick={() => navigate('/chinabidding')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm">
              Announcements
            </button>
            <button onClick={() => navigate('/chinabidding/stats')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm">
              Statistics
            </button>
            <button onClick={() => navigate('/chinabidding/bidopen')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm">
              Bid Tracking
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-slate-400">Stage</span>
            <button onClick={() => setStage('')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${stage === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              All
            </button>
            {STAGES.map((s) => (
              <button key={s.key} onClick={() => setStage(s.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${stage === s.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {s.en}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={ourStatus} onChange={(e) => setOurStatus(e.target.value)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
              <option value="">Our status: All</option>
              {OUR_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.en}</option>)}
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project / org / no."
              className="w-44 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" />
          </div>
        </div>

        {/* Summary */}
        <div className="mb-3 text-xs text-slate-500">
          {threads.length} projects · {trackedCount} tracked
        </div>

        {/* List */}
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : threads.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No matching projects</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {threads.map((t) => <ThreadCard key={t.threadKey} thread={t} onSaved={onSaved} onCustomer={(cid) => navigate(`/customers/${cid}`)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
