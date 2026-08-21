import { useEffect, useMemo, useState } from 'react'
import { contractsAPI } from '../api/api'
import { Input } from './ui'

// Customer picker for the Ask-AI panel, scoped to customers that actually have
// contracts on file for the unlocked team. Unlike the app-wide CustomerPicker
// (which searches all ~500 customers and can create), this fetches a short,
// pre-filtered list, so clicking it shows the whole list — it is a dropdown you
// can also type into, not a search box that starts empty.
//
// The two load-bearing details from CustomerPicker are kept: onMouseDown
// preventDefault on each option (blur fires before click), and the setTimeout on
// blur — without either, a click closes the list before it registers.
export default function ContractCustomerPicker({ token, value, onChange, placeholder = 'Select a customer…' }) {
  const [list, setList] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState(value?.name || '')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!token) return
    let alive = true
    contractsAPI.askCustomers(token)
      .then((r) => { if (alive) { setList(r.data.items || []); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [token])

  // Keep the text in step when the parent clears or replaces the selection.
  useEffect(() => { setQuery(value?.name || '') }, [value?.id, value?.name])

  const q = query.trim().toLowerCase()
  // Empty query shows everything (the list is short); typing filters it.
  const matches = useMemo(
    () => (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list),
    [q, list],
  )

  const pick = (c) => {
    onChange({ id: c.id, name: c.name })
    setQuery(c.name)
    setOpen(false)
  }

  const picked = value?.id ? list.find((c) => c.id === value.id) : null

  return (
    <div>
      <div className="relative">
        <Input
          value={query}
          placeholder={placeholder}
          className="truncate pr-9"
          onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {value?.id ? (
          <button
            type="button"
            onClick={() => { onChange(null); setQuery('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
            aria-label="Clear"
          >
            ✕
          </button>
        ) : (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">▾</span>
        )}

        {open && (
          <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {!loaded && <li className="px-3 py-2 text-sm text-slate-400">Loading…</li>}
            {loaded && list.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">No customers have contracts on file yet.</li>
            )}
            {loaded && list.length > 0 && matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">No match</li>
            )}
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-brand-50"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {c.readable < c.files ? `${c.readable}/${c.files}` : c.files} file{c.files === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* A customer can be picked before its files finish transcribing; say so
          rather than letting a question come back empty for no visible reason. */}
      {picked && picked.readable === 0 && (
        <p className="mt-1 text-[11px] text-amber-600">This customer’s contracts are still being read — answers aren’t available yet.</p>
      )}
    </div>
  )
}
