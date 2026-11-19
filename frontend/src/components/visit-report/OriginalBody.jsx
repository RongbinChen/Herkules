// Renders the retained Word text. React escapes every string, so the document
// cannot inject markup. Parsing (paragraphs, headings, lists, pipe tables,
// pandoc grid tables, and simple dash tables) lives in the shared module so
// the page and the Word export read the same structure.
//
// Leftover `[]` marks from the Word import are replaced with the matching
// photos (document order). A line of `[] []` stays a photo row.
// Letterhead / participants tables become the report meta card and attendee
// chips already used on structured reports.

import { useState } from 'react'
import { embedInlinePhotos } from '../../../../shared/inlineBodyPhotos.js'
import { parseEmphasis } from '../../../../shared/markdownEmphasis.js'
import { parseOriginalBody } from '../../../../shared/originalBodyBlocks.js'
import { STRINGS, SECTIONS_I18N, META_FIELDS_I18N } from '../../i18n/visitReports'
import { PhotoLightbox, PhotoRow } from './PhotoMedia'
import AttendeeGroups from './AttendeeGroups'
import useReportPhotoSrcs from './useReportPhotoSrcs'


function styledSegment(segment, key) {
  let node = segment.text
  if (segment.strike) node = <s className="line-through">{node}</s>
  if (segment.mark) node = <mark className="rounded-sm bg-amber-100 px-0.5 text-inherit">{node}</mark>
  if (segment.underline) node = <u className="underline">{node}</u>
  if (segment.italic) node = <em>{node}</em>
  if (segment.bold) node = <strong className="font-semibold text-slate-800">{node}</strong>
  return <span key={key}>{node}</span>
}

function EmphasisText({ text }) {
  const segments = parseEmphasis(text)
  if (!segments.length) return null
  if (segments.length === 1 && !segments[0].bold && !segments[0].italic && !segments[0].underline && !segments[0].mark && !segments[0].strike) {
    return segments[0].text
  }
  return segments.map((segment, index) => styledSegment(segment, index))
}

function renderCell(cell, photoProps) {
  if (cell && typeof cell === 'object') {
    if (cell.photos) return <PhotoRow photos={cell.photos} {...photoProps} />
    if (Array.isArray(cell.parts)) return <MixedText parts={cell.parts} {...photoProps} compact />
    if (cell.text) return <EmphasisText text={cell.text} />
  }
  if (typeof cell === 'string') return <EmphasisText text={cell} />
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
        if (compact) nodes.push(<span key={`t-${index}`} className="whitespace-pre-wrap break-words"><EmphasisText text={text} /></span>)
        else nodes.push(<p key={`t-${index}`} className="whitespace-pre-wrap break-words"><EmphasisText text={text} /></p>)
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
    if (item.text) return <EmphasisText text={item.text} />
  }
  if (typeof item === 'string') return <EmphasisText text={item} />
  return item
}

function fieldLabel(field, lang) {
  const found = META_FIELDS_I18N.find((item) => item.key === field.key)
  if (found) return found[lang] || found.en
  return field.label
}

function MetaCard({ fields, lang }) {
  const list = (fields || []).filter((field) => field?.value)
  if (!list.length) return null
  const wide = new Set(['address', 'reason'])
  return (
    <dl data-report-meta className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2 sm:p-5">
      {list.map((field) => (
        <div key={field.key || field.label} className={`min-w-0 ${wide.has(field.key) ? 'sm:col-span-2' : ''}`}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{fieldLabel(field, lang)}</dt>
          <dd className="break-words text-sm text-slate-700"><EmphasisText text={field.value} /></dd>
        </div>
      ))}
    </dl>
  )
}

export default function OriginalBody({ markdown, photos, reportId = null, draft = false, lang = 'en' }) {
  const t = STRINGS[lang] || STRINGS.en
  const { blocks } = embedInlinePhotos(parseOriginalBody(markdown), photos)
  const { srcs } = useReportPhotoSrcs(photos, { reportId, draft })
  const [active, setActive] = useState(null)
  const attendeesLabel = (SECTIONS_I18N.find((item) => item.key === 'attendees') || {})[lang] || 'Attendees'

  if (!blocks.length) return null

  const photoProps = {
    srcs,
    title: t.reportPhotos,
    viewLabel: t.viewPhoto,
    onOpen: setActive,
  }

  return (
    <div className="space-y-4 text-sm font-normal leading-relaxed text-slate-700" data-original-body>
      {blocks.map((block, index) => {
        if (block.type === 'meta') {
          return <MetaCard key={index} fields={block.fields} lang={lang} />
        }
        if (block.type === 'attendees') {
          return (
            <AttendeeGroups
              key={index}
              className="space-y-2"
              groups={block.groups}
              heading={(
                <h3 className="mb-2 border-l-[3px] border-brand-500 pl-2.5 text-sm font-bold text-slate-700">
                  {attendeesLabel}
                </h3>
              )}
            />
          )
        }
        if (block.type === 'heading') {
          if (block.parts) {
            return (
              <div key={index} className="space-y-3">
                <MixedText parts={block.parts} {...photoProps} />
              </div>
            )
          }
          const headingClass = block.section
            ? 'break-words text-sm font-semibold text-slate-800'
            : 'break-words text-sm font-bold text-slate-800'
          return <h3 key={index} className={headingClass}><EmphasisText text={block.text} /></h3>
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          const start = block.ordered && block.start && block.start !== 1 ? block.start : undefined
          return (
            <Tag
              key={index}
              start={start}
              className={`list-outside space-y-2 pl-6 marker:text-slate-500 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="break-words pl-1 leading-relaxed">{listItemContent(item, photoProps)}</li>
              ))}
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
                          {label ? <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400"><EmphasisText text={label} /></p> : null}
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
                        <th key={colIndex} className="break-words border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-600">{renderCell(col, photoProps)}</th>
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
        if (block.aside) {
          return <p key={index} className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-500"><EmphasisText text={block.text} /></p>
        }
        return <p key={index} className="whitespace-pre-wrap break-words"><EmphasisText text={block.text} /></p>
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
