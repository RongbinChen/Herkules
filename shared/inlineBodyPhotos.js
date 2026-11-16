// Map leftover Word/pandoc image marks (`[]`, `[] []`) in a preserved
// visit-report body onto stored photos, in document order.
//
// Used by the page renderer and the Word export so a photo shown in the
// body is not also repeated in the end-of-report gallery. This is a
// display/export pass only: it never rewrites stored originalBody.

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

export function embedInlinePhotos(blocks, photos) {
  const queue = photosForInline(photos).slice()
  const next = (blocks || []).map((block) => transformBlock(block, queue)).filter(Boolean)
  return { blocks: next, leftoverPhotos: queue }
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
