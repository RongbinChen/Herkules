import { STRINGS } from '../../i18n/visitReports'

// Section title for one customer group on the Visit Reports page.
// `unnamed` uses the active language ("No customer" / 无客户). The count badge
// is a number so a long company name can wrap on a phone; the accessible name
// is the existing translated report count.
export default function CustomerGroupHeader({
  name,
  count,
  unnamed = false,
  lang = 'en',
  sticky = false,
  headingId,
  className = '',
}) {
  const t = STRINGS[lang] || STRINGS.en
  const label = unnamed ? t.noCustomer : name

  return (
    <div
      data-customer-group={unnamed ? 'none' : name}
      className={[
        sticky
          ? `sticky top-0 z-10 rounded-xl border px-4 py-3.5 shadow-card ${unnamed ? 'border-slate-300 border-l-4 border-l-slate-400 bg-slate-50' : 'border-slate-200 border-l-4 border-l-brand-600 bg-white'}`
          : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-start gap-2.5">
        {!unnamed && (
          <span aria-hidden="true" className="mt-1 shrink-0 text-base leading-none">🏢</span>
        )}
        <h2
          id={headingId}
          className={`min-w-0 break-words text-base font-bold leading-snug ${unnamed ? 'text-slate-600' : 'text-slate-900'}`}
        >
          {label}
        </h2>
        <span
          aria-label={t.countReports(count)}
          className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${unnamed ? 'bg-slate-200 text-slate-600' : 'bg-brand-100 text-brand-800'}`}
        >
          {count}
        </span>
      </div>
    </div>
  )
}
