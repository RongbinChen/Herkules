// Renders the retained Word text. React escapes every string, so the document
// cannot inject markup. Parsing (paragraphs, headings, lists, pipe tables,
// pandoc grid tables, and simple dash tables) lives in the shared module so
// the page and the Word export read the same structure.

import { parseOriginalBody } from '../../../../shared/originalBodyBlocks.js'

function renderCell(text) {
  // Hard paragraph breaks inside a reconstructed grid cell are preserved by
  // the CSS white-space rule on the cell.
  return text
}

export default function OriginalBody({ markdown }) {
  const blocks = parseOriginalBody(markdown)
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
          const columns = block.header || []
          return (
            <div key={index} className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-slate-200">
              <div className="space-y-2 p-2 sm:hidden">
                {block.rows.map((row, rowIndex) => (
                  <div key={rowIndex} className="rounded-lg border border-slate-100 bg-white p-2.5">
                    {row.map((cell, cellIndex) => {
                      if (!String(cell || '').trim()) return null
                      const label = columns[cellIndex]
                      return (
                        <div key={cellIndex} className="break-words py-0.5">
                          {label ? <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p> : null}
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{renderCell(cell)}</p>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
              <table className="hidden w-full border-collapse text-xs sm:table sm:text-sm">
                {columns.length > 0 && (
                  <thead>
                    <tr className="bg-slate-50">
                      {columns.map((col, colIndex) => (
                        <th key={colIndex} className="break-words border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{col}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="even:bg-slate-50/50">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="break-words whitespace-pre-wrap align-top border-b border-slate-100 px-2.5 py-1.5 text-slate-700">{renderCell(cell)}</td>
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
