import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { hotProjectsAPI, customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Button, Input, Textarea, Badge } from './ui'

// Internal sales open/potential projects list (from the WAV Excel template).
// Sensitive module: per-record visibility (TEAM | PRIVATE = owner+admin only).

const CATEGORIES = [
  { key: 'OPEN', label: 'Open Projects' },
  { key: 'POTENTIAL', label: 'Potential Projects' },
]
const PRIORITY = {
  1: { label: '1 · High', cls: 'bg-red-50 text-red-600 ring-red-200' },
  2: { label: '2 · Mid', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
  3: { label: '3 · Offer done', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
}

const fmtDate = (d) => {
  if (!d) return ''
  try { return new Date(d).toISOString().slice(0, 10) } catch { return '' }
}

// ── Create / edit modal ──────────────────────────────────────────────────────
function ProjectModal({ project, category, onClose, onSaved }) {
  const isNew = !project
  const [form, setForm] = useState(() => ({
    category: project?.category || category || 'OPEN',
    customer: project?.customer || '',
    customerId: project?.customerId || project?.customerRef?.id || '',
    dateOfReceipt: fmtDate(project?.dateOfReceipt),
    processor: project?.processor || '',
    forwardedOn: project?.forwardedOn || '',
    requirements: project?.requirements || '',
    deadline: fmtDate(project?.deadline),
    priority: project?.priority || '',
    visibility: project?.visibility || 'TEAM',
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Searchable link into the Customers module. Typing keeps the free text and
  // clears the link; picking a suggestion sets both name + customerId.
  const [custList, setCustList] = useState([])
  const [custOpen, setCustOpen] = useState(false)
  useEffect(() => {
    customersAPI.getAll().then((r) => setCustList(r.data || [])).catch(() => {})
  }, [])
  const cq = form.customer.trim().toLowerCase()
  const custMatches = cq ? custList.filter((c) => c.name.toLowerCase().includes(cq)).slice(0, 20) : []

  const save = async () => {
    if (!form.customer.trim()) { setErr('Customer 必填'); return }
    setErr(''); setSaving(true)
    try {
      const payload = { ...form, dateOfReceipt: form.dateOfReceipt || null, deadline: form.deadline || null, priority: form.priority || null }
      if (isNew) await hotProjectsAPI.create(payload)
      else await hotProjectsAPI.update(project.id, payload)
      onSaved()
    } catch (e) {
      setErr(e.response?.data?.error || '保存失败')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onClose}>
      <div className="my-4 w-full max-w-xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">{isNew ? 'New Project' : 'Edit Project'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Category
              <select value={form.category} onChange={set('category')} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Priority
              <select value={form.priority} onChange={set('priority')} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">—</option>
                <option value="1">1 · High</option>
                <option value="2">2 · Mid time</option>
                <option value="3">3 · Offer done</option>
              </select>
            </label>
          </div>
          <div className="text-xs font-semibold text-slate-600">
            <div className="flex items-center justify-between">
              <span>Customer *</span>
              {form.customerId ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                  ✓ Linked to Customers
                  <button type="button" onClick={() => setForm((f) => ({ ...f, customerId: '' }))}
                    className="text-slate-300 hover:text-rose-500" title="Unlink">✕</button>
                </span>
              ) : (
                <span className="text-[10px] font-normal text-slate-400">type to search & link</span>
              )}
            </div>
            <div className="relative mt-1">
              <Input
                value={form.customer}
                placeholder="Customer name — pick a suggestion to link"
                className="truncate pr-8"
                onChange={(e) => { setForm((f) => ({ ...f, customer: e.target.value, customerId: '' })); setCustOpen(true) }}
                onFocus={() => setCustOpen(true)}
                onBlur={() => setTimeout(() => setCustOpen(false), 150)}
              />
              {custOpen && !form.customerId && custMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {custMatches.map((c) => (
                    <li key={c.id}>
                      <button type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setForm((f) => ({ ...f, customer: c.name, customerId: c.id })); setCustOpen(false) }}
                        className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Processor（负责人）
              <Input value={form.processor} onChange={set('processor')} placeholder="e.g. Chen / Bao" className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Forwarded on
              <Input value={form.forwardedOn} onChange={set('forwardedOn')} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Date of Receipt
              <Input type="date" value={form.dateOfReceipt} onChange={set('dateOfReceipt')} className="mt-1 min-w-0 max-w-full appearance-none" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Deadline for Submission
              <Input type="date" value={form.deadline} onChange={set('deadline')} className="mt-1 min-w-0 max-w-full appearance-none" />
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-600">
            Requirements / Technical Remarks / Machine Selection
            <Textarea rows={3} value={form.requirements} onChange={set('requirements')} className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Visibility（保密级别）
            <select value={form.visibility} onChange={set('visibility')} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="TEAM">团队可见 Team</option>
              <option value="PRIVATE">🔒 仅负责人+管理员 Private</option>
            </select>
          </label>
          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </div>
  )
}

// ── One project row (expandable) ─────────────────────────────────────────────
function ProjectRow({ p, onChanged, currentUserId, isAdmin }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const pr = PRIORITY[p.priority]
  const canManage = isAdmin || p.ownerId === currentUserId

  const loadDetail = async () => {
    try { const { data } = await hotProjectsAPI.get(p.id); setDetail(data) } catch { /* noop */ }
  }
  const toggle = () => { const next = !open; setOpen(next); if (next && !detail) loadDetail() }

  const addNote = async () => {
    if (!note.trim() || posting) return
    setPosting(true)
    try {
      await hotProjectsAPI.addUpdate(p.id, { content: note.trim() })
      setNote('')
      await loadDetail()
      onChanged()
    } catch (e) {
      window.alert(e.response?.data?.error || 'Failed to add update')
    } finally { setPosting(false) }
  }

  const removeProject = async () => {
    if (!window.confirm(`Delete project "${p.customer}"? All updates will be removed.`)) return
    try { await hotProjectsAPI.delete(p.id); onChanged() } catch { window.alert('Delete failed (owner/admin only)') }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-brand-200">
      {/* Row header */}
      <div onClick={toggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') toggle() }}
        className="flex w-full cursor-pointer items-start justify-between gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {p.sortNo != null && <span className="text-xs font-bold text-slate-300">#{p.sortNo}</span>}
            <span className="font-semibold text-slate-800">{p.customer}</span>
            {p.visibility === 'PRIVATE' && <span title="仅负责人+管理员可见">🔒</span>}
            {pr && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${pr.cls}`}>{pr.label}</span>}
            {(p.customerRef || p.customerId) && (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/customers/${p.customerRef?.id || p.customerId}`) }}
                title={`Open customer: ${p.customerRef?.name || p.customer}`}
                className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 transition hover:bg-brand-100">
                👤 Customer ↗
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {p.processor && <span>👤 {p.processor}</span>}
            {p.deadline && <span className="font-semibold text-red-500">Due {fmtDate(p.deadline)}</span>}
            {p.dateOfReceipt && <span>Received {fmtDate(p.dateOfReceipt)}</span>}
            <span>{p._count?.updates ?? 0} updates</span>
          </div>
          {!open && p.updates?.[0] && (
            <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{p.updates[0].content}</p>
          )}
        </div>
        <span className={`mt-1 shrink-0 text-slate-300 transition ${open ? 'rotate-180' : ''}`}>▾</span>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
          {p.requirements && (
            <div>
              <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Requirements / Machine Selection</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{p.requirements}</p>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Status updates</h4>
            {!detail ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : detail.updates.length === 0 ? (
              <p className="text-xs text-slate-400">No updates yet.</p>
            ) : (
              <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
                {detail.updates.map((u) => (
                  <li key={u.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-400" />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {u.date && <span className="font-semibold">{fmtDate(u.date)}</span>}
                      {u.author?.name && <span>✍️ {u.author.name}</span>}
                      {(isAdmin || u.author?.id === currentUserId) && (
                        <button
                          onClick={async () => {
                            if (!window.confirm('Delete this update?')) return
                            try { await hotProjectsAPI.deleteUpdate(p.id, u.id); await loadDetail(); onChanged() } catch { window.alert('Delete failed') }
                          }}
                          className="text-slate-300 hover:text-rose-500">✕</button>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{u.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Add update */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Add a status update…（会记录你的名字和日期）" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {canManage && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
                    <button onClick={removeProject} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">Delete</button>
                  </>
                )}
              </div>
              <Button size="sm" onClick={addNote} disabled={posting || !note.trim()}>
                {posting ? 'Posting…' : '＋ Add update'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <ProjectModal project={detail || p} onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); loadDetail(); onChanged() }} />
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HotProjects() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const [category, setCategory] = useState('OPEN')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [priority, setPriority] = useState('')
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await hotProjectsAPI.list({ category, q: qDebounced || undefined, priority: priority || undefined })
      setProjects(data)
    } catch (e) {
      console.error('Failed to load hot projects', e)
    } finally { setLoading(false) }
  }, [category, qDebounced, priority])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Header */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">🔥 Hot Projects</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              内部销售项目跟踪（敏感数据，🔒 项目仅负责人与管理员可见）
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate('/')}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Modules
            </button>
            <Button onClick={() => setCreateOpen(true)}>＋ New Project</Button>
          </div>
        </div>

        {/* Category tabs + filters */}
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${category === c.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
              <option value="">Priority: All</option>
              <option value="1">1 · High</option>
              <option value="2">2 · Mid time</option>
              <option value="3">3 · Offer done</option>
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / requirements / updates"
              className="w-56 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No projects.</div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <ProjectRow key={p.id} p={p} onChanged={load} currentUserId={user?.id} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <ProjectModal category={category} onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load() }} />
      )}
    </div>
  )
}
