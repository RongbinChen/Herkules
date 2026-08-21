import { useState } from 'react'
import { contractsAPI } from '../api/api'
import { Button, Card, Textarea } from './ui'
import CustomerPicker from './CustomerPicker'

// "Ask AI" over one customer's contracts. Scoped to a single customer on
// purpose (see the backend note): the question is answered by a local vision
// model on the DGX reading the original contract pages, so it needs a customer
// to bound which files are in scope.
//
// Deliberately honest about its states: when the files are not read yet, or the
// model is offline, it says so rather than inventing an answer — a confidently
// wrong contract figure is worse than "I can't answer that right now".
export default function ContractAsk({ token, initialCustomer = null }) {
  const [customer, setCustomer] = useState(initialCustomer)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // { answer, sources, reason }
  const [error, setError] = useState('')

  const canAsk = customer?.id && question.trim().length >= 2 && !loading

  async function ask() {
    if (!canAsk) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const { data } = await contractsAPI.ask(customer.id, question.trim(), token)
      setResult(data)
    } catch (e) {
      if (e.response?.status === 503 && e.response.data?.offline) {
        // The local model is unreachable. We show this, and crucially do not
        // retry against the transcribed text — that is the path that misreads a
        // spec table, which is the whole reason the model reads the image.
        setError('本地模型离线（DGX 未连接）。合同问答需要本地模型在线，稍后再试。')
      } else if (e.code === 'ECONNABORTED') {
        setError('等待超时。原页较多时读取会慢，稍后再试或把问题问得更具体。')
      } else {
        setError(e.response?.data?.error || '提问失败')
      }
    } finally {
      setLoading(false)
    }
  }

  async function openSource(s) {
    try {
      const res = await contractsAPI.download(s.fileId, token)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = s.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('打开原文件失败')
    }
  }

  const reasonText = {
    'no-readable-pages': '这个客户名下的合同还没识别完，暂时没有可检索的文字。识别完成后再来问。',
    'no-match': '在该客户的合同里没找到和问题相关的页。换个说法、或用更具体的词再试一次。',
  }

  return (
    <Card className="mb-4 border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-800">问 AI</span>
        <span className="text-xs text-slate-500">针对某个客户名下的合同问答，答案由本地模型读原页给出</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">客户</span>
        <div className="min-w-[16rem] flex-1">
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            allowCreate={false}
            placeholder="选择要提问的客户…"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask() }}
          rows={2}
          maxLength={500}
          placeholder={customer ? `就「${customer.name}」的合同提问，例如：质保期是多久？合同金额是多少？` : '先选一个客户'}
          className="flex-1"
        />
        <Button size="sm" onClick={ask} disabled={!canAsk} className="shrink-0">
          {loading ? '读原页中…' : '提问'}
        </Button>
      </div>

      {loading && (
        <p className="mt-2 text-xs text-slate-500">正在把命中的原页交给本地模型阅读，通常十几到几十秒…</p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      {result && (
        <div className="mt-3">
          {result.answer ? (
            <>
              <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800">
                {result.answer}
              </div>
              {result.sources?.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] font-semibold text-slate-400">依据（点开原文件核对）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.sources.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => openSource(s)}
                        title={s.snippet}
                        className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand-100 hover:text-brand-700"
                      >
                        {s.filename} · 第 {s.pageNo} 页
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {reasonText[result.reason] || '暂时无法回答。'}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
