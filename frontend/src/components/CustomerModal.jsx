import { useEffect, useRef, useState } from 'react'
import { customersAPI } from '../api/api'
import { STATUS_ORDER, TIER_ORDER, CUSTOMER_STATUS, CUSTOMER_TIER } from '../constants/customer'
import { PROVINCES, detectProvince } from '../utils/province'

const PROVINCE_SET = new Set(PROVINCES.map((p) => p.toLowerCase()))

const EMPTY = {
  name: '',
  status: 'LEAD',
  tier: 'C',
  address: '',
  notes: '',
  latitude: '',
  longitude: '',
  province: '',
  tags: [],
  contacts: [{ name: '', title: '', phone: '', email: '' }],
}

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white'

// Create / edit customer. `customer` null → create mode.
export default function CustomerModal({ isOpen, customer, onClose, onSaved, existingCustomers = [] }) {
  const [form, setForm] = useState(EMPTY)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geoError, setGeoError] = useState('')
  const lastGeocodedAddress = useRef('')
  const provinceEdited = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setGeoError('')
    setTagInput('')
    if (customer) {
      const savedContacts =
        Array.isArray(customer.contacts) && customer.contacts.length
          ? customer.contacts
          : customer.contactName || customer.contactPhone || customer.email
            ? [{ name: customer.contactName || '', title: '', phone: customer.contactPhone || '', email: customer.email || '' }]
            : [{ name: '', title: '', phone: '', email: '' }]
      const provinceTag =
        (customer.tags || []).find((t) => PROVINCE_SET.has(String(t).trim().toLowerCase())) || ''
      setForm({
        name: customer.name || '',
        status: customer.status || 'LEAD',
        tier: customer.tier || 'C',
        address: customer.address || '',
        notes: customer.notes || '',
        latitude: customer.latitude ?? '',
        longitude: customer.longitude ?? '',
        province: provinceTag,
        tags: customer.tags || [],
        contacts: savedContacts.map((c) => ({
          name: c.name || '',
          title: c.title || '',
          phone: c.phone || '',
          email: c.email || '',
        })),
      })
      lastGeocodedAddress.current = customer.address || ''
      provinceEdited.current = !!provinceTag
    } else {
      setForm(EMPTY)
      lastGeocodedAddress.current = ''
      provinceEdited.current = false
    }
  }, [isOpen, customer])

  if (!isOpen) return null

  // Warn (don't block) if a same-named customer already exists — create mode
  // only. Normalizes away case/punctuation so "ABB Co." ≈ "ABB Co".
  const dupNorm = (s) =>
    String(s || '').trim().toLowerCase().replace(/[^a-z0-9一-龥]/g, '')
  const duplicate =
    !customer && form.name.trim()
      ? existingCustomers.find((c) => dupNorm(c.name) === dupNorm(form.name))
      : null

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

  function addContact() {
    setForm((prev) => ({
      ...prev,
      contacts: [...prev.contacts, { name: '', title: '', phone: '', email: '' }],
    }))
  }
  function updateContact(i, field, value) {
    setForm((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)),
    }))
  }
  function removeContact(i) {
    setForm((prev) => ({ ...prev, contacts: prev.contacts.filter((_, idx) => idx !== i) }))
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
    // Auto-fill province from the address unless the user set it manually.
    if (addr && !provinceEdited.current) {
      const p = detectProvince(addr)
      if (p) setForm((prev) => ({ ...prev, province: p }))
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
    const nonProvinceTags = form.tags.filter(
      (t) => !PROVINCE_SET.has(String(t).trim().toLowerCase()),
    )
    const contacts = form.contacts
      .map((c) => ({
        name: c.name.trim(),
        title: c.title.trim(),
        phone: c.phone.trim(),
        email: c.email.trim(),
      }))
      .filter((c) => c.name || c.phone || c.email || c.title)
    const payload = {
      name: form.name.trim(),
      status: form.status,
      tier: form.tier,
      address: form.address.trim(),
      notes: form.notes.trim(),
      tags: form.province ? [...nonProvinceTags, form.province] : nonProvinceTags,
      contacts,
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
            {duplicate && (
              <p className="mt-1.5 text-xs font-medium text-amber-600">
                ⚠ A customer named “{duplicate.name}” already exists. You can still create it if
                this is a different entity.
              </p>
            )}
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

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Contacts</span>
              <button
                type="button"
                onClick={addContact}
                className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                + Add contact
              </button>
            </div>
            <div className="space-y-3">
              {form.contacts.map((c, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">
                      {i === 0 ? 'Primary contact' : `Contact ${i + 1}`}
                    </span>
                    {form.contacts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeContact(i)}
                        className="text-xs font-medium text-red-500 transition hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={c.name} onChange={(e) => updateContact(i, 'name', e.target.value)} className={inputCls} placeholder="Name (e.g. Mr. Zhang)" />
                    <input value={c.title} onChange={(e) => updateContact(i, 'title', e.target.value)} className={inputCls} placeholder="Title (e.g. Purchasing Mgr)" />
                    <input value={c.phone} onChange={(e) => updateContact(i, 'phone', e.target.value)} className={inputCls} placeholder="Phone 138..." />
                    <input type="email" value={c.email} onChange={(e) => updateContact(i, 'email', e.target.value)} className={inputCls} placeholder="name@company.com" />
                  </div>
                </div>
              ))}
            </div>
          </div>

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

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Province <span className="text-slate-400">(auto-detected from address, editable)</span>
            </span>
            <select
              value={form.province}
              onChange={(e) => {
                provinceEdited.current = true
                update('province', e.target.value)
              }}
              className={inputCls}
            >
              <option value="">— Select province —</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Tags</span>
            <div className="flex flex-wrap items-center gap-2">
              {form.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="text-brand-400 hover:text-brand-700">&times;</button>
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
                className="min-w-[120px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white"
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
                className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
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
          <button onClick={handleSubmit} disabled={saving} className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
            {saving ? 'Saving...' : customer ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </div>
    </div>
  )
}
