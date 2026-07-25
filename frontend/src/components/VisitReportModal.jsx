import { useState } from 'react'
import { visitReportsAPI, customersAPI } from '../api/api'
import { Button, Input, Textarea, Badge } from './ui'
import { STRINGS, SECTIONS_I18N, META_FIELDS_I18N } from '../i18n/visitReports'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function VisitReportModal({ report, createMode, customers = [], currentUserId, isAdmin, lang = 'en', onClose, onSaved }) {
  const t = STRINGS[lang]
  const SECTIONS = SECTIONS_I18N.map((s) => ({ key: s.key, label: s[lang] }))
  const META_FIELDS = META_FIELDS_I18N.map((m) => ({ key: m.key, label: m[lang] }))

  const isNew = !report
  // The "＋ New Report" entry chooser picks one of two creation paths:
  //   manual → type it up (notes/photos), no Word upload
  //   import → upload an existing .docx, no notes/photos
  // Editing an existing report is unaffected (createMode is undefined then).
  const isManualCreate = isNew && createMode === 'manual'
  const isImportCreate = isNew && createMode === 'import'
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
  const [docFile, setDocFile] = useState(null) // .docx to auto-import
  const [generating, setGenerating] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Searchable customer picker (477+ customers — a plain dropdown is unusable).
  const [custList, setCustList] = useState(customers)
  const [custQuery, setCustQuery] = useState(report?.customer?.name || '')
  const [custOpen, setCustOpen] = useState(false)
  const [creatingCust, setCreatingCust] = useState(false)
  const q = custQuery.trim().toLowerCase()
  const custMatches = q ? custList.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30) : []
  const exactMatch = q && custList.some((c) => c.name.toLowerCase() === q)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setContent = (k, v) => setForm((f) => ({ ...f, content: { ...f.content, [k]: v } }))
  const setMeta = (k, v) => setForm((f) => ({ ...f, content: { ...f.content, meta: { ...(f.content?.meta || {}), [k]: v } } }))
  const tables = Array.isArray(form.content?.tables) ? form.content.tables : []
  const meta = form.content?.meta || {}
  const hasMeta = META_FIELDS.some((mf) => meta[mf.key])

  // No matching customer → create one on the spot (name only; enrich later in Customers).
  const createCustomer = async () => {
    const name = custQuery.trim()
    if (!name || creatingCust) return
    setErr(''); setCreatingCust(true)
    try {
      const { data } = await customersAPI.create({ name })
      setCustList((prev) => [data, ...prev])
      set('customerId', data.id)
      setCustQuery(data.name)
      setCustOpen(false)
    } catch (e) {
      setErr(e.response?.data?.error || t.errCreateCustomerFailed)
    } finally { setCreatingCust(false) }
  }

  const generate = async () => {
    if (isImportCreate) {
      if (!docFile) { setErr(t.errNoDocument); return }
    } else if (!form.rawNotes.trim() && photos.length === 0 && !docFile) {
      setErr(t.errNoContentToGenerate); return
    }
    setErr(''); setGenerating(true)
    try {
      const fd = new FormData()
      fd.append('rawNotes', form.rawNotes)
      if (form.customerId) fd.append('customerId', form.customerId)
      if (form.visitDate) fd.append('visitDate', form.visitDate)
      photos.forEach((p) => fd.append('images', p))
      if (docFile) fd.append('document', docFile)
      const { data } = await visitReportsAPI.generate(fd)
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
        summary: data.summary || '',
        content: data.content || {},
        rawNotes: data.rawNotes || f.rawNotes,
      }))
    } catch (e) {
      setErr(e.response?.data?.error || t.errGenerateFailed)
    } finally { setGenerating(false) }
  }

  // Gather the report's own text (original raw notes + any structured sections) as
  // the source for the summary — the body itself is never modified. Section tags
  // stay in English regardless of the UI toggle (stable input for the AI call).
  const sourceText = () => {
    const c = form.content || {}
    const parts = [form.rawNotes]
    for (const s of SECTIONS_I18N) if (c[s.key]) parts.push(`${s.en}: ${c[s.key]}`)
    return parts.filter(Boolean).join('\n\n')
  }

  const summarize = async () => {
    const text = sourceText()
    if (!text.trim()) { setErr(t.errNoSummaryContent); return }
    setErr(''); setSummarizing(true)
    try {
      const { data } = await visitReportsAPI.summarize(text)
      const s = data.summary || ''
      set('summary', s)
      // View mode has no save button — persist the summary right away.
      if (!isNew && report?.id && s && !editing) {
        await visitReportsAPI.update(report.id, { summary: s })
      }
    } catch (e) {
      setErr(e.response?.data?.error || t.errSummarizeFailed)
    } finally { setSummarizing(false) }
  }

  const save = async (status) => {
    if (!form.title.trim()) { setErr(t.errTitleRequired); return }
    setErr(''); setSaving(true)
    try {
      const payload = { ...form, status: status || form.status, customerId: form.customerId || null }
      if (isNew) await visitReportsAPI.create(payload)
      else await visitReportsAPI.update(report.id, payload)
      onSaved()
    } catch (e) {
      setErr(e.response?.data?.error || t.errSaveFailed)
    } finally { setSaving(false) }
  }

  const readOnly = !editing

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onClose}>
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">
            {isNew ? t.modalTitleNew : (editing ? t.modalTitleEdit : t.modalTitleView)}
          </h2>
          <div className="flex items-center gap-2">
            {!isNew && report?.status && <Badge tone={report.status === 'FINAL' ? 'green' : 'amber'}>{report.status === 'FINAL' ? t.statusFinal : t.statusDraft}</Badge>}
            {!isNew && canEdit && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{t.edit}</Button>}
            <button onClick={onClose} aria-label={t.close} className="text-slate-400 hover:text-slate-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Read view: flat, article-style layout (no nested inputs) ── */}
          {!editing && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold leading-snug text-slate-900">{form.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>📅 {form.visitDate}</span>
                  {(report?.customer?.name || custQuery) && <span>🤝 {report?.customer?.name || custQuery}</span>}
                  {report?.author?.name && <span>✍️ {report.author.name}</span>}
                </div>
              </div>

              {/* Summary + on-demand AI summarize (view mode, per user preference) */}
              <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-brand-800">{t.summary}</span>
                  {canEdit && (
                    <Button size="sm" variant="secondary" onClick={summarize} disabled={summarizing}>
                      {summarizing ? t.summarizing : t.aiSummarize}
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{form.summary || '—'}</p>
              </div>

              {/* Report header meta as a flat definition grid */}
              {hasMeta && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2">
                  {META_FIELDS.filter((mf) => meta[mf.key]).map((mf) => (
                    <div key={mf.key} className="min-w-0">
                      <dt className="text-[11px] font-semibold text-slate-400">{mf.label}</dt>
                      <dd className="break-words text-sm text-slate-700">{meta[mf.key]}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* Sections as headed paragraphs */}
              {SECTIONS.filter((s) => form.content?.[s.key]).map((s) => (
                <section key={s.key}>
                  <h4 className="mb-1 border-l-2 border-brand-400 pl-2 text-xs font-bold text-slate-500">{s.label}</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{form.content[s.key]}</p>
                </section>
              ))}
              {!form.summary && SECTIONS.every((s) => !form.content?.[s.key]) && (
                <p className="py-6 text-center text-sm text-slate-400">{t.noContent}</p>
              )}
            </div>
          )}

          {editing && (<>
          {/* Meta */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              {t.visitDate}
              <Input type="date" value={form.visitDate} disabled={readOnly} onChange={(e) => set('visitDate', e.target.value)} className="mt-1 min-w-0 max-w-full appearance-none" />
            </label>
            <div className="text-xs font-semibold text-slate-600">
              {t.customer}
              <div className="relative mt-1">
                <Input
                  value={custQuery}
                  disabled={readOnly}
                  placeholder={t.searchCustomerPlaceholder}
                  className="truncate pr-9"
                  onChange={(e) => { setCustQuery(e.target.value); set('customerId', ''); setCustOpen(true) }}
                  onFocus={() => setCustOpen(true)}
                  onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                />
                {form.customerId && (
                  <button type="button" onClick={() => { set('customerId', ''); setCustQuery('') }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={t.clear}>✕</button>
                )}
                {custOpen && !readOnly && custQuery.trim() && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
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
                    {/* No exact match → offer to create the customer on the spot */}
                    {!exactMatch && (
                      <li className="border-t border-slate-100">
                        <button type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={createCustomer} disabled={creatingCust}
                          className="block w-full truncate px-3 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                          {creatingCust ? t.creating : t.createCustomer(custQuery.trim())}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Input + AI generate (create/edit only) */}
          {editing && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 text-xs font-bold text-slate-500">{isImportCreate ? t.aiSectionTitleImport : t.aiSectionTitle}</div>
              {!isImportCreate && (
                <Textarea rows={4} value={form.rawNotes} onChange={(e) => set('rawNotes', e.target.value)}
                  placeholder={t.notesPlaceholder} />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!isImportCreate && (
                  <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    {t.addPhoto}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files)])} />
                  </label>
                )}
                {/* Word upload: only in the "import" create path, or when editing an existing report. */}
                {!isManualCreate && (
                  <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    {t.addWordDoc}
                    <input type="file" accept=".docx" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setDocFile(f); e.target.value = '' }} />
                  </label>
                )}
                {photos.length > 0 && <span className="text-xs text-slate-500">{t.photoCount(photos.length)}</span>}
                {docFile && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                    📄 {docFile.name.length > 24 ? docFile.name.slice(0, 24) + '…' : docFile.name}
                    <button type="button" onClick={() => setDocFile(null)} className="text-brand-400 hover:text-rose-500">✕</button>
                  </span>
                )}
                <Button size="sm" onClick={generate} disabled={generating} className="ml-auto">
                  {generating ? t.aiGenerating : t.aiGenerate}
                </Button>
              </div>
            </div>
          )}

          {/* Title + summary */}
          <label className="block text-xs font-semibold text-slate-600">
            {t.title}
            <Input value={form.title} disabled={readOnly} onChange={(e) => set('title', e.target.value)} className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            {t.summary}
            <Textarea rows={3} value={form.summary || ''} disabled={readOnly} onChange={(e) => set('summary', e.target.value)} className="mt-1" />
          </label>

          {/* Report header (meta) — shown when editing, or when any field is filled */}
          {(editing || hasMeta) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 text-xs font-bold text-slate-500">{t.reportHeader}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {META_FIELDS.map((mf) => (
                  (editing || meta[mf.key]) && (
                    <label key={mf.key} className="block text-xs font-semibold text-slate-600">
                      {mf.label}
                      <Input value={meta[mf.key] || ''} disabled={readOnly}
                        onChange={(e) => setMeta(mf.key, e.target.value)} className="mt-1"
                        placeholder={readOnly ? '—' : ''} />
                    </label>
                  )
                ))}
              </div>
            </div>
          )}

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
          </>)}

          {/* Structured tables (AI-extracted, read-only) */}
          {tables.length > 0 && (
            <div className="space-y-3">
              {tables.map((t2, ti) => (
                <div key={ti}>
                  {t2.title && <div className="mb-1 text-xs font-bold text-slate-600">{t2.title}</div>}
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50">
                          {(t2.columns || []).map((col, ci) => (
                            <th key={ci} className="whitespace-nowrap border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(t2.rows || []).map((row, ri) => (
                          <tr key={ri} className="even:bg-slate-50/50">
                            {row.map((cell, ci) => (
                              <td key={ci} className="border-b border-slate-100 px-2.5 py-1.5 text-slate-700">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>

        {/* Footer */}
        {editing && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
            <Button variant="secondary" onClick={() => save('DRAFT')} disabled={saving}>{saving ? t.saving : t.saveDraft}</Button>
            <Button onClick={() => save('FINAL')} disabled={saving}>{saving ? t.saving : t.saveFinal}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
