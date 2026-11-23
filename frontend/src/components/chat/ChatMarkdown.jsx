import { Link } from 'react-router-dom'
import { ASK_AI_FROM, linkStateForSearch, withFromSearch } from '../../utils/appBack'
// ── Minimal markdown rendering for assistant replies ─────────────────────────
// Handles: **bold**, [text](url) + bare URLs (break-all so long share links
// can't overflow the bubble), headings, bullet lists, numbered lists (with
// indented sub-lines such as Date / Overview / Report link), hr, and pipe
// tables (rendered as real tables inside a horizontal-scroll container).
//
// Lifted verbatim out of CommandSearch so the trip-planning chat renders
// replies identically. Deliberately not a markdown library: assistant replies
// are short and this stays a few dozen lines with no dependency.
export function bold(s, key) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}b${i}`}>{p.slice(2, -2)}</strong> : p)
}

const APP_PATH = /^\/(customers|visit-reports|chinabidding|hotprojects|followups|trips|contracts|calendar|search|trip\/share|bidopen\/share)(\/|\?|#|$)/

export function inline(s, opts = {}) {
  const from = opts.from
  const threadId = opts.threadId
  const parts = String(s).split(/(\[[^\]]+\]\((?:https?:\/\/[^)]+|\/[^)]+)\)|https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) => {
    if (!p) return null
    const mdApp = p.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/)
    if (mdApp && APP_PATH.test(mdApp[2])) {
      const href = from === ASK_AI_FROM ? withFromSearch(mdApp[2], { threadId }) : mdApp[2]
      const state = from === ASK_AI_FROM ? linkStateForSearch(threadId) : undefined
      return <Link key={i} to={href} state={state} className="break-all font-semibold text-brand-600 underline">{mdApp[1]}</Link>
    }
    const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (md) return <a key={i} href={md[2]} target="_blank" rel="noreferrer" className="break-all font-semibold text-brand-600 underline">{md[1]}</a>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline">{p}</a>
    return bold(p, i)
  })
}

const TABLE_SEP_RE = /^\|?[\s:|-]+\|?$/
const parseRow = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const OL_RE = /^(\d+)\.\s+(.*)$/

export function Md({ text, from, threadId }) {
  const lines = String(text || '').split('\n')
  const out = []
  let list = []
  let listKind = 'ul'
  const flush = (k) => {
    if (list.length) {
      const Tag = listKind === 'ol' ? 'ol' : 'ul'
      const cls = listKind === 'ol' ? 'ml-5 list-decimal space-y-2' : 'ml-4 list-disc space-y-0.5'
      out.push(<Tag key={`l${k}`} className={cls}>{list}</Tag>)
      list = []
      listKind = 'ul'
    }
  }
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const t = raw.trim()
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
                  {header.map((_, ci) => <td key={ci} className="whitespace-nowrap border-b border-slate-100 px-2 py-1.5 text-slate-700">{inline(r[ci] ?? '', { from, threadId })}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j
      continue
    }
    const ol = OL_RE.exec(t)
    if (ol) {
      if (listKind !== 'ol') flush(i)
      listKind = 'ol'
      const parts = [ol[2]]
      i += 1
      while (i < lines.length) {
        const nxtRaw = lines[i]
        const nxt = nxtRaw.trim()
        if (!nxt) {
          const peek = (lines[i + 1] || '')
          if (/^(?: {2,}|\t)/.test(peek) || OL_RE.test(peek.trim())) { i += 1; continue }
          break
        }
        if (OL_RE.test(nxt) && !/^\s/.test(nxtRaw)) break
        if (/^(?: {2,}|\t)/.test(nxtRaw)) { parts.push(nxt); i += 1; continue }
        break
      }
      list.push(
        <li key={`o${i}`} className="pl-0.5">
          <div className="font-semibold leading-snug text-slate-800">{inline(parts[0], { from, threadId })}</div>
          {parts.slice(1).map((line, li) => (
            <div key={li} className="mt-0.5 text-sm font-normal leading-relaxed text-slate-600">{inline(line, { from, threadId })}</div>
          ))}
        </li>
      )
      continue
    }
    if (/^[-*•] /.test(t)) {
      if (listKind !== 'ul') flush(i)
      listKind = 'ul'
      list.push(<li key={i}>{inline(t.slice(2), { from, threadId })}</li>)
      i += 1
      continue
    }
    flush(i)
    if (t) {
      if (/^-{3,}$/.test(t)) { out.push(<hr key={i} className="my-2 border-slate-100" />) }
      else {
        const h = t.match(/^#{1,4}\s+(.*)/)
        if (h) out.push(<p key={i} className="mt-1.5 font-bold text-slate-800">{inline(h[1], { from, threadId })}</p>)
        else out.push(<p key={i}>{inline(t, { from, threadId })}</p>)
      }
    }
    i += 1
  }
  flush('end')
  return <div className="min-w-0 space-y-1.5 break-words text-sm leading-relaxed text-slate-700">{out}</div>
}

export default Md
