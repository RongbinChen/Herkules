import { Link } from 'react-router-dom'

const TYPE_LABEL = {
  customer: 'Customer',
  project: 'Tender',
  report: 'Visit report',
  hot: 'Hot project',
  event: 'Calendar',
  bidopen: 'Bid opening',
  trip: 'Trip',
  followup: 'Follow-up',
  reminder: 'Reminder',
  'field-service': 'Field service',
  contracts: 'Contracts',
  record: 'Record',
}

export function isSafeAppHref(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return false
  return /^\/(customers|visit-reports|chinabidding|hotprojects|followups|trips|contracts|calendar|search|trip\/share|bidopen\/share)(\/|\?|#|$)/.test(href)
}

export default function SourceCards({ sources = [] }) {
  const cards = (sources || []).filter((s) => isSafeAppHref(s.href))
  if (!cards.length) return null
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {cards.map((s, i) => (
        <Link
          key={`${s.href}-${i}`}
          to={s.href}
          className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {TYPE_LABEL[s.type] || s.type}
            {s.locked ? ' · locked' : ''}
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-slate-800">{s.title}</span>
          {s.subtitle && <span className="block truncate text-[11px] text-slate-400">{s.subtitle}</span>}
        </Link>
      ))}
    </div>
  )
}
