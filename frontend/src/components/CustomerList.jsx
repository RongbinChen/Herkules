import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import CustomerModal from './CustomerModal'
import CustomerMap from './CustomerMap'
import TripModal from './TripModal'
import {
  STATUS_ORDER,
  TIER_ORDER,
  statusMeta,
  tierMeta,
} from '../constants/customer'

function StatusBadge({ status }) {
  const meta = statusMeta(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function TierBadge({ tier }) {
  const meta = tierMeta(tier)
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>{meta.short}</span>
  )
}

export default function CustomerList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('list') // 'list' | 'map'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [tripOpen, setTripOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const response = await customersAPI.getAll()
      setCustomers(response.data)
    } catch (err) {
      console.error('Failed to load customers', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const allTags = useMemo(() => {
    const set = new Set()
    customers.forEach((c) => (c.tags || []).forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (tierFilter && c.tier !== tierFilter) return false
      if (tagFilter && !(c.tags || []).includes(tagFilter)) return false
      if (q) {
        const hay = [c.name, c.contactName, c.contactPhone, c.address, c.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [customers, search, statusFilter, tierFilter, tagFilter])

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(customer, event) {
    event.stopPropagation()
    setEditing(customer)
    setModalOpen(true)
  }

  async function handleDelete(customer, event) {
    event.stopPropagation()
    if (!window.confirm(`Delete customer "${customer.name}"? This cannot be undone.`)) return
    try {
      await customersAPI.delete(customer.id)
      await load()
    } catch (err) {
      console.error('Failed to delete customer', err)
      window.alert('Failed to delete customer. Admin permission is required.')
    }
  }

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500'

  return (
    <div className="mx-auto max-w-[1400px] p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            ← Modules
          </button>
          <h1 className="text-2xl font-bold text-slate-800">Customers</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-500">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView('list')}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${view === 'list' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              List
            </button>
            <button
              onClick={() => setView('map')}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${view === 'map' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              Map
            </button>
          </div>
          <button
            onClick={() => setTripOpen(true)}
            disabled={filtered.length === 0}
            title="Schedule the currently filtered customers into a trip"
            className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 disabled:opacity-50"
          >
            🗺️ Schedule trip
          </button>
          <button
            onClick={openCreate}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
          >
            + New customer
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, contact, phone, address..."
          className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{statusMeta(s).label}</option>
          ))}
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className={selectCls}>
          <option value="">All tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>{tierMeta(t).label}</option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={selectCls}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">Loading...</p>
      ) : view === 'map' ? (
        <CustomerMap customers={filtered} onSelect={(c) => navigate(`/customers/${c.id}`)} />
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-slate-400">No customers match your filters.</p>
      ) : (
        <>
        {/* Mobile: card list */}
        <div className="space-y-3 sm:hidden">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/customers/${c.id}`)}
              className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 transition active:bg-sky-50/60"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold text-slate-800">{c.name}</p>
                <TierBadge tier={c.tier} />
              </div>
              {c.address && <p className="mt-1 text-xs text-slate-400">{c.address}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge status={c.status} />
                <span className="text-xs text-slate-500">{c._count?.events ?? 0} visit(s)</span>
                {c.contactName && (
                  <span className="text-xs text-slate-500">· {c.contactName}{c.contactPhone ? ` ${c.contactPhone}` : ''}</span>
                )}
              </div>
              {(c.tags || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(c.tags || []).map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tag}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
                <button onClick={(e) => openEdit(c, e)} className="rounded-md px-2 py-1 text-xs font-semibold text-sky-600 transition hover:bg-sky-50">Edit</button>
                {isAdmin && (
                  <button onClick={(e) => handleDelete(c, e)} className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* Desktop: table */}
        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3 text-center">Visits</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-sky-50/50"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{c.name}</p>
                    {c.address && <p className="mt-0.5 text-xs text-slate-400">{c.address}</p>}
                  </td>
                  <td className="px-4 py-3"><TierBadge tier={c.tier} /></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.contactName || '—'}
                    {c.contactPhone && <p className="text-xs text-slate-400">{c.contactPhone}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-slate-700">{c._count?.events ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => openEdit(c, e)}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-sky-600 transition hover:bg-sky-50"
                      >
                        Edit
                      </button>
                      {isAdmin && (
                        <button
                          onClick={(e) => handleDelete(c, e)}
                          className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <CustomerModal
        isOpen={modalOpen}
        customer={editing}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      <TripModal
        isOpen={tripOpen}
        trip={null}
        initialCustomerIds={filtered.map((c) => c.id)}
        onClose={() => setTripOpen(false)}
        onSaved={(created) => navigate(`/trips/${created.id}`)}
      />
    </div>
  )
}
