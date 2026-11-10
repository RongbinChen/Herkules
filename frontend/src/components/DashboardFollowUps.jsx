import { Link } from 'react-router-dom'

// One live order on the home page. The follow-up record is one click away;
// this row is only the next thing to watch, plus the other open dates.
// Desktop keeps the due date on the title line. On a phone the date sits
// with the badge, and the name gets the full width so it cannot be pushed
// out of the row.
export function FollowUpStatusRow({ item }) {
  const next = item.next
  const badge = badgeFor(item)
  const identity = item.customerName || item.title || 'Order'
  const secondary = item.customerName && item.title && item.customerName !== item.title ? item.title : ''
  const identityTitle = [identity, secondary, item.orderNo ? `#${item.orderNo}` : ''].filter(Boolean).join(' · ')
  const actionTitle = next
    ? [next.label, next.zh, next.dueDate, next.cue, next.ownerName].filter(Boolean).join(' · ')
    : 'No open date'
  const owner = next?.ownerName || item.ownerName || 'Unassigned'
  const others = (item.dates || []).slice(1)

  return (
    <li>
      <Link
        to={`/followups/${item.id}`}
        className="flex w-full min-w-0 flex-col gap-y-1 rounded-lg py-2.5 text-left transition hover:bg-brand-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 sm:flex-row sm:items-start sm:gap-x-3"
      >
        <span className="flex min-w-0 items-center justify-between gap-2 sm:contents">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold sm:min-w-[4.5rem] ${badge.cls}`}>
            {badge.text}
          </span>
          {next?.dueDate && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold sm:hidden ${toneCls(next.tone)}`}>
              <time dateTime={next.dueDate}>{next.dueDate}</time>
              <span> · {next.cue}</span>
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-full text-sm font-medium text-slate-700 line-clamp-2 sm:basis-0 sm:line-clamp-1" title={identityTitle}>
              {identity}
              {secondary && <span className="font-normal text-slate-500"> · {secondary}</span>}
            </span>
            {next?.dueDate && (
              <span className={`hidden max-w-full rounded px-1.5 py-0.5 text-[11px] font-bold sm:inline sm:shrink-0 ${toneCls(next.tone)}`}>
                <time dateTime={next.dueDate}>{next.dueDate}</time>
                <span> · {next.cue}</span>
              </span>
            )}
          </span>
          {/* Wrap, rather than one truncated line: on a phone the owner was
              the piece that disappeared, and the owner is the point of the row. */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-slate-500" title={actionTitle}>
            {item.orderNo && <span className="max-w-full truncate">#{item.orderNo}</span>}
            {item.orderNo && <span aria-hidden="true">·</span>}
            {item.status === 'ON_HOLD' && <span>On hold</span>}
            {item.status === 'ON_HOLD' && <span aria-hidden="true">·</span>}
            <span className="min-w-0 max-w-full">{next ? next.label : 'No open date'}</span>
            <span aria-hidden="true">·</span>
            <span className="max-w-full truncate">{owner}</span>
          </span>
          {others.length > 0 && (
            <span className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-slate-500">
              {others.map((d) => (
                <span
                  key={`${d.kind}-${d.dueDate}`}
                  className={d.tone === 'overdue' || d.tone === 'today' ? 'font-medium text-rose-600' : ''}
                  title={[d.label, d.zh, d.dueDate, d.cue].filter(Boolean).join(' · ')}
                >
                  {d.short} {d.dueDate.slice(5)}
                </span>
              ))}
              {item.moreDates > 0 && <span className="text-slate-400">+{item.moreDates}</span>}
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

function badgeFor(item) {
  const tone = item.next?.tone
  if (tone === 'overdue') return { text: 'Overdue', cls: 'bg-rose-50 text-rose-600' }
  if (tone === 'today') return { text: 'Today', cls: 'bg-rose-50 text-rose-600' }
  if (tone === 'soon' || tone === 'later') return { text: 'Next', cls: tone === 'soon' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500' }
  if (item.status === 'ON_HOLD') return { text: 'On hold', cls: 'bg-amber-50 text-amber-700' }
  return { text: 'No date', cls: 'bg-slate-100 text-slate-400' }
}

function toneCls(tone) {
  if (tone === 'overdue' || tone === 'today') return 'bg-rose-50 text-rose-600'
  if (tone === 'soon') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}

export function FollowUpStatusSection({ items, total }) {
  if (!items?.length) return null
  const extra = Math.max(0, (total || items.length) - items.length)
  const count = total || items.length
  return (
    <section className="relative mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm sm:mb-8" aria-labelledby="followup-status-heading">
      <div className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full bg-brand-600" aria-hidden="true" />
      <div className="py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="followup-status-heading" className="text-sm font-semibold leading-snug text-slate-900">
                Project follow-up
              </h2>
              <p className="hidden text-xs text-slate-500 sm:block">Recently signed orders — the next date to watch</p>
              <Link to="/followups" className="text-xs font-semibold text-brand-600 hover:underline sm:hidden">
                View all
              </Link>
            </div>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            <Link to="/followups" className="hidden text-xs font-semibold text-brand-600 hover:underline sm:inline">
              View all
            </Link>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
              {count}
            </span>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((item) => <FollowUpStatusRow key={item.id} item={item} />)}
        </ul>
        {extra > 0 && (
          <Link to="/followups" className="mt-1 inline-block text-xs text-slate-400 hover:text-brand-600">
            +{extra} more — View all
          </Link>
        )}
      </div>
    </section>
  )
}
