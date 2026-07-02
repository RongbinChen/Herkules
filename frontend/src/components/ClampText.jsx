import { useState } from 'react'

// Truncates long text with a "more…" toggle so table cells stay one line;
// clicking expands to the full content ("less" collapses back).
export default function ClampText({ text, max = 36, className = '' }) {
  const [open, setOpen] = useState(false)
  if (!text) return <span className={className}>—</span>
  const s = String(text)
  if (s.length <= max) return <span className={className}>{s}</span>
  return (
    <span className={className}>
      {open ? `${s} ` : `${s.slice(0, max).trimEnd()}… `}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="whitespace-nowrap font-semibold text-sky-600 hover:underline"
      >
        {open ? 'less' : 'more…'}
      </button>
    </span>
  )
}
