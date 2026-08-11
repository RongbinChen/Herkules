import { useEffect, useState } from 'react'
import { customersAPI } from '../api/api'
import { Input } from './ui'

// Single-select customer search with inline creation, lifted from the pattern in
// VisitReportModal. There are ~500 customers, so a plain <select> is unusable;
// the list is fetched once and filtered in the browser, same as everywhere else
// in this app. A server-side search endpoint would be another contract to keep
// in step for no gain at this size.
//
// Two details below are load-bearing and easy to lose in a rewrite:
//   * onMouseDown preventDefault on every option — blur fires before click, so
//     without it the dropdown closes out from under the pointer and the click
//     lands on nothing.
//   * the setTimeout on blur — the same race, from the other side.
export default function CustomerPicker({
  value,              // { id, name } | null
  onChange,           // (customer | null) => void
  allowCreate = true,
  disabled = false,
  placeholder = 'Search customers…',
  autoFocus = false,
}) {
  const [list, setList] = useState([])
  const [query, setQuery] = useState(value?.name || '')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    customersAPI.getAll().then((r) => setList(r.data)).catch(() => setList([]))
  }, [])

  // Keep the text in step when the parent clears or replaces the selection.
  useEffect(() => { setQuery(value?.name || '') }, [value?.id, value?.name])

  const q = query.trim().toLowerCase()
  const matches = q ? list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30) : []
  const exact = q && list.some((c) => c.name.toLowerCase() === q)

  const pick = (c) => {
    onChange(c)
    setQuery(c.name)
    setOpen(false)
  }

  // Name only. The backend's customer schema requires nothing else, and asking
  // for an address here would turn "file this contract" into "onboard a
  // customer" — the rest can be filled in from the Customers module later.
  const create = async () => {
    const name = query.trim()
    if (!name || creating) return
    setErr('')
    setCreating(true)
    try {
      const { data } = await customersAPI.create({ name })
      setList((prev) => [data, ...prev])
      pick(data)
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to create the customer')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <div className="relative">
        <Input
          value={query}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="truncate pr-9"
          onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {value?.id && (
          <button
            type="button"
            onClick={() => { onChange(null); setQuery('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
            aria-label="Clear"
          >
            ✕
          </button>
        )}
        {open && !disabled && q && (
          <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-brand-50"
                >
                  {c.name}
                </button>
              </li>
            ))}
            {allowCreate && !exact && (
              <li className="border-t border-slate-100">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={create}
                  disabled={creating}
                  className="block w-full truncate px-3 py-2 text-left text-sm font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : `+ Create “${query.trim()}”`}
                </button>
              </li>
            )}
            {matches.length === 0 && !allowCreate && (
              <li className="px-3 py-2 text-sm text-slate-400">No match</li>
            )}
          </ul>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  )
}
