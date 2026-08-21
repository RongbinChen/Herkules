import { useEffect, useRef, useState } from 'react'
import { contractsAPI } from '../api/api'
import { Button, Card, Textarea } from './ui'
import ContractCustomerPicker from './ContractCustomerPicker'
import { displayFilename } from '../constants/contract'

// "Ask AI" over one customer's contracts — a short conversation, so a follow-up
// ("那第二台呢", "and the warranty?") builds on what was already asked rather than
// starting cold. Scoped to one customer: the model reads that customer's
// transcribed pages on the DGX, so the customer bounds what's in scope.
//
// Honest about its states: when the files are not read yet, or the model is
// offline, it says so rather than inventing an answer — a confidently wrong
// contract figure is worse than "I can't answer that right now".
export default function ContractAsk({ token, initialCustomer = null }) {
  const [customer, setCustomer] = useState(initialCustomer)
  const [turns, setTurns] = useState([]) // [{ question, answer, sources, reason }]
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const threadEndRef = useRef(null)

  // A conversation is about one customer's files; switching customer starts a
  // fresh thread rather than carrying a mismatched history into new documents.
  useEffect(() => { setTurns([]); setError('') }, [customer?.id])

  // Keep the newest turn in view as the thread grows.
  useEffect(() => { threadEndRef.current?.scrollIntoView({ block: 'nearest' }) }, [turns, loading])

  const canAsk = customer?.id && question.trim().length >= 2 && !loading

  async function ask() {
    if (!canAsk) return
    const q = question.trim()
    setLoading(true)
    setError('')
    try {
      // Only answered turns are worth sending as context; unanswered ones
      // (offline / no-match) carry nothing the model can use.
      const history = turns
        .filter((t) => t.answer)
        .map((t) => ({ question: t.question, answer: t.answer }))
      const { data } = await contractsAPI.ask(customer.id, q, token, history)
      setTurns((prev) => [...prev, { question: q, answer: data.answer, sources: data.sources || [], reason: data.reason }])
      setQuestion('')
    } catch (e) {
      if (e.response?.status === 503 && e.response.data?.offline) {
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

  const hasThread = turns.length > 0

  return (
    <Card className="mb-4 border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-800">Ask AI</span>
        <span className="text-xs text-slate-500">Ask follow-up questions about one customer’s contracts, answered by a local model.</span>
        {hasThread && (
          <button
            onClick={() => { setTurns([]); setError('') }}
            className="ml-auto text-xs font-semibold text-slate-400 transition hover:text-slate-600"
          >
            New conversation
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
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

      {/* Conversation thread */}
      {hasThread && (
        <div className="mb-3 space-y-3">
          {turns.map((t, i) => (
            <div key={i}>
              <div className="mb-1 flex justify-end">
                <span className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-3 py-1.5 text-sm text-white">
                  {t.question}
                </span>
              </div>
              {t.answer ? (
                <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-3">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{t.answer}</div>
                  {t.sources?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.sources.map((s, j) => (
                        <span
                          key={j}
                          title={s.snippet}
                          className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500"
                        >
                          {displayFilename(s.filename)} · p.{s.pageNo}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl rounded-bl-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {reasonText[t.reason] || 'No answer is available right now.'}
                </p>
              )}
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask() }}
          rows={2}
          maxLength={500}
          placeholder={
            !customer ? 'Select a customer first'
              : hasThread ? 'Ask a follow-up…'
                : `Ask about ${customer.name}’s contracts — e.g. What is the contract value? What is the warranty period?`
          }
          className="flex-1"
        />
        <Button size="sm" onClick={ask} disabled={!canAsk} className="shrink-0">
          {loading ? 'Asking…' : hasThread ? 'Send' : 'Ask'}
        </Button>
      </div>

      {loading && (
        <p className="mt-2 text-xs text-slate-500">Reading the matched pages with the local model…</p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}
    </Card>
  )
}
