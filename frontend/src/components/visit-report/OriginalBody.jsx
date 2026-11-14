// Renders the retained Word text. React escapes every string, so the document
// cannot inject markup. Only paragraphs, headings, lists, and pipe tables are
// recognised; anything else stays a paragraph.

function isTableStart(lines, index) {
  const row = lines[index] || ''
  const rule = lines[index + 1] || ''
  return row.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(rule)
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].trim()) { i += 1; continue }
    if (isTableStart(lines, i)) {
      const columns = cells(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i]))
        i += 1
      }
      blocks.push({ type: 'table', columns, rows })
      continue
    }
    const heading = lines[i].match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
      const ordered = /^\s*\d+[.)]\s+/.test(lines[i])
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !isTableStart(lines, i) && !/^(#{1,4})\s+/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') })
  }
  return blocks
}

export default function OriginalBody({ markdown }) {
  const blocks = parseBlocks(markdown)
  if (!blocks.length) return null
  return (
    <div className="space-y-3 text-sm font-normal leading-relaxed text-slate-700" data-original-body>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={index} className="break-words text-sm font-bold text-slate-800">{block.text}</h3>
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={index} className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="break-words pl-0.5">{item}</li>)}
            </Tag>
          )
        }
        if (block.type === 'table') {
          return (
            <div key={index} className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    {block.columns.map((col, colIndex) => (
                      <th key={colIndex} className="border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="even:bg-slate-50/50">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="break-words border-b border-slate-100 px-2.5 py-1.5 text-slate-700">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <p key={index} className="whitespace-pre-wrap break-words">{block.text}</p>
      })}
    </div>
  )
}
