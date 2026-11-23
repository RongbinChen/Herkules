import { Link } from 'react-router-dom'
import {
  groupSourceCards,
  isSafeAppHref,
  reportIdFromHref,
  reportOverviewLine,
  reminderOverviewLine,
  reminderDisplayTitle,
  sourceTypeLabels,
} from '../../utils/sourceCards.js'

export {
  groupSourceCards,
  isSafeAppHref,
  reportIdFromHref,
  reportOverviewLine,
  reminderOverviewLine,
  sourceTypeLabels,
} from '../../utils/sourceCards.js'

function TypeLabel({ type, locked, lang }) {
  const t = sourceTypeLabels(lang)
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {t[type] || type}
      {locked ? ` · ${t.locked}` : ''}
    </span>
  )
}

function GridCard({ source, lang }) {
  return (
    <Link
      to={source.href}
      className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
    >
      <TypeLabel type={source.type} locked={source.locked} lang={lang} />
      <span className="mt-0.5 block text-sm font-semibold text-slate-800 break-words">{source.title}</span>
      {source.subtitle && <span className="block truncate text-[11px] text-slate-400">{source.subtitle}</span>}
    </Link>
  )
}

function ReportRow({ source, nestedReminders, lang }) {
  const overview = reportOverviewLine(source)
  const summary = String(source.summary || '').trim()
  return (
    <li className="bg-white">
      <Link
        to={source.href}
        className="block px-3 py-2.5 text-left transition hover:bg-brand-50/40"
      >
        <TypeLabel type="report" locked={source.locked} lang={lang} />
        <span className="mt-0.5 block text-sm font-semibold leading-snug text-slate-800 break-words">
          {source.title}
        </span>
        {overview && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{overview}</span>
        )}
        {summary && (
          <p className="mt-1 text-xs leading-relaxed text-slate-600 line-clamp-3">{summary}</p>
        )}
      </Link>
      {nestedReminders?.length > 0 && (
        <ul className="border-t border-slate-100 bg-slate-50/80">
          {nestedReminders.map((rem, i) => (
            <ReminderRow key={`${rem.href}-${i}`} source={rem} lang={lang} nested />
          ))}
        </ul>
      )}
    </li>
  )
}

function ReminderRow({ source, lang, nested = false }) {
  const overview = reminderOverviewLine(source, lang)
  const title = reminderDisplayTitle(source.title) || source.title
  return (
    <li>
      <Link
        to={source.href}
        className={`block text-left transition hover:bg-brand-50/40 ${nested ? 'px-3 py-2 pl-5' : 'px-3 py-2.5'}`}
      >
        <TypeLabel type="reminder" locked={source.locked} lang={lang} />
        <span className={`mt-0.5 block font-medium leading-snug text-slate-800 break-words ${nested ? 'text-xs' : 'text-sm'}`}>
          {title}
        </span>
        {overview && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{overview}</span>
        )}
      </Link>
    </li>
  )
}

export default function SourceCards({ sources = [], lang = 'en' }) {
  const t = sourceTypeLabels(lang)
  const safe = (sources || []).filter((s) => isSafeAppHref(s.href))
  const grouped = groupSourceCards(safe)
  if (!grouped.hasAny) return null
  return (
    <div className="mt-3 space-y-3">
      {grouped.others.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {grouped.others.map((s, i) => (
            <GridCard key={`${s.href}-${i}`} source={s} lang={lang} />
          ))}
        </div>
      )}
      {grouped.reports.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t.reports}
            <span className="ml-1 font-medium text-slate-300">{grouped.reports.length}</span>
          </h3>
          <ul className="overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-100">
            {grouped.reports.map((s, i) => {
              const id = s.visitReportId || reportIdFromHref(s.href)
              return (
                <ReportRow
                  key={`${s.href}-${i}`}
                  source={s}
                  nestedReminders={id ? grouped.remindersByReport.get(id) : []}
                  lang={lang}
                />
              )
            })}
          </ul>
        </section>
      )}
      {grouped.looseReminders.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t.reminders}
            <span className="ml-1 font-medium text-slate-300">{grouped.looseReminders.length}</span>
          </h3>
          <ul className="overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-100">
            {grouped.looseReminders.map((s, i) => (
              <ReminderRow key={`${s.href}-${i}`} source={s} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
