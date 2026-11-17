// Shared Markdown-ish block parser for preserved visit-report bodies.
// Pure JavaScript (no React, no DOM, no Node-only APIs) so the frontend
// renderer and the backend Word export read the retained text identically.
//
// Recognised blocks:
//   - headings            (#..##..)
//   - bullet/number lists
//   - GFM pipe tables     (| col | + | --- |)
//   - pandoc grid tables  (+---+ borders, | cell | rows)
//   - simple dash tables  (rows of dashes with ragged columns)
//   - paragraphs          (soft-wrapped lines joined with a single space)
//
// Grid cells are reconstructed from the dash runs on the border line, not by
// splitting the padded text on "|". Wrapped cell fragments are rejoined with
// the deterministic rules below; no dictionary-based "name repair".

const blank = (line) => !String(line ?? '').trim()

const ruleLine = (line) => {
  const t = String(line ?? '').trim()
  return /^[-=]{3,}$/.test(t) || /^\+[-=:+]+$/.test(t)
}

export function isRuleLine(line) {
  return ruleLine(line)
}

export function pipeTableStart(lines, index) {
  const row = lines[index] || ''
  const rule = lines[index + 1] || ''
  return row.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(rule)
}

export function pipeCells(line) {
  return String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

// Returns the column widths from a grid border line such as
// "+---------+----------+", or null when the line is not a grid border.
export function gridBorderWidths(line) {
  const t = String(line || '').trim()
  if (t.length < 3 || !t.startsWith('+') || !t.endsWith('+')) return null
  const body = t.slice(1, -1)
  if (!/^[-=]+(\+[-=]+)*$/.test(body)) return null
  const widths = body.split('+').map((part) => part.length)
  if (!widths.length || widths.some((w) => w < 1)) return null
  return widths
}

function sameWidths(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((width, index) => width === b[index])
}

function isGridRowLine(line) {
  const t = String(line || '').trim()
  return t.startsWith('|') && t.endsWith('|') && t.length >= 2
}

// A grid row is "| text |" where each cell is padded to its column width.
// The first character of every cell is format padding, so trim both ends.
function gridRowParts(line, widths) {
  const t = String(line || '').trim()
  if (!isGridRowLine(t)) return null
  let sum = 0
  const parts = []
  for (let col = 0; col < widths.length; col += 1) {
    const start = col + 1 + sum
    const raw = t.slice(start, start + widths[col])
    parts.push({
      text: raw.trim(),
      // "filled" means the source cell ran to the right edge without a
      // trailing space, i.e. the text really filled the padded width.
      filled: raw.length > 0 && !/\s$/.test(raw),
    })
    sum += widths[col]
  }
  return parts
}

// Function words that start a new wrapped word, not a mid-word continuation.
// Compared against the original .docx tables: lowercase mid-word joins are
// reliable for 1-2 letter fragments (M + ornhill), but always joining on
// lowercase jammed "Power generation" into "Powergeneration".
const NEW_WORD = /^(the|and|for|of|to|in|on|at|from|with|by|as|or|an|a)\b/i

function joinParagraphFragments(parts) {
  let out = parts[0].text
  for (let i = 1; i < parts.length; i += 1) {
    const current = parts[i].text
    const previous = parts[i - 1]
    // If the previous fragment is itself a function word, the next word
    // starts after a space ("of visit"), even when it is short.
    const midWord = previous.filled
      || (/^[a-z]/.test(current)
        && previous.text.length <= 2
        && !NEW_WORD.test(current)
        && !NEW_WORD.test(previous.text))
    out += midWord ? current : ` ${current}`
  }
  return out
}

function joinCellFragments(parts) {
  const paragraphs = []
  let current = []
  for (const part of parts) {
    if (!part.text) {
      // A blank cell line inside the same logical row is a hard paragraph break.
      if (current.length) {
        paragraphs.push(joinParagraphFragments(current))
        current = []
      }
      continue
    }
    current.push(part)
  }
  if (current.length) paragraphs.push(joinParagraphFragments(current))
  return paragraphs.join('\n\n')
}

function buildGridRow(group, widths) {
  const columns = widths.map((_, col) => group.map((lineParts) => lineParts[col]))
  return columns.map((parts) => joinCellFragments(parts))
}

function parseGridTable(lines, start, widths) {
  const rows = []
  let i = start + 1
  while (i < lines.length) {
    if (blank(lines[i])) break
    if (!isGridRowLine(lines[i])) break

    const group = []
    while (i < lines.length && isGridRowLine(lines[i])) {
      const parts = gridRowParts(lines[i], widths)
      if (!parts) return null
      group.push(parts)
      i += 1
    }

    // A logical row must be closed by a border line with the same columns.
    if (i >= lines.length) return null
    const closing = gridBorderWidths(lines[i])
    if (!closing || !sameWidths(closing, widths)) return null
    i += 1

    const row = buildGridRow(group, widths)
    // Empty logical rows are real grid structure but must not render as a
    // giant vertical blank space.
    if (row.some((cell) => cell.trim())) rows.push(row)
  }
  if (!rows.length) return null
  return { block: { type: 'table', header: null, rows }, end: i }
}

// A simple-table separator is a line of dashes with two or more runs, e.g.
// "  ------------  ----------  ------". Returns the absolute start of each run.
export function simpleDashColumns(line) {
  const t = String(line ?? '')
  if (!/^\s*-{3,}(?:\s+-{3,})+\s*$/.test(t)) return null
  const starts = [...t.matchAll(/-{3,}/g)].map((match) => match.index)
  if (starts.length < 2) return null
  return { starts }
}

function splitSimpleLine(line, starts) {
  const cells = []
  for (let col = 0; col < starts.length; col += 1) {
    const start = starts[col]
    const end = col + 1 < starts.length ? starts[col + 1] : String(line).length
    cells.push(String(line).slice(start, end).trim())
  }
  return cells
}

function parseSimpleTable(lines, start, columns) {
  const { starts } = columns
  let i = start + 1
  if (i >= lines.length || blank(lines[i])) return null

  const header = splitSimpleLine(lines[i], starts)
  if (header.some((cell) => !cell)) return null
  i += 1

  const rows = []
  while (i < lines.length) {
    if (blank(lines[i])) {
      i += 1
      continue
    }
    if (ruleLine(lines[i]) || simpleDashColumns(lines[i])) {
      i += 1
      break
    }

    const group = []
    while (i < lines.length && !blank(lines[i]) && !ruleLine(lines[i]) && !simpleDashColumns(lines[i])) {
      group.push(lines[i])
      i += 1
    }

    const columnParts = starts.map((_, col) => group.map((line) => ({
      text: splitSimpleLine(line, starts)[col],
      filled: false,
    })))
    const row = columnParts.map((parts) => joinCellFragments(parts))
    if (row.some((cell) => cell.trim())) rows.push(row)
  }

  if (!rows.length) return null
  return { block: { type: 'table', header, rows }, end: i }
}

const LIST_START = /^\s*([-*]|\d+[.)])\s+/
const HEADING_START = /^(#{1,4})\s+(.*)$/

// A source line that is only leftover image marks (`[]` or `[] []`).
// Kept as its own paragraph so two marks on one line stay a row, and a
// mark on the next line stays a separate row, even without a blank line.
export function isPlaceholderOnlyLine(line) {
  const t = String(line ?? '').trim()
  if (!t) return false
  return /^(?:\[\](?:\s+\[\])*)+$/.test(t)
}

export function parseOriginalBody(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (blank(line)) {
      i += 1
      continue
    }

    // GFM pipe table.
    if (pipeTableStart(lines, i)) {
      const columns = pipeCells(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(pipeCells(lines[i]))
        i += 1
      }
      blocks.push({ type: 'table', header: columns, rows })
      continue
    }

    // Pandoc grid table.
    const widths = gridBorderWidths(line)
    if (widths) {
      const parsed = parseGridTable(lines, i, widths)
      if (parsed) {
        blocks.push(parsed.block)
        i = parsed.end
        continue
      }
      // Ambiguous grid: skip the scaffolding and keep the row lines as text.
      i += 1
      continue
    }

    // Simple dash table.
    const simple = simpleDashColumns(line)
    if (simple) {
      const parsed = parseSimpleTable(lines, i, simple)
      if (parsed) {
        blocks.push(parsed.block)
        i = parsed.end
        continue
      }
      i += 1
      continue
    }

    // Standalone ASCII rule (----- or +---+ scaffolding) never becomes prose.
    if (ruleLine(line)) {
      i += 1
      continue
    }

    const heading = line.match(HEADING_START)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (LIST_START.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (i < lines.length && LIST_START.test(lines[i])) {
        items.push(lines[i].replace(LIST_START, ''))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (isPlaceholderOnlyLine(line)) {
      blocks.push({ type: 'paragraph', text: line.trim() })
      i += 1
      continue
    }

    // Paragraph: soft-wrapped source lines are one readable paragraph.
    const paragraph = []
    while (
      i < lines.length
      && lines[i].trim()
      && !pipeTableStart(lines, i)
      && !gridBorderWidths(lines[i])
      && !simpleDashColumns(lines[i])
      && !ruleLine(lines[i])
      && !HEADING_START.test(lines[i])
      && !LIST_START.test(lines[i])
      && !isPlaceholderOnlyLine(lines[i])
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ')

// Serialise parsed blocks back to Markdown. Grid and simple tables become
// GFM pipe tables so pandoc writes real Word tables instead of ASCII boxes.
export function blocksToMarkdown(blocks) {
  const out = []
  for (const block of blocks || []) {
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level || 1, 1), 6)
      out.push(`${'#'.repeat(level)} ${block.text}`, '')
    } else if (block.type === 'paragraph') {
      out.push(block.text, '')
    } else if (block.type === 'list') {
      for (const item of block.items || []) out.push(`${block.ordered ? '1.' : '-'} ${item}`)
      out.push('')
    } else if (block.type === 'table') {
      const header = Array.isArray(block.header) && block.header.length ? block.header : null
      const firstRow = Array.isArray(block.rows?.[0]) ? block.rows[0] : []
      const colCount = header ? header.length : (firstRow.length || 1)
      if (header) {
        out.push(`| ${header.map(escapeCell).join(' | ')} |`)
        out.push(`| ${header.map(() => '---').join(' | ')} |`)
      } else {
        // Keep every data row as a body row; the empty header satisfies GFM.
        out.push(`| ${Array(colCount).fill(' ').join(' | ')} |`)
        out.push(`| ${Array(colCount).fill('---').join(' | ')} |`)
      }
      for (const row of block.rows || []) {
        const cells = Array.isArray(row) ? row : []
        out.push(`| ${cells.map(escapeCell).join(' | ')} |`)
      }
      out.push('')
    }
  }
  return out.join('\n')
}
