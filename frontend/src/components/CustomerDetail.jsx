import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import CustomerModal from './CustomerModal'
import { statusMeta, tierMeta } from '../constants/customer'

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
          <button onClick={() => setEditOpen(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700">
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
                <span key={tag} className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200">{tag}</span>
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

      <CustomerModal isOpen={editOpen} customer={customer} onClose={() => setEditOpen(false)} onSaved={load} />
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
