import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { customersAPI } from '../api/api'
import { listProjectThreads } from '../api/chinabidding'
import { useAuth } from '../context/AuthContext'
import CustomerModal from './CustomerModal'
import { statusMeta, tierMeta } from '../constants/customer'

// Tender-lifecycle stage + our-tracking status labels (mirror BidTrackingBoard).
const STAGE_LABEL = { TENDER: 'Tender', CHANGE: 'Change', EVALUATION: 'Evaluation', AWARD: 'Award' }
const OUR_STATUS = {
  WATCHING: { label: 'Watching', cls: 'bg-slate-100 text-slate-600' },
  PREPARING: { label: 'Preparing', cls: 'bg-amber-100 text-amber-700' },
  SUBMITTED: { label: 'Submitted', cls: 'bg-brand-100 text-brand-700' },
  SHORTLISTED: { label: 'Shortlisted', cls: 'bg-indigo-100 text-indigo-700' },
  WON: { label: 'Won', cls: 'bg-green-100 text-green-700' },
  LOST: { label: 'Lost', cls: 'bg-rose-100 text-rose-700' },
  ABANDONED: { label: 'Abandoned', cls: 'bg-slate-200 text-slate-500' },
}

const CATEGORY_LABELS = {
  WORK_SESSION: 'Internal Coordination',
  MEETING: 'Technical Discussion',
  SALES_MEETING: 'Sales Meeting',
  FIELD_WORK: 'Customer Visit',
  BREAK: 'Final Negotiation',
  TRAINING: 'Project Execution',
  LEAVE: 'Holidays',
}

const CATEGORY_COLORS = {
  WORK_SESSION: '#475569',
  MEETING: '#0f766e',
  SALES_MEETING: '#2563eb',
  FIELD_WORK: '#ea580c',
  BREAK: '#dc2626',
  TRAINING: '#7c3aed',
  LEAVE: '#0891b2',
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

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Return to the map view when the user arrived via the map's "Details" link.
  const cameFromMap = searchParams.get('from') === 'map'
  const backTo = cameFromMap ? '/customers?view=map' : '/customers'
  const backLabel = cameFromMap ? '← Back to map' : '← Customers'
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true

  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editOpen, setEditOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await customersAPI.get(id)
      setCustomer(response.data)
    } catch (err) {
      console.error('Failed to load customer', err)
      setError('Customer not found')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleDelete() {
    if (!window.confirm(`Delete customer "${customer.name}"? This cannot be undone.`)) return
    try {
      await customersAPI.delete(customer.id)
      navigate('/customers')
    } catch (err) {
      console.error('Failed to delete customer', err)
      window.alert('Failed to delete customer. Admin permission is required.')
    }
  }

  async function handleLinkProject(threadKey) {
    try {
      await customersAPI.linkProject(id, { threadKey })
      await load()
    } catch (err) {
      console.error('Failed to link project', err)
      window.alert(err?.response?.data?.error || 'Failed to link project')
    }
  }

  async function handleUnlinkProject(linkId) {
    if (!window.confirm('Remove this project link?')) return
    try {
      await customersAPI.unlinkProject(id, linkId)
      await load()
    } catch (err) {
      console.error('Failed to remove link', err)
      window.alert('Failed to remove link')
    }
  }

  if (loading) return <p className="py-16 text-center text-slate-400">Loading...</p>
  if (error || !customer)
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-500">{error || 'Customer not found'}</p>
        <button onClick={() => navigate('/customers')} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          ← Back to customers
        </button>
      </div>
    )

  const sMeta = statusMeta(customer.status)
  const tMeta = tierMeta(customer.tier)
  const events = customer.events || []
  const projects = customer.projects || []
  const visitReports = customer.visitReports || []

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate(backTo)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          {backLabel}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
            Edit
          </button>
          {isAdmin && (
            <button onClick={handleDelete} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr,1.3fr]">
        {/* Info card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-slate-800">{customer.name}</h1>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${tMeta.cls}`}>{tMeta.label}</span>
          </div>
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${sMeta.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sMeta.dot}`} />
              {sMeta.label}
            </span>
          </div>

          {(customer.tags || []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {customer.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">{tag}</span>
              ))}
            </div>
          )}

          <dl className="mt-5 space-y-3 text-sm">
            {Array.isArray(customer.contacts) && customer.contacts.length > 0 ? (
              customer.contacts.map((c, i) => (
                <Row
                  key={i}
                  label={i === 0 ? 'Contact' : `Contact ${i + 1}`}
                  value={[c.name, c.title, c.phone, c.email].filter(Boolean).join(' · ') || null}
                />
              ))
            ) : (
              <>
                <Row label="Contact" value={customer.contactName} />
                <Row label="Phone" value={customer.contactPhone} />
                <Row label="Email" value={customer.email} />
              </>
            )}
            <Row label="Address" value={customer.address} />
            <Row
              label="Coordinates"
              value={customer.latitude != null && customer.longitude != null ? `${customer.latitude}, ${customer.longitude}` : null}
            />
          </dl>

          {customer.notes && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{customer.notes}</p>
            </div>
          )}
        </div>

        {/* Visit history timeline */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Activity history</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{events.length}</span>
          </div>

          {events.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No activities linked to this customer yet.</p>
          ) : (
            <ol className="relative ml-2 space-y-5 border-l-2 border-slate-100 pl-5">
              {events.map((ev) => {
                const color = CATEGORY_COLORS[ev.category] || '#64748b'
                return (
                  <li key={ev.id} className="relative">
                    <span
                      className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white"
                      style={{ background: color }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">{fmt(ev.start)}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: color }}>
                        {CATEGORY_LABELS[ev.category] || ev.category}
                      </span>
                      {ev.status && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          {EVENT_STATUS_LABELS[ev.status] || ev.status}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-semibold text-slate-800">{ev.title}</p>
                    {ev.description && <p className="mt-0.5 text-sm text-slate-500">{ev.description}</p>}
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                      {ev.user?.name && <span>By {ev.user.name}</span>}
                      {ev.location && <span>@ {ev.location}</span>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      {/* Cross-reference hub: tender projects + visit reports */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Related tender projects */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Tender projects</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{projects.length}</span>
          </div>

          <ProjectLinker linkedKeys={projects.map((p) => p.threadKey)} onLink={handleLinkProject} />

          {projects.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No tender projects linked yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {projects.map((p) => {
                const st = p.tracking?.ourStatus ? OUR_STATUS[p.tracking.ourStatus] : null
                return (
                  <li key={p.linkId} className="rounded-xl border border-slate-200 p-3 transition hover:border-brand-300">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => navigate('/chinabidding/tracking')}
                        className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-800 hover:text-brand-600"
                        title="Open project tracking"
                      >
                        {p.projectName}
                      </button>
                      <button
                        onClick={() => handleUnlinkProject(p.linkId)}
                        className="shrink-0 text-slate-300 transition hover:text-rose-500"
                        title="Remove link"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {p.bidStage && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">{STAGE_LABEL[p.bidStage] || p.bidStage}</span>
                      )}
                      {st && <span className={`rounded-full px-2 py-0.5 font-semibold ${st.cls}`}>{st.label}</span>}
                      {p.equipmentType && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">{p.equipmentType}</span>}
                      {p.deadline && (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">
                          Due {fmt(p.deadline).slice(0, 10)}
                        </span>
                      )}
                      {p.sourceUrl && (
                        <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">Source↗</a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Visit reports */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Visit reports</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{visitReports.length}</span>
          </div>
          {visitReports.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No visit reports for this customer yet.</p>
          ) : (
            <ul className="space-y-2">
              {visitReports.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-3">
                  <button
                    onClick={() => navigate('/visit-reports')}
                    className="text-left text-sm font-semibold text-slate-800 hover:text-brand-600"
                  >
                    {r.title}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>{fmt(r.visitDate).slice(0, 10)}</span>
                    {r.author?.name && <span>By {r.author.name}</span>}
                    {r.status && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">{r.status}</span>}
                  </div>
                  {r.summary && <p className="mt-1 text-xs text-slate-500 line-clamp-2">{r.summary}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CustomerModal isOpen={editOpen} customer={customer} onClose={() => setEditOpen(false)} onSaved={load} />
    </div>
  )
}

// Search-and-link picker for tender-project threads. Debounced query against the
// project-threads endpoint; clicking a result creates the customer↔project link.
function ProjectLinker({ linkedKeys, onLink }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    let ignore = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const data = await listProjectThreads({ q: q.trim() })
        if (!ignore) setResults((data || []).slice(0, 8))
      } catch {
        if (!ignore) setResults([])
      } finally {
        if (!ignore) setLoading(false)
      }
    }, 300)
    return () => { ignore = true; clearTimeout(t) }
  }, [q])

  const linked = new Set(linkedKeys)

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Link a tender project — search name / purchaser / no."
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {open && q.trim() && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {loading ? (
              <p className="px-3 py-3 text-xs text-slate-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">No matching projects.</p>
            ) : (
              results.map((t) => {
                const already = linked.has(t.threadKey)
                return (
                  <button
                    key={t.threadKey}
                    disabled={already}
                    onClick={() => { onLink(t.threadKey); setOpen(false); setQ('') }}
                    className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition ${already ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-700">{t.projectName}</span>
                      <span className="block truncate text-slate-400">{[t.purchaser, t.region].filter(Boolean).join(' · ') || t.threadKey}</span>
                    </span>
                    {already && <span className="shrink-0 text-[10px] text-slate-400">Linked</span>}
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-700">{value || '—'}</dd>
    </div>
  )
}
