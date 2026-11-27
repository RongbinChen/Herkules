// Conservative typography for pandoc emphasis that leaks into preserved
// visit-report bodies. Display and title extraction only: this never rewrites
// stored originalBody. Word export keeps the source markers so pandoc can
// turn them back into real formatting.
//
// Recognised, well-formed constructs only:
//   **bold**, __bold__, *italic*, _italic_, ***bold italic***, ___bold italic___
//   [text]{.underline} and similar simple class spans such as {.mark}
//   ^superscript^ with no spaces inside (pandoc), such as 3^rd^
// Nested combinations such as **[Project briefing:]{.underline}** are kept.
// Photo placeholders (`[]`, `[] []`), links, headings, and raw HTML are left
// as literal text.

const MARKERS = ['***', '___', '**', '__', '*', '_']

function flagsFromClasses(classes) {
  const flags = emptyFlags()
  for (const name of classes) {
    if (name === 'underline') flags.underline = true
    else if (name === 'mark' || name === 'highlight') flags.mark = true
    else if (name === 'strikeout' || name === 'strike' || name === 'strikethrough' || name === 'del') flags.strike = true
    else if (name === 'strong' || name === 'bold') flags.bold = true
    else if (name === 'em' || name === 'italic' || name === 'emph') flags.italic = true
  }
  return flags
}

function emptyFlags() {
  return { bold: false, italic: false, underline: false, mark: false, strike: false, sup: false }
}

function withFlags(segment, flags) {
  return {
    text: segment.text,
    bold: !!(segment.bold || flags.bold),
    italic: !!(segment.italic || flags.italic),
    underline: !!(segment.underline || flags.underline),
    mark: !!(segment.mark || flags.mark),
    strike: !!(segment.strike || flags.strike),
    sup: !!(segment.sup || flags.sup),
  }
}

function applyFlags(segments, flags) {
  return (segments || []).map((segment) => withFlags(segment, flags))
}

function parseSpanAttrs(raw) {
  const text = String(raw || '').trim()
  if (!/^(?:\.[A-Za-z][\w-]*\s*)+$/.test(text)) return null
  return [...text.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1].toLowerCase())
}

function trySpan(source, index) {
  if (source[index] !== '[') return null
  if (source[index + 1] === ']') return null
  let cursor = index + 1
  while (cursor < source.length) {
    if (source[cursor] === '\n') return null
    if (source[cursor] === '\\' && cursor + 1 < source.length) {
      cursor += 2
      continue
    }
    if (source[cursor] === ']') break
    cursor += 1
  }
  if (cursor >= source.length || source[cursor] !== ']' || cursor === index + 1) return null
  if (source[cursor + 1] !== '{') return null
  const close = source.indexOf('}', cursor + 2)
  if (close < 0 || source.slice(cursor + 2, close).includes('\n')) return null
  const classes = parseSpanAttrs(source.slice(cursor + 2, close))
  if (!classes) return null
  const inner = source.slice(index + 1, cursor)
  return {
    segments: applyFlags(parseEmphasis(inner), flagsFromClasses(classes)),
    end: close + 1,
  }
}

function canOpen(source, index, marker) {
  const after = index + marker.length
  if (after >= source.length) return false
  if (/\s/.test(source[after])) return false
  if (marker[0] === '_' && index > 0 && /[A-Za-z0-9]/.test(source[index - 1])) return false
  return true
}

function canClose(source, closeIndex, start, marker) {
  if (closeIndex <= start) return false
  if (/\s/.test(source[closeIndex - 1])) return false
  const after = closeIndex + marker.length
  if (marker[0] === '_' && after < source.length && /[A-Za-z0-9]/.test(source[after])) return false
  if (after < source.length && source[after] === marker[0]) return false
  return true
}

function findCloser(source, start, marker) {
  let cursor = start
  while (cursor < source.length) {
    if (source[cursor] === '\\' && cursor + 1 < source.length) {
      cursor += 2
      continue
    }
    if (source.startsWith(marker, cursor) && canClose(source, cursor, start, marker)) {
      return cursor
    }
    cursor += 1
  }
  return -1
}

function delimiterRunLength(source, index, char) {
  let count = 0
  while (source[index + count] === char) count += 1
  return count
}

// Pandoc superscript: 3^rd^ → rd raised. Spaces stay literal so an unmatched
// caret in prose is not swallowed.
function trySuperscript(source, index) {
  if (source[index] !== '^') return null
  const next = source[index + 1]
  if (!next || next === '^' || /\s/.test(next)) return null
  let cursor = index + 1
  while (cursor < source.length) {
    const ch = source[cursor]
    if (ch === '\n' || /\s/.test(ch)) return null
    if (ch === '\\' && cursor + 1 < source.length) {
      cursor += 2
      continue
    }
    if (ch === '^') break
    cursor += 1
  }
  if (source[cursor] !== '^' || cursor === index + 1) return null
  const inner = source.slice(index + 1, cursor)
  if (!inner || inner.length > 40) return null
  return {
    segments: parseEmphasis(inner).map((segment) => ({ ...segment, sup: true })),
    end: cursor + 1,
  }
}

function tryEmphasis(source, index) {
  for (const marker of MARKERS) {
    // A run of ** must not be opened as a single *; otherwise
    // "** padded **" would be read as "* padded *".
    if (!source.startsWith(marker, index) || delimiterRunLength(source, index, marker[0]) !== marker.length) continue
    if (!canOpen(source, index, marker)) continue
    const start = index + marker.length
    const close = findCloser(source, start, marker)
    if (close < 0) continue
    const flags = emptyFlags()
    flags.bold = marker.length >= 2
    flags.italic = marker.length === 1 || marker.length === 3
    return {
      segments: applyFlags(parseEmphasis(source.slice(start, close)), flags),
      end: close + marker.length,
    }
  }
  return null
}

function literalSegment(text) {
  return { text, ...emptyFlags() }
}

export function parseEmphasis(text) {
  const source = String(text ?? '')
  if (!source) return []
  const segments = []
  let literal = ''
  const flush = () => {
    if (!literal) return
    segments.push(literalSegment(literal))
    literal = ''
  }
  let index = 0
  while (index < source.length) {
    if (source[index] === '\\' && index + 1 < source.length && '[]{}*_\\^'.includes(source[index + 1])) {
      literal += source[index + 1]
      index += 2
      continue
    }
    const span = trySpan(source, index)
    if (span) {
      flush()
      segments.push(...span.segments)
      index = span.end
      continue
    }
    const superscript = trySuperscript(source, index)
    if (superscript) {
      flush()
      segments.push(...superscript.segments)
      index = superscript.end
      continue
    }
    const emphasis = tryEmphasis(source, index)
    if (emphasis) {
      flush()
      segments.push(...emphasis.segments)
      index = emphasis.end
      continue
    }
    literal += source[index]
    index += 1
  }
  flush()
  return segments
}

export function stripEmphasis(text) {
  return parseEmphasis(text).map((segment) => segment.text).join('')
}

// Visible title on the list, detail header, and similar surfaces.
// Stored titles are left unchanged; only the shown text is cleaned.
export function displayTitle(title) {
  const raw = String(title ?? '').trim()
  if (!raw) return ''
  const cleaned = stripEmphasis(raw).replace(/\s+/g, ' ').trim()
  return cleaned || raw
}
