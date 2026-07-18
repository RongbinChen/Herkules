import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

// Known Chinese province/region names — used to suggest options in the location
// filter (imported customers carry a province tag).
const CHINA_PROVINCES = new Set([
  'Anhui', 'Beijing', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong', 'Guangxi',
  'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan',
  'Inner Mongolia', 'Jiangsu', 'Jiangxi', 'Jilin', 'Liaoning', 'Ningxia',
  'Qinghai', 'Shaanxi', 'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Tianjin',
  'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang', 'Hong Kong', 'Macau', 'Taiwan',
])

// English province → Chinese core name, so a Chinese address ("上海市…") can be
// matched by an English "Shanghai" filter without the substring pitfalls of the
// English word (e.g. a Beijing "Shanghai Center" building name).
const PROVINCE_ZH = {
  Anhui: '安徽', Beijing: '北京', Chongqing: '重庆', Fujian: '福建', Gansu: '甘肃',
  Guangdong: '广东', Guangxi: '广西', Guizhou: '贵州', Hainan: '海南', Hebei: '河北',
  Heilongjiang: '黑龙江', Henan: '河南', Hubei: '湖北', Hunan: '湖南',
  'Inner Mongolia': '内蒙古', Jiangsu: '江苏', Jiangxi: '江西', Jilin: '吉林',
  Liaoning: '辽宁', Ningxia: '宁夏', Qinghai: '青海', Shaanxi: '陕西', Shandong: '山东',
  Shanghai: '上海', Shanxi: '山西', Sichuan: '四川', Tianjin: '天津', Tibet: '西藏',
  Xinjiang: '新疆', Yunnan: '云南', Zhejiang: '浙江', 'Hong Kong': '香港',
  Macau: '澳门', Taiwan: '台湾',
}

// Persist the list's filters across navigation (e.g. into a customer detail
// page and back), scoped to the browser session.
const FILTERS_KEY = 'customerListFilters'
const SELECTED_KEY = 'customerListSelected'
function loadSavedFilters() {
  try {
    return JSON.parse(sessionStorage.getItem(FILTERS_KEY)) || {}
  } catch {
    return {}
  }
}
function loadSavedSelection() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SELECTED_KEY)) || [])
  } catch {
    return new Set()
  }
}

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
  // Keep the list/map view in the URL so returning from a customer detail page
  // (e.g. via the map's "Details" link) can restore the map view.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'map' ? 'map' : 'list'
  const setView = (v) => {
    const next = new URLSearchParams(searchParams)
    if (v === 'map') next.set('view', 'map')
    else next.delete('view')
    setSearchParams(next, { replace: true })
  }

  // Restore the last-used filters so returning from a detail page keeps them.
  const savedFilters = useMemo(loadSavedFilters, [])
  const [search, setSearch] = useState(savedFilters.search || '')
  const [statusFilter, setStatusFilter] = useState(savedFilters.status || '')
  const [tierFilter, setTierFilter] = useState(savedFilters.tier || '')
  const [tagFilter, setTagFilter] = useState(savedFilters.tag || '')
  const [locationFilters, setLocationFilters] = useState(savedFilters.locations || [])
  const [locationInput, setLocationInput] = useState('')
  const [selectedIds, setSelectedIds] = useState(loadSavedSelection)
  const [shareUrl, setShareUrl] = useState('')
  const [sharing, setSharing] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

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

  // Split tags into province tags (for the location filter) vs the rest
  // (industries). Match provinces case-insensitively so stray casing (e.g. a
  // lowercase "shanghai") still resolves to the canonical province name.
  const provinceByNorm = useMemo(
    () => new Map([...CHINA_PROVINCES].map((p) => [p.toLowerCase(), p])),
    [],
  )
  const provinceOptions = useMemo(() => {
    const set = new Set()
    allTags.forEach((t) => {
      const canon = provinceByNorm.get(String(t).trim().toLowerCase())
      if (canon) set.add(canon)
    })
    return Array.from(set).sort()
  }, [allTags, provinceByNorm])
  const industryOptions = useMemo(
    () => allTags.filter((t) => !provinceByNorm.has(String(t).trim().toLowerCase())),
    [allTags, provinceByNorm],
  )

  // Persist filters so they survive navigating into a customer and back.
  useEffect(() => {
    sessionStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({
        search,
        status: statusFilter,
        tier: tierFilter,
        tag: tagFilter,
        locations: locationFilters,
      }),
    )
  }, [search, statusFilter, tierFilter, tagFilter, locationFilters])

  // Keep the checked customers across navigation too.
  useEffect(() => {
    sessionStorage.setItem(SELECTED_KEY, JSON.stringify([...selectedIds]))
  }, [selectedIds])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const locs = locationFilters.map((l) => l.trim().toLowerCase()).filter(Boolean)
    return customers.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (tierFilter && c.tier !== tierFilter) return false
      if (tagFilter && !(c.tags || []).includes(tagFilter)) return false
      if (locs.length) {
        // Match ANY selected location (OR). Known provinces match the province
        // tag exactly (so "First Shanghai Center" in Beijing isn't pulled into a
        // Shanghai filter); free keywords fall back to an address+tags substring.
        const geo = [c.address, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase()
        const hit = locs.some((loc) => {
          const provinceCanon = provinceByNorm.get(loc)
          if (provinceCanon) {
            const hasTag = (c.tags || []).some(
              (t) => provinceByNorm.get(String(t).trim().toLowerCase()) === provinceCanon,
            )
            if (hasTag) return true
            // Fallback: a Chinese address that names the province/city (e.g.
            // "上海市…"). Uses the Chinese name so an English "Shanghai Center"
            // in a Beijing address isn't matched.
            const zh = PROVINCE_ZH[provinceCanon]
            return zh ? (c.address || '').includes(zh) : false
          }
          return geo.includes(loc)
        })
        if (!hit) return false
      }
      if (q) {
        const hay = [c.name, c.contactName, c.contactPhone, c.address, c.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [customers, search, statusFilter, tierFilter, tagFilter, locationFilters, provinceByNorm])

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

  function addLocation(value) {
    const t = value.trim()
    if (!t) return
    setLocationFilters((prev) =>
      prev.some((x) => x.toLowerCase() === t.toLowerCase()) ? prev : [...prev, t],
    )
    setLocationInput('')
  }
  function removeLocation(loc) {
    setLocationFilters((prev) => prev.filter((x) => x !== loc))
  }

  function toggleSelect(id, event) {
    event?.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.id))
      else filtered.forEach((c) => next.add(c.id))
      return next
    })
  }

  async function shareSelected() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setSharing(true)
    try {
      const res = await customersAPI.createShare({ customerIds: ids })
      setShareUrl(`${window.location.origin}/customers/share/${res.data.token}`)
      setShareCopied(false)
    } catch (err) {
      console.error('Failed to create share link', err)
      window.alert('Failed to create share link')
    } finally {
      setSharing(false)
    }
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', shareUrl)
    }
  }

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand-500'

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
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              List
            </button>
            <button
              onClick={() => setView('map')}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${view === 'map' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              Map
            </button>
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={shareSelected}
              disabled={sharing}
              title="Create a view-only share link for the selected customers"
              className="whitespace-nowrap rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
            >
              {sharing ? 'Creating…' : `Share ${selectedIds.size} selected`}
            </button>
          )}
          <button
            onClick={() => setTripOpen(true)}
            disabled={filtered.length === 0}
            title="Schedule the currently filtered customers into a trip"
            className="whitespace-nowrap rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
          >
            Schedule trip
          </button>
          <button
            onClick={openCreate}
            className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
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
          className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 outline-none transition focus:border-brand-500"
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
        {industryOptions.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={selectCls}>
            <option value="">All industries</option>
            {industryOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 focus-within:border-brand-500">
          {locationFilters.map((loc) => (
            <span
              key={loc}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
            >
              {loc}
              <button
                type="button"
                onClick={() => removeLocation(loc)}
                className="text-brand-400 hover:text-brand-700"
              >
                ×
              </button>
            </span>
          ))}
          <input
            list="province-options"
            value={locationInput}
            onChange={(e) => {
              const v = e.target.value
              // Clicking a datalist suggestion fires change with the full value.
              if (provinceOptions.includes(v)) addLocation(v)
              else setLocationInput(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLocation(locationInput)
              } else if (e.key === 'Backspace' && !locationInput && locationFilters.length) {
                removeLocation(locationFilters[locationFilters.length - 1])
              }
            }}
            placeholder={locationFilters.length ? 'Add location…' : 'Province / location...'}
            className="min-w-[110px] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-slate-700 outline-none"
          />
        </div>
        <datalist id="province-options">
          {provinceOptions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">Loading...</p>
      ) : view === 'map' ? (
        <CustomerMap customers={filtered} onSelect={(c) => navigate(`/customers/${c.id}?from=map`)} />
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
              className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 transition active:bg-brand-50/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggleSelect(c.id, e)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                  />
                  <p className="min-w-0 font-semibold text-slate-800">{c.name}</p>
                </div>
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
                <button onClick={(e) => openEdit(c, e)} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50">Edit</button>
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
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title="Select all filtered customers"
                    className="h-4 w-4 cursor-pointer accent-brand-600"
                  />
                </th>
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
                  className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-brand-50/50"
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={(e) => toggleSelect(c.id, e)}
                      className="h-4 w-4 cursor-pointer accent-brand-600"
                    />
                  </td>
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
                        className="rounded-md px-2 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50"
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
        existingCustomers={customers}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          const wasCreate = !editing
          load()
          if (wasCreate) {
            // Clear filters so a freshly created customer is visible — it may not
            // match the previously active filter (e.g. a province chip).
            setSearch('')
            setStatusFilter('')
            setTierFilter('')
            setTagFilter('')
            setLocationFilters([])
            setLocationInput('')
          }
        }}
      />

      <TripModal
        isOpen={tripOpen}
        trip={null}
        initialCustomerIds={filtered.map((c) => c.id)}
        onClose={() => setTripOpen(false)}
        onSaved={(created) => navigate(`/trips/${created.id}`)}
      />

      {shareUrl && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={() => setShareUrl('')}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Share link ready</h3>
            <p className="mt-1 text-sm text-slate-500">
              Anyone with this link can view the selected {selectedIds.size} customer(s) and their
              map — no login needed. Contact phone / email / notes are hidden.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
              />
              <button
                onClick={copyShareUrl}
                className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                {shareCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Open link
              </a>
              <button
                onClick={() => setShareUrl('')}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
