import { useState } from 'react'
import { visitReportsAPI } from '../api/api'
import { Button, Input, Textarea, Badge } from './ui'

const SECTIONS = [
  { key: 'attendees', label: '参会人 Attendees' },
  { key: 'needs', label: '客户需求 Needs' },
  { key: 'equipment', label: '谈及设备 Equipment' },
  { key: 'competitors', label: '竞争对手 Competitors' },
  { key: 'budgetTimeline', label: '预算 / 时间 Budget & Timeline' },
  { key: 'nextSteps', label: '下一步 Next steps' },
  { key: 'risks', label: '风险 Risks' },
]

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function VisitReportModal({ report, customers = [], currentUserId, isAdmin, onClose, onSaved }) {
  const isNew = !report
  const canEdit = isNew || report?.canEdit || report?.author?.id === currentUserId || isAdmin
  const [editing, setEditing] = useState(isNew)
  const [form, setForm] = useState(() => ({
    title: report?.title || '',
    visitDate: (report?.visitDate ? new Date(report.visitDate).toISOString() : '').slice(0, 10) || todayISO(),
    customerId: report?.customer?.id || report?.customerId || '',
    summary: report?.summary || '',
    content: report?.content || {},
    rawNotes: report?.rawNotes || '',
    status: report?.status || 'DRAFT',
  }))
  const [photos, setPhotos] = useState([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Searchable customer picker (477+ customers — a plain dropdown is unusable).
  const [custQuery, setCustQuery] = useState(report?.customer?.name || '')
  const [custOpen, setCustOpen] = useState(false)
  const custMatches = custQuery.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(custQuery.trim().toLowerCase())).slice(0, 30)
    : []

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setContent = (k, v) => setForm((f) => ({ ...f, content: { ...f.content, [k]: v } }))

  const generate = async () => {
    if (!form.rawNotes.trim() && photos.length === 0) { setErr('请先填写随手记或上传照片'); return }
    setErr(''); setGenerating(true)
    try {
      const fd = new FormData()
      fd.append('rawNotes', form.rawNotes)
      if (form.customerId) fd.append('customerId', form.customerId)
      if (form.visitDate) fd.append('visitDate', form.visitDate)
      photos.forEach((p) => fd.append('images', p))
      const { data } = await visitReportsAPI.generate(fd)
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
        summary: data.summary || '',
        content: data.content || {},
        rawNotes: data.rawNotes || f.rawNotes,
      }))
    } catch (e) {
      setErr(e.response?.data?.error || 'AI 生成失败')
    } finally { setGenerating(false) }
  }

  const save = async (status) => {
    if (!form.title.trim()) { setErr('标题必填'); return }
    setErr(''); setSaving(true)
    try {
      const payload = { ...form, status: status || form.status, customerId: form.customerId || null }
      if (isNew) await visitReportsAPI.create(payload)
      else await visitReportsAPI.update(report.id, payload)
      onSaved()
    } catch (e) {
      setErr(e.response?.data?.error || '保存失败')
    } finally { setSaving(false) }
  }

  const readOnly = !editing

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onClose}>
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">
            {isNew ? '新建拜访报告' : (editing ? '编辑拜访报告' : '拜访报告')}
          </h2>
          <div className="flex items-center gap-2">
            {!isNew && report?.status && <Badge tone={report.status === 'FINAL' ? 'green' : 'amber'}>{report.status === 'FINAL' ? '已定稿' : '草稿'}</Badge>}
            {!isNew && canEdit && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>编辑</Button>}
            <button onClick={onClose} aria-label="关闭" className="text-slate-400 hover:text-slate-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Meta */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              拜访日期
              <Input type="date" value={form.visitDate} disabled={readOnly} onChange={(e) => set('visitDate', e.target.value)} className="mt-1" />
            </label>
            <div className="text-xs font-semibold text-slate-600">
              客户
              <div className="relative mt-1">
                <Input
                  value={custQuery}
                  disabled={readOnly}
                  placeholder="输入客户名搜索…"
                  onChange={(e) => { setCustQuery(e.target.value); set('customerId', ''); setCustOpen(true) }}
                  onFocus={() => setCustOpen(true)}
                  onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                />
                {form.customerId && (
                  <button type="button" onClick={() => { set('customerId', ''); setCustQuery('') }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="清除">✕</button>
                )}
                {custOpen && !readOnly && custMatches.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {custMatches.map((c) => (
                      <li key={c.id}>
                        <button type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { set('customerId', c.id); setCustQuery(c.name); setCustOpen(false) }}
                          className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {custOpen && !readOnly && custQuery.trim() && custMatches.length === 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg">无匹配客户</div>
                )}
              </div>
            </div>
          </div>

          {/* Input + AI generate (create/edit only) */}
          {editing && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 text-xs font-bold text-slate-500">现场随手记 / 照片 → AI 整理</div>
              <Textarea rows={4} value={form.rawNotes} onChange={(e) => set('rawNotes', e.target.value)}
                placeholder="把现场谈的内容随手写下来（客户、需求、设备、对手、下一步…），或上传白板/资料照片，让 AI 整理成结构化报告。" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  ＋ 照片
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files)])} />
                </label>
                {photos.length > 0 && <span className="text-xs text-slate-500">{photos.length} 张照片</span>}
                <Button size="sm" onClick={generate} disabled={generating} className="ml-auto">
                  {generating ? 'AI 整理中…（约 10-30s）' : '✦ AI 生成报告'}
                </Button>
              </div>
            </div>
          )}

          {/* Title + summary */}
          <label className="block text-xs font-semibold text-slate-600">
            标题
            <Input value={form.title} disabled={readOnly} onChange={(e) => set('title', e.target.value)} className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            摘要
            <Textarea rows={2} value={form.summary || ''} disabled={readOnly} onChange={(e) => set('summary', e.target.value)} className="mt-1" />
          </label>

          {/* Structured sections */}
          <div className="grid grid-cols-1 gap-3">
            {SECTIONS.map((s) => (
              <label key={s.key} className="block text-xs font-semibold text-slate-600">
                {s.label}
                <Textarea rows={2} value={form.content?.[s.key] || ''} disabled={readOnly}
                  onChange={(e) => setContent(s.key, e.target.value)} className="mt-1"
                  placeholder={readOnly ? '—' : ''} />
              </label>
            ))}
          </div>

          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>

        {/* Footer */}
        {editing && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="secondary" onClick={() => save('DRAFT')} disabled={saving}>{saving ? '保存中…' : '存草稿'}</Button>
            <Button onClick={() => save('FINAL')} disabled={saving}>{saving ? '保存中…' : '定稿保存'}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
