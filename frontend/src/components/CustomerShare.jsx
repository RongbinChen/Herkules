import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { customersAPI } from '../api/api'
import CustomerMap from './CustomerMap'
import { statusMeta, tierMeta } from '../constants/customer'

// Public, no-login view of a shared customer selection (created from the
// customer list). Shows the customers on a map + a read-only list. Contact
// phone / email / notes are already stripped by the backend.
export default function CustomerShare() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    customersAPI
      .getShared(token)
      .then((res) => {
        if (!cancelled) setData(res.data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err?.response?.status === 404
            ? 'This share link is invalid or has expired.'
            : 'Failed to load shared customers.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) return <div className="p-10 text-center text-slate-400">Loading…</div>
  if (error) return <div className="p-10 text-center text-slate-500">{error}</div>

  const customers = data?.customers || []

  return (
    <div className="mx-auto max-w-[1200px] p-5">
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Shared customers
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">
          {data?.title || 'Recommended customers'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {customers.length} customer(s) · view-only · phone / email hidden
        </p>
      </div>

      <CustomerMap customers={customers} />

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Tags</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  {c.address && <p className="mt-0.5 text-xs text-slate-400">{c.address}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600">{statusMeta(c.status).label}</td>
                <td className="px-4 py-3 text-slate-600">{tierMeta(c.tier).short}</td>
                <td className="px-4 py-3 text-slate-600">{c.contactName || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(c.tags || []).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
