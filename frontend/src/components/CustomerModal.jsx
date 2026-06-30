import { useEffect, useRef, useState } from 'react'
import { customersAPI } from '../api/api'
import { STATUS_ORDER, TIER_ORDER, CUSTOMER_STATUS, CUSTOMER_TIER } from '../constants/customer'

const EMPTY = {
  name: '',
  status: 'LEAD',
  tier: 'C',
  contactName: '',
  contactPhone: '',
  email: '',
  address: '',
  notes: '',
  latitude: '',
  longitude: '',
  tags: [],
}

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white'

// Create / edit customer. `customer` null → create mode.
export default function CustomerModal({ isOpen, customer, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geoError, setGeoError] = useState('')
  const lastGeocodedAddress = useRef('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setGeoError('')
    setTagInput('')
    if (customer) {
      setForm({
        name: customer.name || '',
        status: customer.status || 'LEAD',
        tier: customer.tier || 'C',
        contactName: customer.contactName || '',
        contactPhone: customer.contactPhone || '',
        email: customer.email || '',
        address: customer.address || '',
        notes: customer.notes || '',
        latitude: customer.latitude ?? '',
        longitude: customer.longitude ?? '',
        tags: customer.tags || [],
      })
      lastGeocodedAddress.current = customer.address || ''
    } else {
      setForm(EMPTY)
      lastGeocodedAddress.current = ''
    }
  }, [isOpen, customer])

  if (!isOpen) return null

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (!t || form.tags.includes(t)) {
      setTagInput('')
      return
    }
    setForm((prev) => ({ ...prev, tags: [...prev.tags, t] }))
    setTagInput('')
  }

  function removeTag(tag) {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }))
  }

  async function fetchCoords(address) {
    if (!address || !address.trim()) return
    setGeocoding(true)
    setGeoError('')
    try {
      const res = await customersAPI.geocode(address.trim())
      setForm((prev) => ({
        ...prev,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
      }))
      lastGeocodedAddress.current = address.trim()
    } catch (err) {
      // Show the backend's reason (e.g. DeepSeek out of balance) when present.
      setGeoError(err?.response?.data?.error || 'Could not find coordinates for this address')
    } finally {
      setGeocoding(false)
    }
  }

  function handleAddressBlur(e) {
    const addr = e.target.value.trim()
    if (addr && addr !== lastGeocodedAddress.current) {
      fetchCoords(addr)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Customer name is required')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      status: form.status,
      tier: form.tier,
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      tags: form.tags,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
    }
    if (Number.isNaN(payload.latitude)) payload.latitude = null
    if (Number.isNaN(payload.longitude)) payload.longitude = null
    try {
      const response = customer
        ? await customersAPI.update(customer.id, payload)
        : await customersAPI.create(payload)
      await onSaved?.(response.data)
      onClose()
    } catch (err) {
      console.error('Failed to save customer', err)
      const detail = err?.response?.data?.error
      setError(typeof detail === 'string' ? detail : 'Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-[24px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Customer</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {customer ? 'Edit customer' : 'New customer'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Company name</span>
            <input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className={inputCls}
              placeholder="e.g. Wuhan Heavy Industry Casting & Forging Co., Ltd."
              required
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Status</span>
              <select value={form.status} onChange={(e) => update('status', e.target.value)} className={inputCls}>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{CUSTOMER_STATUS[s].label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Tier</span>
              <select value={form.tier} onChange={(e) => update('tier', e.target.value)} className={inputCls}>
                {TIER_ORDER.map((t) => (
                  <option key={t} value={t}>{CUSTOMER_TIER[t].label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Contact name</span>
              <input value={form.contactName} onChange={(e) => update('contactName', e.target.value)} className={inputCls} placeholder="Mr. Zhang" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Contact phone</span>
              <input value={form.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} className={inputCls} placeholder="138..." />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className={inputCls} placeholder="name@company.com" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Address</span>
            <input
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              onBlur={handleAddressBlur}
              className={inputCls}
              placeholder="Street, City, Province, Country"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Tags</span>
            <div className="flex flex-wrap items-center gap-2">
              {form.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="text-sky-400 hover:text-sky-700">&times;</button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
                className="min-w-[120px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                placeholder="Add tag, press Enter"
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Background, relationship history, key decision makers..."
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Coordinates <span className="text-slate-400">(for map)</span>
              </span>
              <button
                type="button"
                onClick={() => fetchCoords(form.address)}
                disabled={geocoding || !form.address.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {geocoding ? (
                  <>
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Looking up...
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    Update coordinates
                  </>
                )}
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-500">Latitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => update('latitude', e.target.value)}
                  className={inputCls}
                  placeholder="30.59"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-500">Longitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => update('longitude', e.target.value)}
                  className={inputCls}
                  placeholder="114.30"
                />
              </label>
            </div>
            {geoError && <p className="mt-1.5 text-xs text-amber-600">{geoError}</p>}
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <button onClick={onClose} type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60">
            {saving ? 'Saving...' : customer ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </div>
    </div>
  )
}
