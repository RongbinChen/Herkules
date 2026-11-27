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

import { stripEmphasis } from './markdownEmphasis.js'

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

// Word justification and unwrap often leave irregular extra spaces in prose.
// Tables keep their own cell structure; this only collapses runs of spaces
// or tabs inside already-extracted text.
export function collapseProseSpaces(text) {
  return String(text ?? '').replace(/[ \t]+/g, ' ').trim()
}

// Leftover Word-template prompt or bare cover title. Hidden on display/export
// and treated as "no title" so Generate can fill a real one. Do not match
// genuine headings such as "Telephone Call Report".
export function isChromeParagraph(text) {
  const t = collapseProseSpaces(text)
  if (!t) return false
  if (/^please select type of report\.?$/i.test(t)) return true
  if (/^(new\s+)?visit report\.?$/i.test(t)) return true
  if (/^(新)?拜访报告。?$/.test(t)) return true
  return false
}

// A short stand-alone line that can be used as an imported title.
export function isUsableSourceTitle(text) {
  const t = collapseProseSpaces(stripEmphasis(text))
  if (!t || isChromeParagraph(t)) return false
  return isSectionTitle(text)
}


// Rejoin a mid-word wrap in a short form label ("Parti cipants") without
// gluing ordinary label words ("Purpose of visit", "Date of Visit").
const LABEL_KEEP = /^(the|and|for|of|to|in|on|at|from|with|by|as|or|an|a|visit|report|type|purpose|country|date|machine|no|generation|new)$/i

export function rejoinLabelWraps(text) {
  return String(text ?? '').replace(/([A-Za-z]) ([a-z]+)/g, (all, lead, rest) => (
    LABEL_KEEP.test(rest) ? all : `${lead}${rest}`
  ))
}

function listMarker(line) {
  const ordered = String(line ?? '').match(/^\s*(\d+)[.)]\s+(.*)$/)
  if (ordered) return { ordered: true, number: Number(ordered[1]), text: ordered[2] }
  const bullet = String(line ?? '').match(/^\s*[-*]\s+(.*)$/)
  if (bullet) return { ordered: false, number: null, text: bullet[1] }
  return null
}

function isBlockOpener(lines, index) {
  const line = lines[index]
  return pipeTableStart(lines, index)
    || !!gridBorderWidths(line)
    || !!simpleDashColumns(line)
    || ruleLine(line)
    || HEADING_START.test(line)
    || isPlaceholderOnlyLine(line)
}

// Indented soft-wraps stay on the current item. An unindented lowercase
// line is also a wrap; an unindented "(" starts a parenthetical aside
// and must not be folded into the previous item.
function isListContinuation(lines, index) {
  const line = lines[index]
  if (blank(line) || listMarker(line) || isBlockOpener(lines, index)) return false
  if (/^\s+/.test(line)) return true
  if (/^[a-z]/.test(line)) return true
  return false
}

function peekSameList(lines, index, ordered) {
  let j = index
  while (j < lines.length && blank(lines[j])) j += 1
  const mark = j < lines.length ? listMarker(lines[j]) : null
  if (mark && mark.ordered === ordered) return j
  return -1
}

function parseList(lines, start) {
  const first = listMarker(lines[start])
  if (!first) return null
  const items = []
  let i = start
  while (i < lines.length) {
    if (blank(lines[i])) {
      const next = peekSameList(lines, i, first.ordered)
      if (next < 0) break
      i = next
      continue
    }
    const mark = listMarker(lines[i])
    if (!mark || mark.ordered !== first.ordered) break
    const parts = [mark.text]
    i += 1
    while (i < lines.length && isListContinuation(lines, i)) {
      parts.push(String(lines[i]).trim())
      i += 1
    }
    items.push({ text: collapseProseSpaces(parts.join(' ')), number: mark.number })
  }
  if (!items.length) return null
  const startNo = first.ordered ? (items[0].number || 1) : undefined
  return {
    block: {
      type: 'list',
      ordered: first.ordered,
      ...(first.ordered ? { start: startNo } : {}),
      items: items.map((item) => item.text),
    },
    end: i,
  }
}

function isParentheticalAside(text) {
  const t = collapseProseSpaces(text)
  return t.length >= 3 && /^\(.*\)$/.test(t)
}

// Short, punctuation-free stand-alone lines are section titles in these
// visit notes, not body sentences.
function isSectionTitle(text) {
  // Classify on the visible wording so **[Project briefing:]{.underline}**
  // still counts as a section title after the markers are ignored.
  const raw = collapseProseSpaces(text)
  const t = collapseProseSpaces(stripEmphasis(text))
  if (t.length < 8 || t.length > 140) return false
  if (isChromeParagraph(t) || isParentheticalAside(t) || isPlaceholderOnlyLine(t)) return false
  const core = t.replace(/[:：]\s*$/, '')
  if (/[.!?;。！？；]$/.test(t) || /[.!?:;。！？；]/.test(core)) return false
  // A trailing colon is only a section label when the source was marked
  // (bold/underline). Plain sentences such as "They ordered ... as follows:"
  // stay body paragraphs.
  if (/[:：]$/.test(t) && raw === t) return false
  if (/\|/.test(t)) return false
  // "Name / Name" signatures and paired labels are not section titles.
  if (/\s\/\s/.test(t)) return false
  return true
}

function flattenFieldValue(text) {
  return collapseProseSpaces(String(text ?? '').replace(/\n+/g, ' ')).replace(/[;,]\s*$/, '')
}

function normalizeLabel(text) {
  return rejoinLabelWraps(collapseProseSpaces(text)).replace(/[:：]\s*$/, '').trim()
}

const FIELD_DEFS = [
  [/^to$/i, 'recipients', 'To'],
  [/^from$/i, 'from', 'From'],
  // Bare "Fax" is the usual "From" slot on some templates; "Telefax"/"Telex"
  // is the number on the address row. Keep them as separate fields.
  [/^fax$/i, 'fax', 'Fax'],
  [/^cc$/i, 'cc', 'CC'],
  [/^date$/i, 'letterDate', 'Date'],
  [/^company$/i, 'company', 'Company'],
  [/^address$/i, 'address', 'Address'],
  [/^phone$/i, 'phone', 'Phone'],
  [/^(telefax|telex)$/i, 'telefax', 'Telefax'],
  [/^(place\s*\/\s*country|place|country)$/i, 'location', 'Location'],
  [/^e-?mail$/i, 'email', 'E-Mail'],
  [/^industry$/i, 'industry', 'Industry'],
  [/^(date of visit|visit date|拜访日期)$/i, 'dateOfVisit', 'Date of Visit'],
  [/^quotation no\.?$/i, 'quotationNo', 'Quotation No.'],
  [/^machine\s*\/\s*type$/i, 'machineType', 'Machine / Type'],
  [/^reason\s*\/\s*purpose of visit$/i, 'reason', 'Reason / Purpose of Visit'],
]

function titleCaseLabel(text) {
  return String(text || '').replace(/[A-Za-z]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
}

function matchField(label) {
  const t = normalizeLabel(label)
  if (!t) return null
  for (const [pattern, key, title] of FIELD_DEFS) {
    if (pattern.test(t)) {
      // Keep Telex / Fax / Telefax as written; other fields use a stable title.
      const display = key === 'telefax' ? titleCaseLabel(t) : title
      return { key, label: display }
    }
  }
  return null
}

function isParticipantsHeaderRow(row) {
  const labels = (row || []).map((cell) => normalizeLabel(cell))
  return labels.some((cell) => /participants?/i.test(cell))
}

function isEmptyRow(row) {
  return !(row || []).some((cell) => collapseProseSpaces(cell))
}

function extractFieldsFromRow(row, fields) {
  const cells = Array.isArray(row) ? row : []
  const slots = []
  if (cells.length >= 5) {
    // Two-up letterhead: label | value | (pad) | label | value
    slots.push([cells[0], cells.slice(1, 3).join(' ')])
    slots.push([cells[3], cells[4]])
  } else if (cells.length >= 2) {
    slots.push([cells[0], cells.slice(1).join(' ')])
  } else {
    return 0
  }
  let found = 0
  for (const [rawLabel, rawValue] of slots) {
    const field = matchField(rawLabel)
    if (!field) continue
    const value = flattenFieldValue(rawValue)
    if (!value) continue
    if (!fields.some((item) => item.key === field.key)) {
      fields.push({ key: field.key, label: field.label, value })
    }
    found += 1
  }
  return found
}

function groupLabelFromHeader(cell) {
  const t = normalizeLabel(cell).replace(/^(participants?)\s+/i, '').trim()
  return t || normalizeLabel(cell)
}

function splitPeople(cell) {
  return String(cell ?? '')
    .split(/\n{2,}/)
    .map((part) => collapseProseSpaces(part))
    .filter(Boolean)
}

function buildAttendees(header, rows) {
  const labels = (header || []).map((cell) => normalizeLabel(cell))
  let customerCol = labels.findIndex((cell) => /customer/i.test(cell))
  let otherCol = labels.findIndex((cell, index) => index !== customerCol && /participants?|\bwaldrich|\bworkshop|\bwasi\b/i.test(cell))
  const functionCol = labels.findIndex((cell) => /function|title|role|职务/i.test(cell))
  const peopleCols = labels
    .map((cell, index) => (/participants?/i.test(cell) || /customer/i.test(cell) ? index : -1))
    .filter((index) => index >= 0)
  if (customerCol < 0 && peopleCols.length) customerCol = peopleCols[0]
  if (otherCol < 0 && peopleCols.length > 1) otherCol = peopleCols.find((index) => index !== customerCol)
  if (customerCol < 0 && otherCol < 0) return null

  const groups = []
  const ensure = (col) => {
    if (col == null || col < 0) return null
    let group = groups.find((item) => item.col === col)
    if (!group) {
      group = { col, label: groupLabelFromHeader(header[col]) || 'Attendees', people: [] }
      groups.push(group)
    }
    return group
  }
  const customerGroup = ensure(customerCol)
  const otherGroup = ensure(otherCol)

  for (const row of rows) {
    const left = customerCol >= 0 ? splitPeople(row[customerCol]) : []
    const right = otherCol >= 0 ? splitPeople(row[otherCol]) : []
    const roles = functionCol >= 0 ? splitPeople(row[functionCol]) : []
    // The Function column sits between the two sides and, in these
    // templates, belongs to the adjacent customer/left names only.
    if (customerGroup) {
      left.forEach((name, index) => {
        const role = roles[index] || ''
        customerGroup.people.push(role ? `${name} (${role})` : name)
      })
    }
    if (otherGroup) {
      right.forEach((name) => {
        otherGroup.people.push(name)
      })
    }
  }

  const visible = groups
    .map(({ label, people }) => ({
      label,
      people: people.filter((name, index, all) => name && all.indexOf(name) === index),
    }))
    .filter((group) => group.people.length)
  return visible.length ? { type: 'attendees', groups: visible } : null
}

function collectTableRows(block) {
  const rows = []
  if (Array.isArray(block.header) && block.header.some((cell) => String(cell || '').trim())) {
    rows.push(block.header)
  }
  for (const row of block.rows || []) rows.push(row)
  return rows
}

function isLetterheadTable(block) {
  if (!block || block.type !== 'table') return false
  const rows = collectTableRows(block)
  if (rows.length < 2) return false
  let fields = 0
  let participants = false
  for (const row of rows) {
    if (isParticipantsHeaderRow(row)) participants = true
    const tmp = []
    extractFieldsFromRow(row, tmp)
    fields += tmp.length
  }
  return participants || fields >= 3
}

function letterheadBlocks(block) {
  const rows = collectTableRows(block)

  const fields = []
  let header = null
  const peopleRows = []
  let mode = 'fields'
  for (const row of rows) {
    if (isEmptyRow(row)) {
      if (mode === 'participants') mode = 'fields'
      continue
    }
    if (isParticipantsHeaderRow(row)) {
      header = row
      mode = 'participants'
      continue
    }
    if (mode === 'participants' && !matchField(row?.[0])) {
      peopleRows.push(row)
      continue
    }
    mode = 'fields'
    extractFieldsFromRow(row, fields)
  }

  const out = []
  if (fields.length) out.push({ type: 'meta', fields })
  const attendees = header ? buildAttendees(header, peopleRows) : null
  if (attendees) out.push(attendees)
  return out.length ? out : [block]
}

function decorateBlock(block) {
  if (block.type === 'paragraph') {
    const text = collapseProseSpaces(block.text)
    if (!text || isChromeParagraph(text)) return null
    if (isParentheticalAside(text)) return { type: 'paragraph', text, aside: true }
    if (isSectionTitle(text)) return { type: 'heading', level: 3, text, section: true }
    return { ...block, text }
  }
  if (block.type === 'heading') {
    const text = collapseProseSpaces(block.text)
    if (!text || isChromeParagraph(text)) return null
    return { ...block, text }
  }
  if (block.type === 'list') {
    return {
      ...block,
      items: (block.items || []).map((item) => (typeof item === 'string' ? collapseProseSpaces(item) : item)),
    }
  }
  return block
}

function structurePreservedBlocks(blocks) {
  const out = []
  for (const block of blocks || []) {
    if (isLetterheadTable(block)) {
      out.push(...letterheadBlocks(block))
      continue
    }
    const next = decorateBlock(block)
    if (next) out.push(next)
  }
  return out
}

export function hasPreservedLetterhead(markdown) {
  return parseOriginalBody(markdown).some((block) => block.type === 'meta' || block.type === 'attendees')
}

// Known letterhead fields, including Date of Visit from a table that did not
// have enough other fields to be classified as a full letterhead.
const RECOVERED_HEADING = /^(?:Text recovered from the (?:header|footer|document body)|Text recovered from text boxes)\s*$/i

function nextFilledLine(lines, start) {
  for (let i = start; i < lines.length; i += 1) {
    const text = collapseProseSpaces(lines[i])
    if (text) return text
  }
  return ''
}

// Unambiguous same-line labels (`To: A. Example`), used as a fallback when
// the value is not already in a letterhead table.
function collectColonFields(text, fields) {
  for (const raw of String(text ?? '').split(/\n/)) {
    const line = collapseProseSpaces(raw)
    const labeled = line.match(/^(.+?)\s*[:：]\s*(.+)$/)
    if (!labeled) continue
    const field = matchField(labeled[1])
    const value = flattenFieldValue(labeled[2])
    if (field && value && !fields.some((item) => item.key === field.key)) {
      fields.push({ key: field.key, label: field.label, value })
    }
  }
}

// Recovered header/footer/text-box appendices are often loose paragraphs
// (label, then value) because the Word XML path does not keep the table.
function collectRecoveredFields(text, fields) {
  collectColonFields(text, fields)
  const lines = String(text ?? '').split(/\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = collapseProseSpaces(lines[i])
    if (!line || RECOVERED_HEADING.test(line)) continue
    if (/[:：]/.test(line)) continue
    const field = matchField(line)
    if (!field) continue
    const next = nextFilledLine(lines, i + 1)
    if (!next || RECOVERED_HEADING.test(next) || matchField(next)) continue
    const nextLabel = next.match(/^(.+?)\s*[:：]/)
    if (nextLabel && matchField(nextLabel[1])) continue
    const value = flattenFieldValue(next)
    if (value && !fields.some((item) => item.key === field.key)) {
      fields.push({ key: field.key, label: field.label, value })
    }
  }
}

function recoveredSectionBodies(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const bodies = []
  let current = null
  for (const line of lines) {
    if (RECOVERED_HEADING.test(collapseProseSpaces(line))) {
      if (current) bodies.push(current.join('\n'))
      current = []
      continue
    }
    if (current) current.push(line)
  }
  if (current) bodies.push(current.join('\n'))
  return bodies
}

export function letterheadMetaFields(markdown) {
  const fields = []
  const add = (list) => {
    for (const field of list || []) {
      if (field?.key && !fields.some((item) => item.key === field.key)) fields.push(field)
    }
  }
  for (const block of parseOriginalBody(markdown)) {
    if (block.type === 'meta') {
      add(block.fields)
      continue
    }
    if (block.type !== 'table') continue
    const found = []
    for (const row of collectTableRows(block)) extractFieldsFromRow(row, found)
    add(found)
  }
  collectColonFields(markdown, fields)
  for (const body of recoveredSectionBodies(markdown)) collectRecoveredFields(body, fields)
  return fields
}

// Report Header inputs on the edit form. Other letterhead keys (From, Date,
// Date of Visit, Company, Phone) stay out of this object.
export const HEADER_META_KEYS = ['recipients', 'cc', 'location', 'industry', 'machineType', 'quotationNo']

function fieldValueByKey(fields, key) {
  const field = (fields || []).find((item) => item.key === key)
  return flattenFieldValue(field?.value)
}

// A bare "Fax" slot is only treated as the author when the value looks like a
// person's name. Digit-heavy values stay fax numbers, not authors.
function looksLikePersonName(value) {
  const text = flattenFieldValue(value)
  if (!text) return false
  const letters = (text.match(/\p{L}/gu) || []).length
  const digits = (text.match(/\d/g) || []).length
  if (letters < 2 || digits >= 6 || digits > letters) return false
  return true
}

// Prefer an explicit From field. Fall back to a bare Fax slot only when that
// value looks like a name. Phone, Telefax, CC, and To are never used.
export function letterheadAuthorName(markdown) {
  const fields = letterheadMetaFields(markdown)
  const from = fieldValueByKey(fields, 'from')
  if (from) return from
  const fax = fieldValueByKey(fields, 'fax')
  if (fax && looksLikePersonName(fax)) return fax
  return ''
}

export function letterheadHeaderMeta(markdown) {
  const meta = {}
  for (const field of letterheadMetaFields(markdown)) {
    if (!HEADER_META_KEYS.includes(field.key)) continue
    const value = flattenFieldValue(field.value)
    if (value && meta[field.key] == null) meta[field.key] = value
  }
  return meta
}

// Fill empty Report Header keys from the letterhead. A value already in
// meta, including one the user saved, is left alone. Missing keys stay
// absent; nothing is invented. The letterhead From (or a name-like Fax
// slot) is also copied into meta.author for attribution; author is not a
// Report Header form field.
export function mergeLetterheadHeaderMeta(existingMeta, markdown) {
  const existing = (existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta))
    ? { ...existingMeta }
    : {}
  const fromLetterhead = letterheadHeaderMeta(markdown)
  for (const key of HEADER_META_KEYS) {
    if (flattenFieldValue(existing[key])) continue
    if (fromLetterhead[key]) existing[key] = fromLetterhead[key]
  }
  if (!flattenFieldValue(existing.author)) {
    const author = letterheadAuthorName(markdown)
    if (author) existing.author = author
  }
  return existing
}

export function withLetterheadHeaderMeta(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const markdown = typeof content.originalBody === 'string' ? content.originalBody : ''
  if (!markdown.trim()) return content
  const meta = mergeLetterheadHeaderMeta(content.meta, markdown)
  if (!Object.keys(meta).length && !content.meta) return content
  return { ...content, meta }
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
      blocks.push({ type: 'heading', level: heading[1].length, text: collapseProseSpaces(heading[2]) })
      i += 1
      continue
    }

    if (LIST_START.test(line)) {
      const parsed = parseList(lines, i)
      if (parsed) {
        blocks.push(parsed.block)
        i = parsed.end
        continue
      }
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
    if (paragraph.length) blocks.push({ type: 'paragraph', text: collapseProseSpaces(paragraph.join(' ')) })
  }

  return structurePreservedBlocks(blocks)
}

const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ')

function listItemText(item) {
  if (item == null) return ''
  if (typeof item === 'string') return item
  if (item.text) return item.text
  return String(item)
}

// Serialise parsed blocks back to Markdown. Grid and simple tables become
// GFM pipe tables so pandoc writes real Word tables instead of ASCII boxes.
export function blocksToMarkdown(blocks) {
  const out = []
  for (const block of blocks || []) {
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level || 1, 1), 6)
      out.push(`${'#'.repeat(level)} ${block.text}`, '')
    } else if (block.type === 'paragraph') {
      if (isChromeParagraph(block.text)) continue
      out.push(block.text, '')
    } else if (block.type === 'list') {
      const start = block.ordered ? (Number(block.start) || 1) : 0
      ;(block.items || []).forEach((item, index) => {
        const text = listItemText(item)
        out.push(block.ordered ? `${start + index}. ${text}` : `- ${text}`)
      })
      out.push('')
    } else if (block.type === 'meta') {
      const fields = (block.fields || []).filter((field) => field?.label && field?.value)
      if (fields.length) {
        out.push('| Field | Value |', '| --- | --- |')
        for (const field of fields) out.push(`| ${escapeCell(field.label)} | ${escapeCell(field.value)} |`)
        out.push('')
      }
    } else if (block.type === 'attendees') {
      out.push('## Attendees', '')
      for (const group of block.groups || []) {
        if (!group?.people?.length) continue
        out.push(`**${group.label}:** ${group.people.join('; ')}`, '')
      }
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
