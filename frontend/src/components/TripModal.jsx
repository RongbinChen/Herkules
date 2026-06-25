import { useEffect, useMemo, useState } from 'react'
import { tripsAPI, customersAPI, usersAPI } from '../api/api'

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white'

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(value) {
  const d = value ? new Date(value) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

// Create / edit a trip. `trip` null → create mode.
export default function TripModal({ isOpen, trip, initialCustomerIds = [], onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const [customers, setCustomers] = useState([])
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setSearch('')
    customersAPI.getAll().then((r) => setCustomers(r.data)).catch(() => setCustomers([]))
    usersAPI.getVisible().then((r) => setUsers(r.data)).catch(() =>
      usersAPI.getAll().then((r) => setUsers(r.data)).catch(() => setUsers([])),
    )
    if (trip) {
      setTitle(trip.title || '')
      setAssigneeId(trip.assignee?.id ? String(trip.assignee.id) : '')
      setStartTime(toLocalInput(trip.startTime))
      setEndTime(toLocalInput(trip.endTime))
      setNotes(trip.notes || '')
      setSelectedIds((trip.stops || []).map((s) => s.customer.id))
    } else {
      const now = new Date()
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
      setTitle('')
      setAssigneeId('')
      setStartTime(toLocalInput(now))
      setEndTime(toLocalInput(tomorrow))
      setNotes('')
      setSelectedIds(initialCustomerIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trip])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c) =>
      [c.name, c.address, c.contactName].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [customers, search])

  if (!isOpen) return null

  function toggle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!title.trim()) return setError('请填写行程标题')
    if (selectedIds.length === 0) return setError('请至少选择一个客户')
    if (new Date(endTime) <= new Date(startTime)) return setError('结束时间必须晚于开始时间')
    setSaving(true)
    setError('')
    const payload = {
      title: title.trim(),
      notes: notes.trim() || undefined,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      customerIds: selectedIds,
    }
    try {
      const res = trip ? await tripsAPI.update(trip.id, payload) : await tripsAPI.create(payload)
      await onSaved?.(res.data)
      onClose()
    } catch (err) {
      console.error('Failed to save trip', err)
      const detail = err?.response?.data?.error
      setError(typeof detail === 'string' ? detail : '保存行程失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Trip</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {trip ? '编辑行程' : '安排行程'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">行程标题</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="例如：华东客户拜访" required />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">负责人（同事）</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">— 未指定 —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <div />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">开始时间</span>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">结束时间</span>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} required />
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">选择客户（拜访点）</span>
              <span className="text-xs text-slate-400">已选 {selectedIds.length}</span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索客户名称、地址、联系人..."
              className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white"
            />
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">无匹配客户</p>
              ) : (
                filtered.map((c) => {
                  const checked = selectedIds.includes(c.id)
                  const hasCoords = typeof c.latitude === 'number' && typeof c.longitude === 'number'
                  return (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-sky-50/50"
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} className="h-4 w-4 accent-sky-600" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        {c.address && <span className="block truncate text-xs text-slate-400">{c.address}</span>}
                      </span>
                      {!hasCoords && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600" title="无坐标，不会显示在地图上">
                          无坐标
                        </span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">行程顺序将按地理距离自动优化。</p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">备注</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="行程目的、注意事项..." />
          </label>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <button onClick={onClose} type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            取消
          </button>
          <button onClick={handleSubmit} disabled={saving} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60">
            {saving ? '保存中...' : trip ? '保存修改' : '生成行程'}
          </button>
        </div>
      </div>
    </div>
  )
}
