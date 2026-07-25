import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { visitReportsAPI, customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Button, Badge } from './ui'
import VisitReportModal from './VisitReportModal'
import { useVRLang, STRINGS, SECTIONS_I18N, META_FIELDS_I18N } from '../i18n/visitReports'

// Full-page article view for one visit report — the modal stays for create/edit,
// but reading happens here with room to breathe (esp. on desktop).
export default function VisitReportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [lang, setLang] = useVRLang()
  const t = STRINGS[lang]
  const SECTIONS = SECTIONS_I18N.map((s) => ({ key: s.key, label: s[lang] }))
  const META_FIELDS = META_FIELDS_I18N.map((m) => ({ key: m.key, label: m[lang] }))

  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState([])
  const [editOpen, setEditOpen] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await visitReportsAPI.get(id)
      setReport(data)
    } catch {
      setReport(null)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id])
  useEffect(() => { customersAPI.getAll().then((r) => setCustomers(r.data)).catch(() => {}) }, [])

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB') : '—')

  const summarize = async () => {
    if (!report) return
    const c = report.content || {}
    const parts = [report.rawNotes]
    for (const s of SECTIONS_I18N) if (c[s.key]) parts.push(`${s.en}: ${c[s.key]}`)
    const text = parts.filter(Boolean).join('\n\n')
    if (!text.trim()) return
    setSummarizing(true)
    try {
      const { data } = await visitReportsAPI.summarize(text)
      if (data.summary) {
        await visitReportsAPI.update(report.id, { summary: data.summary })
        setReport((r) => ({ ...r, summary: data.summary }))
      }
    } catch { /* surface nothing fatal */ } finally { setSummarizing(false) }
  }

  const downloadWord = async () => {
    setDownloading(true)
    try {
      const res = await visitReportsAPI.exportDocx(report.id)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(report.title || 'visit-report').replace(/[^\w.\- ]+/g, '_').slice(0, 80)}.docx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch {
      window.alert(t.exportFailed)
    } finally { setDownloading(false) }
  }

  if (loading) return <p className="py-16 text-center text-sm text-slate-400">{t.loading}</p>
  if (!report) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-500">{t.notFound}</p>
        <button onClick={() => navigate('/visit-reports')} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          {t.backToList}
        </button>
      </div>
    )
  }

  const content = report.content || {}
  const meta = content.meta || {}
  const hasMeta = META_FIELDS.some((mf) => meta[mf.key])
  const tables = Array.isArray(content.tables) ? content.tables : []
  const targets = Array.isArray(content.targets) ? content.targets.filter((tg) => tg?.title) : []
  const canEdit = report.canEdit || report.author?.id === user?.id || user?.isAdmin

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Toolbar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => navigate('/visit-reports')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            {t.backToList}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold shadow-sm">
              {[{ k: 'en', l: 'EN' }, { k: 'zh', l: '中文' }].map((o) => (
                <button key={o.k} onClick={() => setLang(o.k)}
                  className={`px-3 py-1.5 transition ${lang === o.k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={downloadWord} disabled={downloading}>
              {downloading ? '…' : t.exportWord}
            </Button>
            {canEdit && <Button size="sm" onClick={() => setEditOpen(true)}>{t.edit}</Button>}
          </div>
        </div>

        {/* Article */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-1 flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold leading-snug text-slate-900 sm:text-2xl">{report.title}</h1>
            <Badge tone={report.status === 'FINAL' ? 'green' : 'amber'}>{report.status === 'FINAL' ? t.statusFinal : t.statusDraft}</Badge>
          </div>
          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 pb-4 text-xs text-slate-500">
            <span>📅 {fmtDate(report.visitDate)}</span>
            {report.customer && (
              <button onClick={() => navigate(`/customers/${report.customer.id}`)} className="font-semibold text-brand-600 hover:underline">
                🤝 {report.customer.name}
              </button>
            )}
            {report.author?.name && <span>✍️ {report.author.name}</span>}
          </div>

          {/* Summary */}
          <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/60 p-4 sm:p-5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-800">{t.summary}</span>
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={summarize} disabled={summarizing}>
                  {summarizing ? t.summarizing : t.aiSummarize}
                </Button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{report.summary || '—'}</p>
          </div>

          {/* Report header meta */}
          {hasMeta && (
            <dl className="mb-6 grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2 sm:p-5">
              {META_FIELDS.filter((mf) => meta[mf.key]).map((mf) => (
                <div key={mf.key} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{mf.label}</dt>
                  <dd className="break-words text-sm text-slate-700">{meta[mf.key]}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Sections */}
          <div className="space-y-6">
            {SECTIONS.filter((s) => content[s.key]).map((s) => (
              <section key={s.key}>
                <h2 className="mb-1.5 border-l-[3px] border-brand-500 pl-2.5 text-sm font-bold text-slate-700">{s.label}</h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{content[s.key]}</p>
              </section>
            ))}
          </div>

          {/* Targets */}
          {targets.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 border-l-[3px] border-rose-400 pl-2.5 text-sm font-bold text-slate-700">⏰ {t.targetsTitle}</h2>
              <ul className="space-y-1.5">
                {targets.map((tg, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${tg.date ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
                      {tg.date || t.targetNoDate}
                    </span>
                    <span>{tg.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Tables */}
          {tables.length > 0 && (
            <div className="mt-6 space-y-4">
              {tables.map((tb, ti) => (
                <div key={ti}>
                  {tb.title && <h2 className="mb-1.5 border-l-[3px] border-brand-500 pl-2.5 text-sm font-bold text-slate-700">{tb.title}</h2>}
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50">
                          {(tb.columns || []).map((col, ci) => (
                            <th key={ci} className="whitespace-nowrap border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(tb.rows || []).map((row, ri) => (
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
        </article>
      </div>

      {editOpen && (
        <VisitReportModal
          report={report}
          startEditing
          customers={customers}
          currentUserId={user?.id}
          isAdmin={user?.isAdmin}
          lang={lang}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load() }}
        />
      )}
    </div>
  )
}
