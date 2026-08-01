// ── Minimal markdown rendering for assistant replies ─────────────────────────
// Handles: **bold**, [text](url) + bare URLs (break-all so long share links
// can't overflow the bubble), headings, lists, hr, and pipe tables (rendered
// as real tables inside a horizontal-scroll container).
//
// Lifted verbatim out of CommandSearch so the trip-planning chat renders
// replies identically. Deliberately not a markdown library: assistant replies
// are short and this stays a few dozen lines with no dependency.
export function bold(s, key) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}b${i}`}>{p.slice(2, -2)}</strong> : p)
}

export function inline(s) {
  const parts = String(s).split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) => {
    if (!p) return null
    const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (md) return <a key={i} href={md[2]} target="_blank" rel="noreferrer" className="break-all font-semibold text-brand-600 underline">{md[1]}</a>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline">{p}</a>
    return bold(p, i)
  })
}

const TABLE_SEP_RE = /^\|?[\s:|-]+\|?$/
const parseRow = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function Md({ text }) {
  const lines = String(text || '').split('\n')
  const out = []
  let list = []
  const flush = (k) => {
    if (list.length) { out.push(<ul key={`l${k}`} className="ml-4 list-disc space-y-0.5">{list}</ul>); list = [] }
  }
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    // Pipe table: header row + separator row (+ data rows) → real scrollable table.
    if (t.startsWith('|') && (lines[i + 1] || '').trim().startsWith('|') && TABLE_SEP_RE.test((lines[i + 1] || '').trim())) {
      flush(i)
      const header = parseRow(t)
      let j = i + 2
      const rows = []
      while (j < lines.length && lines[j].trim().startsWith('|')) { rows.push(parseRow(lines[j])); j++ }
      out.push(
        <div key={`t${i}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                {header.map((c, ci) => <th key={ci} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600">{bold(c, ci)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-slate-50/50">
                  {header.map((_, ci) => <td key={ci} className="whitespace-nowrap border-b border-slate-100 px-2 py-1.5 text-slate-700">{inline(r[ci] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j
      continue
    }
    if (/^[-*•] /.test(t)) { list.push(<li key={i}>{inline(t.slice(2))}</li>); i++; continue }
    flush(i)
    if (t) {
      if (/^-{3,}$/.test(t)) { out.push(<hr key={i} className="my-2 border-slate-100" />) }
      else {
        const h = t.match(/^#{1,4}\s+(.*)/)
        if (h) out.push(<p key={i} className="mt-1.5 font-bold text-slate-800">{inline(h[1])}</p>)
        else out.push(<p key={i}>{inline(t)}</p>)
      }
    }
    i++
  }
  flush('end')
  return <div className="min-w-0 space-y-1.5 break-words text-sm leading-relaxed text-slate-700">{out}</div>
}

export default Md
