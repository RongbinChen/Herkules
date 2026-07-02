import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ClampText from './ClampText'

const API_BASE = '/api/chinabidding'

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-US') : '—'
}

// Public, login-free bid-opening record view reached via /bidopen/share/:token.
export default function BidOpeningShare() {
  const { token } = useParams()
  const [rec, setRec] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | notfound | error

  useEffect(() => {
    let ignore = false
    fetch(`${API_BASE}/bidopen/share/${token}`)
      .then(async (res) => {
        if (ignore) return
        if (res.status === 404) return setState('notfound')
        if (!res.ok) return setState('error')
        setRec(await res.json())
        setState('ready')
      })
      .catch(() => { if (!ignore) setState('error') })
    return () => { ignore = true }
  }, [token])

  if (state === 'loading') return <p className="py-20 text-center text-slate-400">Loading…</p>
  if (state === 'notfound') return <p className="py-20 text-center text-slate-400">Record not found or the link has expired.</p>
  if (state === 'error') return <p className="py-20 text-center text-slate-400">Failed to load. Please try again later.</p>

  const bidders = rec.bidders || []

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1000px] px-4 py-6 sm:py-8">
        <header className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Bid Opening Record</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-800 sm:text-3xl">{rec.projectName || '(project name not recognized)'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            No. <span className="font-mono">{rec.biddingNo || '—'}</span> · Opened {fmtDate(rec.openDate)}
            {rec.purchaser ? ` · ${rec.purchaser}` : ''}
          </p>
        </header>

        {/* Mobile: stacked bidder cards */}
        <div className="space-y-3 sm:hidden">
          {bidders.map((b, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold text-slate-800">
                  <span className="mr-1.5 text-slate-400">{i + 1}.</span>{b.name}
                </p>
                {b.country && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{b.country}</span>
                )}
              </div>
              <p className="mt-1.5 text-lg font-bold text-sky-700">
                {[b.priceTerm, b.currency, b.price].filter(Boolean).join(' ') || '—'}
              </p>
              <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                {b.deliveryTime && <p>🚚 <ClampText text={b.deliveryTime} max={40} /></p>}
                {b.destination && <p>📍 {b.destination}</p>}
                {b.note && <p className="text-slate-400"><ClampText text={b.note} max={40} /></p>}
              </div>
            </div>
          ))}
          {bidders.length === 0 && (
            <p className="rounded-2xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-400">No bidders recorded.</p>
          )}
        </div>

        {/* Desktop: full table */}
        <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white sm:block">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Bidder</th>
                <th className="px-3 py-2.5">Country</th>
                <th className="px-3 py-2.5">Price term</th>
                <th className="px-3 py-2.5">Price</th>
                <th className="px-3 py-2.5">Delivery time</th>
                <th className="px-3 py-2.5">Destination</th>
                <th className="px-3 py-2.5">Remark</th>
              </tr>
            </thead>
            <tbody>
              {bidders.map((b, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{b.name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{b.country || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{[b.priceTerm, b.currency].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{b.price || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-normal text-slate-600"><ClampText text={b.deliveryTime} max={28} /></td>
                  <td className="px-3 py-2.5 text-slate-600">{b.destination || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-normal text-slate-500"><ClampText text={b.note} max={24} /></td>
                </tr>
              ))}
              {bidders.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No bidders recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">Generated by Herkules CRM · Bid Tracking</p>
      </div>
    </div>
  )
}
