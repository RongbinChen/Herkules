import { Link } from 'react-router-dom'

// What the home-page row is allowed to lead with. The stored title is often
// "customer — order number", and joining that to the customer name printed
// the customer twice and pushed the order number off the line. The customer
// is the name of the row. The serial stays beside it, quieter, and is left
// off entirely when blank so the line does not keep an empty "Serial" or a
// dangling separator. Without a customer, the serial or the order number
// still identifies the row. A title that only repeats those is dropped.
function titleEchoes(title, customer, orderNo) {
  if (!title) return true
  if (customer && title === customer) return true
  if (customer && title.startsWith(customer) && /^[\s·—–\-|]/.test(title.slice(customer.length))) return true
  if (orderNo && title.includes(orderNo)) return true
  return false
}

export function followUpStripIdentity(item) {
  const serial = String(item?.machineSerial ?? '').trim()
  const customer = String(item?.customerName ?? '').trim()
  const orderNo = String(item?.orderNo ?? '').trim()
  const title = String(item?.title ?? '').trim()
  const orderLabel = orderNo ? `#${orderNo}` : ''

  let primary = 'Order'
  let hint = ''
  // The customer leads. A serial is drawn next to it, in gray, and does not
  // take the title slot. The order number only fills that secondary slot
  // when there is no serial to show. With no customer, the serial itself is
  // the title.
  if (customer) {
    primary = customer
    hint = serial ? '' : orderLabel
  } else if (serial) {
    primary = serial
    hint = orderLabel
  } else if (orderLabel) {
    primary = orderLabel
  } else if (title) {
    primary = title
  }

  const tooltip = []
  const push = (part) => {
    if (part && !tooltip.includes(part)) tooltip.push(part)
  }
  if (customer) push(customer)
  if (serial) push(`Serial ${serial}`)
  else push(primary)
  push(orderLabel)
  if (!titleEchoes(title, customer, orderNo)) push(title)

  return {
    serial,
    primary,
    hint,
    // Gray serial sits beside the customer. It is not repeated when the
    // serial itself is the only name on the line.
    showSerial: Boolean(serial && customer),
    tooltip: tooltip.join(' · '),
  }
}

// One live order on the home page. The follow-up record is one click away.
// The row leads with the customer (or a short fallback). A machine serial,
// when there is one, sits next to that name in gray. Then the next action,
// then the overdue milestones when there are any. Upcoming dates that are
// not late stay off this strip. Desktop keeps the next due date on the title
// line. On a phone the date sits with the badge, and the name gets the full
// width so it cannot be pushed out of the row. The title markup is the same
// at both widths.
export function FollowUpStatusRow({ item }) {
  const next = item.next
  const badge = badgeFor(item)
  const identity = followUpStripIdentity(item)
  // The strip stays in English. zh is still on the payload for other screens.
  const owner = next?.ownerName || item.ownerName || 'Unassigned'
  const followedBy = `follow-up by ${owner}`
  const actionTitle = next
    ? [next.label, next.dueDate, next.cue, followedBy].filter(Boolean).join(' · ')
    : `No open date · ${followedBy}`
  // The earliest late milestone is already the next action. Listing it again
  // under the date chip repeated the same fact. The list is the other ones.
  const overdue = (Array.isArray(item.overdue) ? item.overdue : []).filter((d) => (
    !(next && d.kind === next.kind && d.dueDate === next.dueDate)
  ))
  const moreOverdue = Number(item.moreOverdue) || 0

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
            <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800" title={identity.tooltip}>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <span className="max-w-full break-words font-semibold text-slate-900">{identity.primary}</span>
                {identity.showSerial && (
                  <span className="max-w-full whitespace-nowrap text-xs font-normal text-slate-500">
                    <span aria-hidden="true">· </span>
                    <span className="mr-1 align-middle text-[10px] font-bold uppercase tracking-wider">Serial</span>
                    {identity.serial}
                  </span>
                )}
                {identity.hint && (
                  <span className="min-w-0 truncate text-xs font-normal text-slate-400">· {identity.hint}</span>
                )}
              </span>
            </span>
            {next?.dueDate && (
              <span className={`hidden max-w-full rounded px-1.5 py-0.5 text-[11px] font-bold sm:inline sm:shrink-0 ${toneCls(next.tone)}`}>
                <time dateTime={next.dueDate}>{next.dueDate}</time>
                <span> · {next.cue}</span>
              </span>
            )}
          </span>
          {/* Wrap, rather than one truncated line, so the action and the
              person chasing it both stay on a phone. */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs" title={actionTitle}>
            {item.status === 'ON_HOLD' && <span className="font-semibold text-amber-700">On hold</span>}
            {item.status === 'ON_HOLD' && <span aria-hidden="true" className="text-slate-300">·</span>}
            <span className="min-w-0 font-medium text-slate-800">{next ? next.label : 'No open date'}</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="max-w-full truncate text-slate-500">{followedBy}</span>
          </span>
          {(overdue.length > 0 || moreOverdue > 0) && (
            <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-4">
              <span className="font-semibold text-rose-600">Also overdue</span>
              {overdue.map((d, index) => (
                <span
                  key={`${d.kind}-${d.dueDate}-${index}`}
                  className="font-medium text-rose-700"
                  title={[d.label, d.dueDate, d.cue, d.ownerName && `follow-up by ${d.ownerName}`].filter(Boolean).join(' · ')}
                >
                  {d.short} <time dateTime={d.dueDate}>{String(d.dueDate).slice(5)}</time>
                  {d.cue && <span className="font-normal text-rose-600"> {d.cue}</span>}
                </span>
              ))}
              {moreOverdue > 0 && (
                <span className="font-medium text-rose-500" title={`${moreOverdue} more overdue`}>+{moreOverdue}</span>
              )}
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
