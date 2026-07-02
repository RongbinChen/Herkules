import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  uploadBidOpening, listBidOpenings, deleteBidOpening,
  fetchBidResults, getBidResults, getEmailStatus,
  listSavedSearches, createSavedSearch, deleteSavedSearch, updateSavedSearch,
} from '../api/chinabidding'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { key: 'opening', label: '开标记录 Opening' },
  { key: 'track', label: '评标/中标追踪 Results' },
  { key: 'watch', label: '订阅提醒 Subscriptions' },
]

const STAGE_META = {
  change: { label: 'Tender Changes', cls: 'bg-orange-500' },
  evaluation: { label: 'Evaluation Results', cls: 'bg-violet-500' },
  award: { label: 'Tender Awards', cls: 'bg-emerald-600' },
  tender: { label: 'New Tenders', cls: 'bg-blue-500' },
}

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('zh-CN') : '—'
}

// ── 开标记录 ──────────────────────────────────────────────────────────────────
function OpeningTab() {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const [records, setRecords] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)

  async function load() {
    try { setRecords(await listBidOpenings()) } catch (e) { console.error(e) }
  }
  useEffect(() => { load() }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const rec = await uploadBidOpening(file)
      setRecords((prev) => [rec, ...prev])
      setExpanded(rec.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(rec) {
    if (!window.confirm(`删除开标记录「${rec.projectName || rec.fileName}」？`)) return
    try { await deleteBidOpening(rec.id); load() } catch (err) { window.alert(err.message) }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-sky-300 bg-sky-50/50 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">上传开标记录 (Excel)</p>
          <p className="mt-0.5 text-xs text-slate-500">上传 .xlsx 开标记录，系统用 AI 自动识别招标编号、项目、开标日期与投标人报价并入库。</p>
        </div>
        <label className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${uploading ? 'bg-slate-300' : 'bg-sky-600 hover:bg-sky-700'}`}>
          {uploading ? '识别中…' : '选择 Excel 上传'}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading} onChange={handleFile} />
        </label>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200">{error}</p>}

      {records.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">还没有开标记录，上传第一份 Excel 吧。</p>
      ) : (
        <ul className="space-y-3">
          {records.map((r) => (
            <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{r.projectName || '(未识别项目名)'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    编号 <span className="font-mono">{r.biddingNo || '—'}</span> · 开标 {fmtDate(r.openDate)}
                    {r.purchaser ? ` · ${r.purchaser}` : ''} · 文件 {r.fileName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="rounded-md px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-50">
                    {expanded === r.id ? '收起' : `投标人 (${(r.bidders || []).length})`}
                  </button>
                  {(r.uploadedById === user?.id || user?.isAdmin) && (
                    <button onClick={() => handleDelete(r)} className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">删除</button>
                  )}
                </div>
              </div>
              {r.summary && <p className="mt-2 text-sm text-slate-600">{r.summary}</p>}
              {expanded === r.id && (r.bidders || []).length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                        <th className="px-3 py-2">#</th><th className="px-3 py-2">投标人</th><th className="px-3 py-2">报价</th><th className="px-3 py-2">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.bidders.map((b, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{b.name}</td>
                          <td className="px-3 py-2 text-slate-700">{b.price || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{b.note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 评标/中标追踪 ──────────────────────────────────────────────────────────────
function TrackTab() {
  const [biddingNo, setBiddingNo] = useState('')
  const [result, setResult] = useState(null)
  const [phase, setPhase] = useState('') // '' | 'local' | 'live'
  const [error, setError] = useState('')

  async function queryLocal() {
    if (!biddingNo.trim()) return
    setPhase('local'); setError('')
    try { setResult(await getBidResults(biddingNo.trim())) } catch (err) { setError(err.message) }
    setPhase('')
  }
  async function fetchLive() {
    if (!biddingNo.trim()) return
    setPhase('live'); setError('')
    try { setResult(await fetchBidResults(biddingNo.trim())) } catch (err) { setError(err.message) }
    setPhase('')
  }

  const groups = result ? ['award', 'evaluation', 'change', 'tender'].filter((k) => result[k]?.length) : []

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          value={biddingNo}
          onChange={(e) => setBiddingNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && queryLocal()}
          placeholder="输入招标编号，如 0712-254112DG050"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white"
        />
        <button onClick={queryLocal} disabled={!!phase || !biddingNo.trim()} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {phase === 'local' ? '查询中…' : '查本地库'}
        </button>
        <button onClick={fetchLive} disabled={!!phase || !biddingNo.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {phase === 'live' ? '抓取中…(约1-2分钟)' : '⟳ 从 chinabidding 抓取'}
        </button>
        <p className="w-full text-xs text-slate-400">「查本地库」即时返回已入库公告；「抓取」按编号搜索 chinabidding 的评标结果/中标公告并入库（较慢）。</p>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200">{error}</p>}

      {result && (
        result.total === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">未找到该编号的公告。可尝试「从 chinabidding 抓取」。</p>
        ) : (
          <div className="space-y-5">
            {groups.map((key) => (
              <section key={key}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold text-white ${STAGE_META[key].cls}`}>{STAGE_META[key].label}</span>
                  <span className="text-slate-400">{result[key].length} 条</span>
                </h3>
                <ul className="space-y-2">
                  {result[key].map((p) => (
                    <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 hover:text-blue-600 hover:underline">
                        {p.projectName}
                      </a>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                        <span>发布 {fmtDate(p.publishDate)}</span>
                        {p.winner && <span>中标方：<b className="text-slate-700">{p.winner}</b>{p.competitor ? `（${p.competitor.name}）` : ''}</span>}
                        {p.winningPrice && <span>中标价：{p.winningPrice}</span>}
                        {p.purchaser && <span>采购方：{p.purchaser}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ── 订阅提醒 ──────────────────────────────────────────────────────────────────
function WatchTab() {
  const [subs, setSubs] = useState([])
  const [emailConfigured, setEmailConfigured] = useState(null)
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [emailNotify, setEmailNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try { setSubs(await listSavedSearches()) } catch (e) { console.error(e) }
  }
  useEffect(() => {
    load()
    getEmailStatus().then((s) => setEmailConfigured(s.emailConfigured)).catch(() => setEmailConfigured(false))
  }, [])

  async function handleCreate() {
    if (!keyword.trim()) return setError('请填写招标编号或关键字')
    setSaving(true); setError('')
    try {
      await createSavedSearch({ name: name.trim() || keyword.trim(), keyword: keyword.trim(), autoMonitor: true, emailNotify })
      setName(''); setKeyword('')
      load()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function toggle(sub, field) {
    try {
      await updateSavedSearch(sub.id, { [field]: !sub[field] })
      load()
    } catch (err) { window.alert(err.message) }
  }

  async function handleDelete(sub) {
    if (!window.confirm(`删除订阅「${sub.name}」？`)) return
    try { await deleteSavedSearch(sub.id); load() } catch (err) { window.alert(err.message) }
  }

  return (
    <div>
      {emailConfigured === false && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
          ⚠️ 邮件发送尚未配置（需在服务器 .env 填写 SMTP_HOST/SMTP_USER/SMTP_PASS）。配置前仅有站内铃铛通知，邮件不会发送。
        </p>
      )}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2 font-semibold text-slate-800">新增订阅</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="招标编号或关键字，如 0712-254112DG050 / roll grinder"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="订阅名称(可选)"
            className="w-44 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:bg-white" />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={emailNotify} onChange={(e) => setEmailNotify(e.target.checked)} className="h-4 w-4 accent-sky-600" />
            邮件提醒
          </label>
          <button onClick={handleCreate} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {saving ? '保存中…' : '+ 订阅'}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">每日 08:00 自动按订阅抓取 chinabidding（含评标结果/中标公告）；发现新公告即发站内通知{'、'}勾选邮件则同时发邮件。</p>
        {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      </div>

      {subs.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">还没有订阅。</p>
      ) : (
        <ul className="space-y-2">
          {subs.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{s.name}</p>
                <p className="text-xs text-slate-400">关键字/编号：<span className="font-mono">{s.keyword}</span>{s.lastRunAt ? ` · 上次运行 ${new Date(s.lastRunAt).toLocaleString('zh-CN')}` : ' · 尚未运行'}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.autoMonitor} onChange={() => toggle(s, 'autoMonitor')} className="h-4 w-4 accent-sky-600" />
                每日监控
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.emailNotify} onChange={() => toggle(s, 'emailNotify')} className="h-4 w-4 accent-sky-600" />
                邮件提醒
              </label>
              <button onClick={() => handleDelete(s)} className="rounded-md px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">删除</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 页面骨架 ──────────────────────────────────────────────────────────────────
export default function BidOpenPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('opening')

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-slate-400">Bid Open</p>
              <p className="text-[1rem] font-medium text-slate-700">开标记录 · 评标/中标结果追踪 · 订阅提醒</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/chinabidding')} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                ← Project List
              </button>
              <button onClick={() => navigate('/')} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                Modules
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t.key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </header>

        {tab === 'opening' && <OpeningTab />}
        {tab === 'track' && <TrackTab />}
        {tab === 'watch' && <WatchTab />}
      </div>
    </div>
  )
}
