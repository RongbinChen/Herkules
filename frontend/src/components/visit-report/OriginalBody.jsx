// Renders the retained Word text. React escapes every string, so the document
// cannot inject markup. Parsing (paragraphs, headings, lists, pipe tables,
// pandoc grid tables, and simple dash tables) lives in the shared module so
// the page and the Word export read the same structure.
//
// Leftover `[]` marks from the Word import are replaced with the matching
// photos (document order). A line of `[] []` stays a photo row.

import { useState } from 'react'
import { embedInlinePhotos } from '../../../../shared/inlineBodyPhotos.js'
import { parseOriginalBody } from '../../../../shared/originalBodyBlocks.js'
import { STRINGS } from '../../i18n/visitReports'
import { PhotoLightbox, PhotoRow } from './PhotoMedia'
import useReportPhotoSrcs from './useReportPhotoSrcs'

function renderCell(cell, photoProps) {
  if (cell && typeof cell === 'object') {
    if (cell.photos) return <PhotoRow photos={cell.photos} {...photoProps} />
    if (Array.isArray(cell.parts)) return <MixedText parts={cell.parts} {...photoProps} compact />
    if (cell.text) return cell.text
  }
  return cell
}

function MixedText({ parts, compact = false, ...photoProps }) {
  const nodes = []
  let index = 0
  while (index < (parts || []).length) {
    const part = parts[index]
    if (part.type === 'text') {
      const text = part.text || ''
      if (text) {
        if (compact) nodes.push(<span key={`t-${index}`} className="whitespace-pre-wrap break-words">{text}</span>)
        else nodes.push(<p key={`t-${index}`} className="whitespace-pre-wrap break-words">{text}</p>)
      }
      index += 1
      continue
    }
    const photos = []
    while (index < parts.length && (parts[index].type === 'photo' || (parts[index].type === 'text' && !String(parts[index].text || '').trim()))) {
      if (parts[index].type === 'photo') photos.push(parts[index].photo)
      index += 1
    }
    if (photos.length) {
      nodes.push(<PhotoRow key={`p-${photos[0].storedName}`} photos={photos} {...photoProps} />)
    }
  }
  if (!nodes.length) return null
  if (compact) return <div className="space-y-2">{nodes}</div>
  return <>{nodes}</>
}

function listItemContent(item, photoProps) {
  if (item && typeof item === 'object') {
    if (item.photos) return <PhotoRow photos={item.photos} {...photoProps} />
    if (Array.isArray(item.parts)) return <MixedText parts={item.parts} {...photoProps} compact />
    if (item.text) return item.text
  }
  return item
}

export default function OriginalBody({ markdown, photos, reportId = null, draft = false, lang = 'en' }) {
  const t = STRINGS[lang] || STRINGS.en
  const { blocks } = embedInlinePhotos(parseOriginalBody(markdown), photos)
  const { srcs } = useReportPhotoSrcs(photos, { reportId, draft })
  const [active, setActive] = useState(null)

  if (!blocks.length) return null

  const photoProps = {
    srcs,
    title: t.reportPhotos,
    viewLabel: t.viewPhoto,
    onOpen: setActive,
  }

  return (
    <div className="space-y-3 text-sm font-normal leading-relaxed text-slate-700" data-original-body>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          if (block.parts) {
            return (
              <div key={index} className="space-y-3">
                <MixedText parts={block.parts} {...photoProps} />
              </div>
            )
          }
          return <h3 key={index} className="break-words text-sm font-bold text-slate-800">{block.text}</h3>
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={index} className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="break-words pl-0.5">{listItemContent(item, photoProps)}</li>)}
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
                      const empty = cell == null || (typeof cell === 'string' && !cell.trim())
                      if (empty) return null
                      const label = typeof columns[cellIndex] === 'string' ? columns[cellIndex] : null
                      return (
                        <div key={cellIndex} className="break-words py-0.5">
                          {label ? <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p> : null}
                          <div className="whitespace-pre-wrap text-sm text-slate-700">{renderCell(cell, photoProps)}</div>
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
                        <th key={colIndex} className="break-words border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{typeof col === 'string' ? col : renderCell(col, photoProps)}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="even:bg-slate-50/50">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="break-words whitespace-pre-wrap align-top border-b border-slate-100 px-2.5 py-1.5 text-slate-700">{renderCell(cell, photoProps)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.type === 'photos') {
          return <PhotoRow key={index} photos={block.photos} {...photoProps} />
        }
        if (block.parts) {
          return <MixedText key={index} parts={block.parts} {...photoProps} />
        }
        return <p key={index} className="whitespace-pre-wrap break-words">{block.text}</p>
      })}
      <PhotoLightbox
        photo={active}
        src={active ? srcs[active.storedName] : undefined}
        title={t.reportPhotos}
        closeLabel={t.close}
        onClose={() => setActive(null)}
      />
    </div>
  )
}
