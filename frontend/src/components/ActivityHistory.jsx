import { format } from 'date-fns'
import { showActivityStatusBadge } from '../utils/activityStatus'

const CATEGORY_LABELS = {
  WORK_SESSION: 'Internal Coordination',
  MEETING: 'Technical Discussion',
  SALES_MEETING: 'Sales Meeting',
  FIELD_WORK: 'Customer Visit',
  BREAK: 'Final Negotiation',
  TRAINING: 'Project Execution',
  LEAVE: 'Holidays',
  REMINDER: 'Reminder / Target',
}

const CATEGORY_COLORS = {
  WORK_SESSION: '#475569',
  MEETING: '#0f766e',
  SALES_MEETING: '#2563eb',
  FIELD_WORK: '#ea580c',
  BREAK: '#dc2626',
  TRAINING: '#7c3aed',
  LEAVE: '#0891b2',
  REMINDER: '#e11d48',
}

const EVENT_STATUS_LABELS = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
}

function fmt(value) {
  if (!value) return ''
  try {
    return format(new Date(value), 'yyyy-MM-dd HH:mm')
  } catch {
    return value
  }
}

function statusLabel(status) {
  return EVENT_STATUS_LABELS[status] || status
}

// Customer activity timeline. Event-level status badges (Planned and the rest)
// render only while the start is still in the future, in Beijing time. The
// Done / Planned labels on visit-report reminder rows stay either way.
export default function ActivityHistory({ events = [], visitReports = [], onOpenReport, now = new Date() }) {
  const byReport = new Map()
  const singles = []
  for (const ev of events) {
    if (ev.visitReportId) {
      if (!byReport.has(ev.visitReportId)) byReport.set(ev.visitReportId, [])
      byReport.get(ev.visitReportId).push(ev)
    } else singles.push(ev)
  }
  const items = [
    ...singles.map((ev) => ({ type: 'event', key: `e${ev.id}`, date: ev.start, ev })),
    ...[...byReport.entries()].map(([rid, evs]) => ({
      type: 'report',
      key: `r${rid}`,
      rid,
      evs: [...evs].sort((a, b) => new Date(b.start) - new Date(a.start)),
      date: evs.reduce((m, e) => (new Date(e.start) > new Date(m) ? e.start : m), evs[0].start),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))
  const reportTitle = (rid) => visitReports.find((r) => r.id === rid)?.title || `#${rid}`
  const noteOf = (ev) => (ev.description || '').split('\n').slice(1).join(' ').trim()

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Activity history</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{events.length}</span>
      </div>

      {events.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No activities linked to this customer yet.</p>
      ) : (
        <ol className="relative ml-2 space-y-5 border-l-2 border-slate-100 pl-5">
          {items.map((it) => {
            if (it.type === 'report') {
              return (
                <li key={it.key} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />
                  <button
                    onClick={() => onOpenReport?.(it.rid)}
                    className="block w-full min-w-0 break-words text-left text-sm font-bold text-slate-800 hover:text-brand-600"
                  >
                    📝 From visit report: <span className="underline decoration-slate-300 underline-offset-2">{reportTitle(it.rid)}</span> ↗
                  </button>
                  <ul className="mt-2 min-w-0 space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    {it.evs.map((ev) => (
                      <li key={ev.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="order-1 shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">{fmt(ev.start).slice(0, 10)}</span>
                        <span
                          className="order-3 w-full min-w-0 break-words text-slate-700 sm:order-2 sm:w-auto sm:flex-1 sm:truncate"
                          title={`${ev.title.replace(/^⏰\s*/, '')} — ${noteOf(ev)}`}
                        >
                          {ev.title.replace(/^⏰\s*/, '')}
                        </span>
                        <span
                          data-reminder-status={ev.status}
                          className={`order-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold sm:order-3 ${ev.status === 'DONE' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}
                        >
                          {statusLabel(ev.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {it.evs[0]?.user?.name && <p className="mt-1 text-xs text-slate-400">By {it.evs[0].user.name}</p>}
                </li>
              )
            }
            const ev = it.ev
            const color = CATEGORY_COLORS[ev.category] || '#64748b'
            const showStatus = showActivityStatusBadge(ev.start, now) && ev.status
            return (
              <li key={it.key} data-activity-event={ev.id} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white"
                  style={{ background: color }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">{fmt(ev.start)}</span>
                  <span data-activity-type={ev.category} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: color }}>
                    {CATEGORY_LABELS[ev.category] || ev.category}
                  </span>
                  {showStatus && (
                    <span data-activity-status={ev.status} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      {statusLabel(ev.status)}
                    </span>
                  )}
                </div>
                <p className="mt-1 font-semibold text-slate-800">{ev.title}</p>
                {ev.description && <p className="mt-0.5 text-sm text-slate-500">{ev.description}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                  {ev.user?.name && <span>By {ev.user.name}</span>}
                  {ev.location && <span>@ {ev.location}</span>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
