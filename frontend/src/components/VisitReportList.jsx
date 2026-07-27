import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { visitReportsAPI, customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Badge } from './ui'
import VisitReportModal from './VisitReportModal'
import { useVRLang, STRINGS } from '../i18n/visitReports'

export default function VisitReportList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [lang, setLang] = useVRLang()
  const t = STRINGS[lang]
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB') : '—')
  const [reports, setReports] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [mine, setMine] = useState(false)
  const [modal, setModal] = useState(null) // { report, createMode? } for view/edit/new
  const [chooserOpen, setChooserOpen] = useState(false)
  // Deep link from a customer page: /visit-reports?new=1&customerId=..&customerName=..
  // opens the create chooser with that customer pre-linked.
  const [searchParams] = useSearchParams()
  const [initialCustomer, setInitialCustomer] = useState(null)
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const cid = parseInt(searchParams.get('customerId'), 10)
    const cname = searchParams.get('customerName') || ''
    if (cid) setInitialCustomer({ id: cid, name: cname })
    setChooserOpen(true)
    navigate('/visit-reports', { replace: true }) // don't reopen on refresh
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Display mode: card grid vs. detailed table. Persisted.
  const [view, setView] = useState(() => localStorage.getItem('vrView') || 'cards')
  const pickView = (v) => { setView(v); localStorage.setItem('vrView', v) }

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await visitReportsAPI.list(mine ? { mine: 'true' } : {})
      setReports(data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [mine])
  useEffect(() => { customersAPI.getAll().then((r) => setCustomers(r.data)).catch(() => {}) }, [])

  // Reading happens on the dedicated detail page (roomier, esp. on desktop).
  const openReport = (id) => navigate(`/visit-reports/${id}`)

  const onSaved = () => { setModal(null); load() }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-600">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              Field Intelligence
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-800 sm:text-2xl">{t.pageTitle}</h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">{t.pageSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* UI language toggle */}
            <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold shadow-sm">
              {[{ k: 'en', l: 'EN' }, { k: 'zh', l: '中文' }].map((o) => (
                <button key={o.k} onClick={() => setLang(o.k)}
                  className={`px-3 py-1.5 transition ${lang === o.k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/')}>Modules</Button>
            <Button size="sm" onClick={() => setChooserOpen(true)}>{t.newReport}</Button>
          </div>
        </div>

        {/* Filter + view toggle */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {[{ k: false, l: t.filterAll }, { k: true, l: t.filterMine }].map((f) => (
            <button key={String(f.k)} onClick={() => setMine(f.k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${mine === f.k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f.l}
            </button>
          ))}
          <span className="ml-2 text-xs text-slate-400">{t.countReports(reports.length)}</span>
          <div className="ml-auto flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold shadow-sm">
            {[{ k: 'cards', l: `▦ ${t.viewCards}` }, { k: 'list', l: `☰ ${t.viewList}` }].map((o) => (
              <button key={o.k} onClick={() => pickView(o.k)}
                className={`px-3 py-1.5 transition ${view === o.k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">{t.loading}</div>
        ) : reports.length === 0 ? (
          <Card className="py-16 text-center text-sm text-slate-400">
            {t.emptyState} <button onClick={() => setChooserOpen(true)} className="font-semibold text-brand-600 hover:underline">{t.createOne}</button>
          </Card>
        ) : view === 'cards' ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reports.map((r) => (
              <Card key={r.id} as="button" hover onClick={() => openReport(r.id)}
                className="p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-bold text-slate-800">{r.title}</h3>
                  <Badge tone={r.status === 'FINAL' ? 'green' : 'amber'}>{r.status === 'FINAL' ? t.statusFinal : t.statusDraft}</Badge>
                </div>
                {r.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{r.summary}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span>📅 {fmtDate(r.visitDate)}</span>
                  {r.customer && <span>🏢 {r.customer.name}</span>}
                  <span>✍️ {r.author?.name || t.authorFallback}</span>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          /* Detailed list: table with full columns; horizontal scroll on small screens */
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="whitespace-nowrap px-4 py-2.5">{t.colDate}</th>
                  <th className="px-4 py-2.5">{t.colTitle}</th>
                  <th className="whitespace-nowrap px-4 py-2.5">{t.colCustomer}</th>
                  <th className="whitespace-nowrap px-4 py-2.5">{t.colAuthor}</th>
                  <th className="whitespace-nowrap px-4 py-2.5">{t.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} onClick={() => openReport(r.id)}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-brand-50/40">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDate(r.visitDate)}</td>
                    <td className="min-w-[240px] px-4 py-3">
                      <div className="font-semibold text-slate-800">{r.title}</div>
                      {r.summary && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{r.summary}</div>}
                    </td>
                    <td className="max-w-[220px] truncate whitespace-nowrap px-4 py-3 text-xs text-slate-600">{r.customer?.name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{r.author?.name || t.authorFallback}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={r.status === 'FINAL' ? 'green' : 'amber'}>{r.status === 'FINAL' ? t.statusFinal : t.statusDraft}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New-report entry chooser: manual entry vs. importing an existing Word doc */}
      {chooserOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setChooserOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold text-slate-800">{t.chooserTitle}</h3>
            <p className="mb-4 text-xs text-slate-500">{t.chooserSubtitle}</p>
            <div className="space-y-2">
              <button
                onClick={() => { setChooserOpen(false); setModal({ report: null, createMode: 'manual' }) }}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <span className="text-xl">✍️</span>
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{t.manualEntry}</span>
                  <span className="block text-xs text-slate-400">{t.manualEntryHint}</span>
                </span>
              </button>
              <button
                onClick={() => { setChooserOpen(false); setModal({ report: null, createMode: 'import' }) }}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <span className="text-xl">📄</span>
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{t.importDoc}</span>
                  <span className="block text-xs text-slate-400">{t.importDocHint}</span>
                </span>
              </button>
            </div>
            <button onClick={() => setChooserOpen(false)}
              className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {modal && (
        <VisitReportModal
          report={modal.report}
          createMode={modal.createMode}
          initialCustomer={modal.report ? null : initialCustomer}
          customers={customers}
          currentUserId={user?.id}
          isAdmin={user?.isAdmin}
          lang={lang}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
