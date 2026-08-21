// A tiny, dependency-free Markdown renderer for the model's answers — just the
// subset it emits: **bold**, `- ` / `* ` bullet lists, and paragraphs. Rendered
// as React children (escaped by default — no dangerouslySetInnerHTML, no XSS).
// Anything fancier than this falls through as plain text, which is fine.

// Split one line into text + <strong> segments on **bold** (and __bold__).
function inline(text, keyBase) {
  const nodes = []
  const re = /(\*\*|__)(.+?)\1/g
  let last = 0
  let m
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(<strong key={`${keyBase}-b${k++}`} className="font-semibold text-slate-900">{m[2]}</strong>)
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function Markdown({ children, className = '' }) {
  const lines = String(children || '').split('\n')
  const out = []
  let items = null

  const flushList = () => {
    if (items) {
      out.push(<ul key={`ul${out.length}`} className="my-1.5 list-disc space-y-1 pl-5 marker:text-slate-400">{items}</ul>)
      items = null
    }
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      items = items || []
      items.push(<li key={idx}>{inline(bullet[1], idx)}</li>)
      return
    }
    flushList()
    if (!line) return // blank line → spacing comes from element margins
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    out.push(
      <p key={idx} className={heading ? 'mb-1 mt-2 font-bold text-slate-900' : 'my-1'}>
        {inline(heading ? heading[1] : line, idx)}
      </p>,
    )
  })
  flushList()

  return <div className={`text-sm leading-relaxed text-slate-800 ${className}`}>{out}</div>
}
