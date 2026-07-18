import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { visitReportsAPI, customersAPI } from '../api/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Badge } from './ui'
import VisitReportModal from './VisitReportModal'

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('zh-CN') : '—')

export default function VisitReportList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reports, setReports] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [mine, setMine] = useState(false)
  const [modal, setModal] = useState(null) // { report } for view/edit, { report: null } for new

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await visitReportsAPI.list(mine ? { mine: 'true' } : {})
      setReports(data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [mine])
  useEffect(() => { customersAPI.getAll().then((r) => setCustomers(r.data)).catch(() => {}) }, [])

  const openReport = async (id) => {
    try {
      const { data } = await visitReportsAPI.get(id)
      setModal({ report: data })
    } catch { /* ignore */ }
  }

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
            <h1 className="mt-1 text-xl font-bold text-slate-800 sm:text-2xl">拜访报告 · Visit Reports</h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">现场随手记 + 照片，AI 整理成结构化拜访报告，关联客户与项目。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/')}>Modules</Button>
            <Button size="sm" onClick={() => setModal({ report: null })}>＋ 新建报告</Button>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-4 flex items-center gap-1.5">
          {[{ k: false, l: '全部' }, { k: true, l: '我的' }].map((t) => (
            <button key={String(t.k)} onClick={() => setMine(t.k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${mine === t.k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t.l}
            </button>
          ))}
          <span className="ml-2 text-xs text-slate-400">共 {reports.length} 篇</span>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : reports.length === 0 ? (
          <Card className="py-16 text-center text-sm text-slate-400">
            还没有拜访报告。<button onClick={() => setModal({ report: null })} className="font-semibold text-brand-600 hover:underline">新建一篇</button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reports.map((r) => (
              <Card key={r.id} as="button" hover onClick={() => openReport(r.id)}
                className="p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-bold text-slate-800">{r.title}</h3>
                  <Badge tone={r.status === 'FINAL' ? 'green' : 'amber'}>{r.status === 'FINAL' ? '定稿' : '草稿'}</Badge>
                </div>
                {r.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{r.summary}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span>📅 {fmtDate(r.visitDate)}</span>
                  {r.customer && <span>🏢 {r.customer.name}</span>}
                  <span>✍️ {r.author?.name || '—'}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <VisitReportModal
          report={modal.report}
          customers={customers}
          currentUserId={user?.id}
          isAdmin={user?.isAdmin}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
