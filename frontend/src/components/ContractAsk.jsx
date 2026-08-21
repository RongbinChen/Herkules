import { useState } from 'react'
import { contractsAPI } from '../api/api'
import { Button, Card, Textarea } from './ui'
import ContractCustomerPicker from './ContractCustomerPicker'
import { displayFilename } from '../constants/contract'

// "Ask AI" over one customer's contracts. Scoped to a single customer on
// purpose: the question is answered by a local model on the DGX reading the
// transcribed pages, so it needs a customer to bound which files are in scope.
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
        // The local model is unreachable. We show this rather than falling back
        // to a less reliable path.
        setError('The local model is offline (DGX not connected). Contract Q&A needs it online — please try again later.')
      } else if (e.code === 'ECONNABORTED') {
        setError('Timed out. Try again, or ask a more specific question.')
      } else {
        setError(e.response?.data?.error || 'Failed to get an answer')
      }
    } finally {
      setLoading(false)
    }
  }

  const reasonText = {
    'no-readable-pages': 'This customer’s contracts have not been read yet, so there is no text to search. Try again once OCR has finished.',
    'no-match': 'No pages in this customer’s contracts matched the question. Try rephrasing or using more specific terms.',
  }

  return (
    <Card className="mb-4 border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-800">Ask AI</span>
        <span className="text-xs text-slate-500">Answers about one customer’s contracts, from a local model.</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Customer</span>
        <div className="min-w-[16rem] flex-1">
          <ContractCustomerPicker
            token={token}
            value={customer}
            onChange={setCustomer}
            placeholder="Select or search a customer…"
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
          placeholder={customer ? `Ask about ${customer.name}’s contracts — e.g. What is the contract value? What is the warranty period?` : 'Select a customer first'}
          className="flex-1"
        />
        <Button size="sm" onClick={ask} disabled={!canAsk} className="shrink-0">
          {loading ? 'Asking…' : 'Ask'}
        </Button>
      </div>

      {loading && (
        <p className="mt-2 text-xs text-slate-500">Reading the matched pages with the local model…</p>
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
                  <p className="mb-1 text-[11px] font-semibold text-slate-400">Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.sources.map((s, i) => (
                      <span
                        key={i}
                        title={s.snippet}
                        className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                      >
                        {displayFilename(s.filename)} · p.{s.pageNo}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {reasonText[result.reason] || 'No answer is available right now.'}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
