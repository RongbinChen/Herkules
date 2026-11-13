import { useEffect, useState } from 'react'
import { customersAPI } from '../api/api'
import { formatBeijingDisplay } from '../utils/halfDay'

const DEFAULT_GMT = 'https://gmt.herkulesgroup-china.com'

// Readable activity types, matching GMT's English labels.
const TASK_TYPE_LABELS = {
  INSTALLATION: 'Installation & commissioning',
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance',
  INSPECTION: 'Inspection',
  TRAINING: 'Customer training',
  TRAVEL: 'Travel',
  ENGINEER_TRAINING: 'Training',
  LEAVE: 'Leave',
  OFFICE: 'Office work',
  OTHER: 'Other',
}

const TASK_STATUS_LABELS = {
  DRAFT: 'Draft',
  PUBLISHED: 'Dispatched',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

const REPORT_STATUS_LABELS = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
}

const TASK_STATUS_CLASS = {
  DRAFT: 'bg-slate-100 text-slate-500',
  PUBLISHED: 'bg-brand-50 text-brand-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
}

function readable(map, value) {
  if (!value) return ''
  return map[value] || String(value).replace(/_/g, ' ')
}

function gmtHome(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_GMT
    return url.origin
  } catch {
    return DEFAULT_GMT
  }
}

function httpUrl(value) {
  const raw = String(value || '').trim()
  if (!/^https?:\/\//i.test(raw)) return ''
  return raw
}

function beijingRange(start, end) {
  const from = start ? formatBeijingDisplay(start) : ''
  const to = end ? formatBeijingDisplay(end) : ''
  if (from && to && from !== to) return `${from} – ${to}`
  return from || to
}

function reportWhen(report) {
  return formatBeijingDisplay(report.publishedAt || report.createdAt)
}

function quietCopy(reason) {
  if (reason === 'unconfigured') return 'Field service is not connected.'
  return 'Field service is temporarily unavailable.'
}

export function FieldServiceCard({ phase = 'loading', payload = null }) {
  const quiet = phase === 'quiet' || payload?.ok === false
  const tasks = quiet ? [] : (payload?.tasks || [])
  const reports = quiet ? [] : (payload?.serviceReports || [])
  const ready = phase === 'ready' && payload?.ok === true
  const empty = ready && tasks.length === 0 && reports.length === 0
  const home = gmtHome(payload?.gmtUrl || DEFAULT_GMT)
  const count = tasks.length + reports.length

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">
          Field service <span className="text-xs font-semibold text-slate-400">/ 现场服务</span>
        </h2>
        <div className="flex items-center gap-2">
          {ready && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{count}</span>
          )}
          <a
            href={home}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-slate-400 transition hover:text-brand-600"
          >
            Open in GMT →
          </a>
        </div>
      </div>

      {phase === 'loading' && (
        <p className="py-8 text-center text-sm text-slate-400">Loading field service…</p>
      )}

      {quiet && phase !== 'loading' && (
        <p className="py-6 text-center text-sm text-slate-400">{quietCopy(payload?.reason)}</p>
      )}

      {empty && (
        <p className="py-8 text-center text-sm text-slate-400">No field-service tasks or reports for this customer yet.</p>
      )}

      {ready && !empty && (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Tasks</h3>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400">No tasks yet.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => {
                  const href = httpUrl(task.url)
                  const title = task.title || 'Untitled task'
                  return (
                    <li key={task.id ?? title} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="min-w-0 text-sm font-semibold text-slate-800 hover:text-brand-600">
                            {title}
                          </a>
                        ) : (
                          <p className="min-w-0 text-sm font-semibold text-slate-800">{title}</p>
                        )}
                        {task.status && (
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TASK_STATUS_CLASS[task.status] || 'bg-slate-100 text-slate-500'}`}>
                            {readable(TASK_STATUS_LABELS, task.status)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {task.type && (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
                            {readable(TASK_TYPE_LABELS, task.type)}
                          </span>
                        )}
                        {task.siteName && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">{task.siteName}</span>}
                        {task.equipment && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">{task.equipment}</span>}
                      </div>
                      {beijingRange(task.start, task.end) && (
                        <p className="mt-1 text-xs text-slate-500">{beijingRange(task.start, task.end)}</p>
                      )}
                      {task.engineers?.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-400">{task.engineers.map((eng) => eng.name).filter(Boolean).join(', ')}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Service reports</h3>
            {reports.length === 0 ? (
              <p className="text-sm text-slate-400">No service reports yet.</p>
            ) : (
              <ul className="space-y-2">
                {reports.map((report) => {
                  const href = httpUrl(report.url)
                  const title = report.originalName || report.title || 'Service report'
                  const place = [report.siteCustomer, report.siteName].filter(Boolean).join(' · ')
                  const when = reportWhen(report)
                  return (
                    <li key={report.id ?? title} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="min-w-0 text-sm font-semibold text-slate-800 hover:text-brand-600">
                            {title}
                          </a>
                        ) : (
                          <p className="min-w-0 text-sm font-semibold text-slate-800">{title}</p>
                        )}
                        {report.status && (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                            {readable(REPORT_STATUS_LABELS, report.status)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        {when && <span>{when}</span>}
                        {report.authorName && <span>By {report.authorName}</span>}
                        {place && <span>{place}</span>}
                        {report.machineSerial && <span>S/N {report.machineSerial}</span>}
                      </div>
                      {report.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{report.summary}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default function CustomerFieldService({ customerId }) {
  const [phase, setPhase] = useState('loading')
  const [payload, setPayload] = useState(null)

  useEffect(() => {
    let ignore = false
    setPhase('loading')
    setPayload(null)
    customersAPI.fieldService(customerId)
      .then((response) => {
        if (ignore) return
        setPayload(response.data)
        setPhase('ready')
      })
      .catch(() => {
        if (ignore) return
        setPayload({ ok: false, reason: 'unreachable' })
        setPhase('quiet')
      })
    return () => { ignore = true }
  }, [customerId])

  return <FieldServiceCard phase={phase} payload={payload} />
}
