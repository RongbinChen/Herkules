// Map leftover Word/pandoc image marks in a preserved visit-report body.
//
// `[]` and `[] []` are replaced with the stored photos, in document order,
// and those photos are left out of the end-of-report gallery.
//
// Pandoc's own image syntax (`![](media/image1.png){width="…" height="…"}`
// and close variants) is not a second copy of the photo. The picture stays
// in the gallery. At the mark, a following italic caption is kept once;
// otherwise the reader gets a short note that names that gallery caption.
//
// Display and Word export only. This never rewrites stored originalBody.

import { parseEmphasis, stripEmphasis } from './markdownEmphasis.js'
import { blocksToMarkdown, parseOriginalBody } from './originalBodyBlocks.js'

// The page needs a stored file name to fetch the image. Word export photos
// are often only `{ caption, markdownPath }`, so inline mapping accepts either.
export function photosForInline(photos) {
  if (!Array.isArray(photos)) return []
  return photos.filter((photo) => (
    photo
    && photo.kind !== 'document'
    && (photo.storedName || photo.markdownPath)
  ))
}

export function displayablePhotos(photos) {
  return photosForInline(photos).filter((photo) => photo.storedName)
}

export function isStandalonePlaceholder(text, index) {
  const s = String(text ?? '')
  if (s.slice(index, index + 2) !== '[]') return false
  if (index > 0 && s[index - 1] === '!') return false
  if (s[index + 2] === '(') return false
  return true
}

export function findPlaceholders(text) {
  const s = String(text ?? '')
  const hits = []
  const re = /\[\]/g
  let match
  while ((match = re.exec(s))) {
    if (isStandalonePlaceholder(s, match.index)) hits.push(match.index)
  }
  return hits
}

export function isPlaceholderOnlyText(text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  return findPlaceholders(s).length > 0 && splitTextWithPhotos(s, []).every((part) => (
    part.type !== 'text' || !String(part.text).trim()
  ))
}

export function splitTextWithPhotos(text, queue) {
  const s = String(text ?? '')
  const parts = []
  let last = 0
  const re = /\[\]/g
  let match
  while ((match = re.exec(s))) {
    if (!isStandalonePlaceholder(s, match.index)) continue
    if (match.index > last) parts.push({ type: 'text', text: s.slice(last, match.index) })
    if (Array.isArray(queue) && queue.length) {
      parts.push({ type: 'photo', photo: queue.shift() })
    }
    last = match.index + 2
  }
  if (last < s.length) parts.push({ type: 'text', text: s.slice(last) })
  return parts
}

function photosOnly(parts) {
  const photos = []
  for (const part of parts || []) {
    if (part.type === 'photo') photos.push(part.photo)
    else if (String(part.text || '').trim()) return null
  }
  return photos.length ? photos : null
}

function normalizeTextResult(text, queue) {
  const parts = splitTextWithPhotos(text, queue)
  if (!parts.length) return { empty: true }
  const only = photosOnly(parts)
  if (only) return { photos: only }
  if (parts.length === 1 && parts[0].type === 'text') {
    const next = parts[0].text
    if (!String(next).trim()) return { empty: true }
    return { text: next }
  }
  return { parts }
}

function transformCell(cell, queue) {
  if (cell && typeof cell === 'object' && Array.isArray(cell.parts)) {
    return normalizeTextResult(cell.parts.map((part) => (part.type === 'text' ? part.text : '[]')).join(''), queue)
  }
  const result = normalizeTextResult(cell, queue)
  if (result.empty) return ''
  if (result.text !== undefined) return result.text
  return result
}

function transformListItem(item, queue) {
  const source = item && typeof item === 'object' && Array.isArray(item.parts)
    ? item.parts.map((part) => (part.type === 'text' ? part.text : '[]')).join('')
    : item
  const result = normalizeTextResult(source, queue)
  if (result.empty) return ''
  if (result.text !== undefined) return result.text
  return result
}

function transformBlock(block, queue) {
  if (!block) return null

  if (block.type === 'paragraph' || block.type === 'heading') {
    const result = normalizeTextResult(block.text, queue)
    if (result.empty) return null
    if (result.photos) return { type: 'photos', photos: result.photos }
    if (result.text !== undefined) return { ...block, text: result.text }
    return { ...block, parts: result.parts }
  }

  if (block.type === 'list') {
    const items = (block.items || []).map((item) => transformListItem(item, queue)).filter((item) => {
      if (item === '' || item == null) return false
      if (typeof item === 'string') return Boolean(item.trim())
      return true
    })
    if (!items.length) return null
    return { ...block, items }
  }

  if (block.type === 'table') {
    return {
      ...block,
      header: Array.isArray(block.header)
        ? block.header.map((cell) => transformCell(cell, queue))
        : block.header,
      rows: (block.rows || []).map((row) => (Array.isArray(row) ? row.map((cell) => transformCell(cell, queue)) : row)),
    }
  }

  if (block.type === 'photos') return block
  return block
}

// Pandoc writes Word pictures as ![](media/imageN.ext){width="…" height="…"}.
// Quotes, attributes, and alt text are all optional. Other image syntax,
// including the gallery's own ![caption](photo-n.jpg){width=14cm}, is left
// alone because this runs before those marks are created.
const MEDIA_IMAGE = /!\[([^\]]*)\]\(\s*(?:\.\/)?media\/(image(\d+)\.(?:png|jpe?g|gif|webp|bmp|tiff?))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)(?:\{[^{}\n]*\})?/gi

function mediaImageMarks(text) {
  const source = String(text ?? '')
  const marks = []
  const re = new RegExp(MEDIA_IMAGE.source, 'gi')
  let match
  while ((match = re.exec(source))) {
    marks.push({
      raw: match[0],
      alt: match[1].replace(/\s+/g, ' ').trim(),
      file: match[2].toLowerCase(),
      number: Number(match[3]),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return marks
}

function stripMediaImages(text) {
  const source = String(text ?? '')
  const marks = mediaImageMarks(source)
  if (!marks.length) return source
  let out = ''
  let cursor = 0
  for (const mark of marks) {
    out += source.slice(cursor, mark.start)
    cursor = mark.end
  }
  return out + source.slice(cursor)
}

function cleanNoteCaption(value, file) {
  const text = String(value ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (file && lower === file.toLowerCase()) return ''
  if (/^image\d+\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/.test(lower)) return ''
  return text
}

function finishNote(text, lang) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  if (/[.!?。！？]$/.test(trimmed)) return trimmed
  return lang === 'zh' ? `${trimmed}。` : `${trimmed}.`
}

// The filename written by pandoc (image1.png) is the reliable link to a
// stored photo. The 1-based index is the fallback when the saved name is a
// generated id: image1 is the first report photo.
function photoForMark(mark, photos) {
  const named = photos.find((photo) => {
    const name = String(photo?.name || '').split(/[/\\]/).pop().toLowerCase()
    return name === mark.file
  })
  if (named) return named
  const index = mark.number - 1
  if (index >= 0 && index < photos.length) return photos[index]
  return null
}

function photoNote(mark, photos, lang) {
  const photo = photoForMark(mark, photos)
  const caption = cleanNoteCaption(photo?.caption, mark.file) || cleanNoteCaption(mark.alt, mark.file)
  const sentence = lang === 'zh'
    ? (caption ? finishNote(`见下方照片：${caption}`, lang) : '见下方照片。')
    : (caption ? finishNote(`See the photo below: ${caption}`, lang) : 'See the photo below.')
  // Italic on the page and in Word, without rewriting the stored body.
  if (/[*_]/.test(sentence)) return sentence
  return `*${sentence}*`
}

function replaceMarks(text, photos, lang) {
  const source = String(text ?? '')
  const marks = mediaImageMarks(source)
  if (!marks.length) return source
  let out = ''
  let cursor = 0
  for (const mark of marks) {
    out += source.slice(cursor, mark.start)
    out += photoNote(mark, photos, lang)
    cursor = mark.end
  }
  out += source.slice(cursor)
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim()
}

function bodyLanguage(blocks) {
  const chunks = []
  const pushText = (text) => {
    if (typeof text === 'string' && text.trim()) chunks.push(stripMediaImages(text))
  }
  const pushCell = (cell) => {
    if (typeof cell === 'string') pushText(cell)
    else if (cell && typeof cell === 'object') {
      pushText(cell.text)
      if (Array.isArray(cell.parts)) {
        for (const part of cell.parts) if (part?.type === 'text') pushText(part.text)
      }
    }
  }
  for (const block of blocks || []) {
    pushText(block?.text)
    if (Array.isArray(block?.parts)) {
      for (const part of block.parts) if (part?.type === 'text') pushText(part.text)
    }
    if (Array.isArray(block?.items)) {
      for (const item of block.items) {
        if (typeof item === 'string') pushText(item)
        else if (item && typeof item === 'object') pushText(item.text)
      }
    }
    if (Array.isArray(block?.header)) block.header.forEach(pushCell)
    if (Array.isArray(block?.rows)) {
      for (const row of block.rows) {
        if (Array.isArray(row)) row.forEach(pushCell)
      }
    }
  }
  const sample = chunks.join('\n')
  const cjk = (sample.match(/[一-鿿]/g) || []).length
  const latin = (sample.match(/[A-Za-z]/g) || []).length
  return cjk > latin ? 'zh' : 'en'
}

// A Word caption under the picture usually survives as its own italic
// paragraph (*caption* or _caption_). A trailing colon is a section label,
// not a caption, so the image note stays in front of it.
function isItalicCaptionText(text) {
  const raw = String(text ?? '').trim()
  if (!raw || mediaImageMarks(raw).length) return false
  const visible = stripEmphasis(raw).replace(/\s+/g, ' ').trim()
  if (!visible || visible.length > 240) return false
  if (/[:：]\s*$/.test(visible)) return false
  const segments = parseEmphasis(raw).filter((segment) => String(segment.text).trim())
  if (!segments.length) return false
  return segments.every((segment) => segment.italic || !/[\p{L}\p{N}]/u.test(segment.text))
}

function isItalicCaptionBlock(block) {
  if (!block || (block.type !== 'paragraph' && block.type !== 'heading')) return false
  if (block.parts || block.photos) return false
  return isItalicCaptionText(block.text)
}

function blockSourceText(block) {
  if (!block || block.parts || block.photos) return null
  if (block.type !== 'paragraph' && block.type !== 'heading') return null
  if (typeof block.text !== 'string') return null
  return block.text
}

// Image marks with only whitespace before them, and whatever prose follows.
function leadingImageRun(text) {
  const marks = mediaImageMarks(text)
  if (!marks.length) return null
  let cursor = 0
  const leading = []
  for (const mark of marks) {
    if (text.slice(cursor, mark.start).trim()) break
    leading.push(mark)
    cursor = mark.end
  }
  if (!leading.length) return null
  return { marks: leading, rest: text.slice(cursor).trim() }
}

function noteParagraph(mark, photos, lang) {
  return { type: 'paragraph', text: photoNote(mark, photos, lang), photoNote: true }
}

function rewriteNestedText(block, photos, lang) {
  if (!block) return block
  if (block.type === 'list') {
    return {
      ...block,
      items: (block.items || []).map((item) => {
        if (typeof item === 'string') return replaceMarks(item, photos, lang)
        if (item && typeof item === 'object' && typeof item.text === 'string' && !item.parts && !item.photos) {
          return { ...item, text: replaceMarks(item.text, photos, lang) }
        }
        if (item && Array.isArray(item.parts)) {
          return {
            ...item,
            parts: item.parts.map((part) => (
              part?.type === 'text' ? { ...part, text: replaceMarks(part.text, photos, lang) } : part
            )),
          }
        }
        return item
      }),
    }
  }
  if (block.type === 'table') {
    const rewriteCell = (cell) => {
      if (typeof cell === 'string') return replaceMarks(cell, photos, lang)
      if (cell && typeof cell === 'object' && typeof cell.text === 'string' && !cell.parts && !cell.photos) {
        return { ...cell, text: replaceMarks(cell.text, photos, lang) }
      }
      if (cell && Array.isArray(cell.parts)) {
        return {
          ...cell,
          parts: cell.parts.map((part) => (
            part?.type === 'text' ? { ...part, text: replaceMarks(part.text, photos, lang) } : part
          )),
        }
      }
      return cell
    }
    return {
      ...block,
      header: Array.isArray(block.header) ? block.header.map(rewriteCell) : block.header,
      rows: (block.rows || []).map((row) => (Array.isArray(row) ? row.map(rewriteCell) : row)),
    }
  }
  if (Array.isArray(block.parts)) {
    return {
      ...block,
      parts: block.parts.map((part) => (
        part?.type === 'text' ? { ...part, text: replaceMarks(part.text, photos, lang) } : part
      )),
    }
  }
  return block
}

// A short italic line is easy to mistake for a section title. When it is the
// caption under a picture, keep it as a caption paragraph.
function captionParagraph(block) {
  if (block?.type === 'heading' && block.section && isItalicCaptionText(block.text)) {
    return { type: 'paragraph', text: block.text }
  }
  return block
}

// Drop a pandoc image mark when the next italic line is already its caption.
// Otherwise leave a note that names the matching gallery photo. Photos are
// not removed from the gallery: the reader was shown the picture there.
function annotateMediaImages(blocks, photos) {
  const gallery = photosForInline(photos)
  const lang = bodyLanguage(blocks)
  const out = []
  const list = (blocks || []).slice()
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i]
    const text = blockSourceText(block)
    if (text == null) {
      out.push(rewriteNestedText(block, gallery, lang))
      continue
    }
    const marks = mediaImageMarks(text)
    if (!marks.length) {
      out.push(block)
      continue
    }
    const leading = leadingImageRun(text)
    if (leading && leading.marks.length === 1 && leading.rest && isItalicCaptionText(leading.rest)) {
      const kept = { ...block, text: leading.rest }
      out.push(block.type === 'heading' && block.section ? { type: 'paragraph', text: leading.rest } : kept)
      continue
    }
    const onlyImages = leading && leading.marks.length === marks.length && !leading.rest
    if (onlyImages && marks.length === 1 && isItalicCaptionBlock(list[i + 1])) {
      list[i + 1] = captionParagraph(list[i + 1])
      continue
    }
    if (onlyImages) {
      for (const mark of marks) out.push(noteParagraph(mark, gallery, lang))
      continue
    }
    const replaced = replaceMarks(text, gallery, lang)
    if (replaced) out.push({ ...block, text: replaced })
  }
  return out
}

export function embedInlinePhotos(blocks, photos) {
  const queue = photosForInline(photos).slice()
  const next = (blocks || []).map((block) => transformBlock(block, queue)).filter(Boolean)
  return { blocks: annotateMediaImages(next, photos), leftoverPhotos: queue }
}

export function leftoverPhotos(markdown, photos) {
  return embedInlinePhotos(parseOriginalBody(markdown), photos).leftoverPhotos
}

export function photoAltText(value) {
  return String(value ?? '').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Photo'
}

export function photoToMarkdown(photo) {
  if (!photo?.markdownPath) return ''
  return `![${photoAltText(photo.caption || photo.name || 'Photo')}](${photo.markdownPath}){width=14cm}`
}

function emitPhotoParagraphs(photo) {
  const markdown = photoToMarkdown(photo)
  return markdown ? [{ type: 'paragraph', text: markdown }] : []
}

function partsToBlocks(blockType, parts, headingLevel) {
  const out = []
  let textBuf = []
  const flushText = () => {
    const text = textBuf.join('').replace(/[ \t]+/g, ' ').trim()
    textBuf = []
    if (!text) return
    if (blockType === 'heading' && !out.length) {
      out.push({ type: 'heading', level: headingLevel, text })
    } else {
      out.push({ type: 'paragraph', text })
    }
  }
  for (const part of parts || []) {
    if (part.type === 'text') textBuf.push(part.text)
    else if (part.type === 'photo') {
      flushText()
      out.push(...emitPhotoParagraphs(part.photo))
    }
  }
  flushText()
  return out
}

function cellToText(cell) {
  if (cell == null) return ''
  if (typeof cell === 'string') return cell
  if (cell.photos) {
    return cell.photos.map(photoToMarkdown).filter(Boolean).join(' ')
  }
  if (Array.isArray(cell.parts)) {
    return cell.parts.map((part) => (
      part.type === 'photo' ? photoToMarkdown(part.photo) : String(part.text || '')
    )).join('').replace(/[ \t]+/g, ' ').trim()
  }
  if (cell.text) return cell.text
  return String(cell)
}

function materializePhotoBlocks(blocks) {
  const out = []
  for (const block of blocks || []) {
    if (block.type === 'photos') {
      for (const photo of block.photos || []) out.push(...emitPhotoParagraphs(photo))
      continue
    }
    if ((block.type === 'paragraph' || block.type === 'heading') && block.parts) {
      out.push(...partsToBlocks(block.type, block.parts, block.level))
      continue
    }
    if (block.type === 'list') {
      out.push({
        ...block,
        items: (block.items || []).map((item) => {
          if (typeof item === 'string') return item
          if (item?.photos) {
            return item.photos.map(photoToMarkdown).filter(Boolean).join(' ')
          }
          if (Array.isArray(item?.parts)) {
            return item.parts.map((part) => (
              part.type === 'photo' ? photoToMarkdown(part.photo) : String(part.text || '')
            )).join('').replace(/[ \t]+/g, ' ').trim()
          }
          return String(item ?? '')
        }),
      })
      continue
    }
    if (block.type === 'table') {
      out.push({
        ...block,
        header: Array.isArray(block.header) ? block.header.map(cellToText) : block.header,
        rows: (block.rows || []).map((row) => (Array.isArray(row) ? row.map(cellToText) : row)),
      })
      continue
    }
    out.push(block)
  }
  return out
}

// Parse a preserved body, splice photos at leftover `[]` marks, and
// serialise to Markdown. Leftover photos (no placeholder left) are
// returned for the end-of-report gallery.
export function renderOriginalBodyMarkdown(markdown, photos) {
  const { blocks, leftoverPhotos: leftover } = embedInlinePhotos(parseOriginalBody(markdown), photos)
  return {
    markdown: blocksToMarkdown(materializePhotoBlocks(blocks)),
    leftoverPhotos: leftover,
  }
}
