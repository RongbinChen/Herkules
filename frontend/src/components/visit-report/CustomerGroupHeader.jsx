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
          ? `sticky top-0 z-10 -mx-4 border-b bg-slate-50/95 px-4 py-2.5 backdrop-blur-sm ${unnamed ? 'border-dashed border-slate-300' : 'border-slate-200'}`
          : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-start gap-2">
        {!unnamed && (
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-sm leading-none">🏢</span>
        )}
        <h2
          id={headingId}
          className={`min-w-0 break-words text-sm font-bold leading-snug sm:text-[15px] ${unnamed ? 'text-slate-500' : 'text-slate-800'}`}
        >
          {label}
        </h2>
        <span
          aria-label={t.countReports(count)}
          className="mt-0.5 shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600"
        >
          {count}
        </span>
      </div>
    </div>
  )
}
