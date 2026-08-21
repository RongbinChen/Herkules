// Contract document categories. The keys mirror the Prisma enum
// ContractDocType exactly — the backend stores the key, this file owns how it
// reads. Adding a category means changing both, and the schema change is the
// expensive half (it stops the deploy and needs a manual pass over the VPS).
//
// `tone` feeds <Badge tone> from ui.jsx, so the palette stays the app's.
//
// `label` is what renders; the rest of this app is in English, so it is too.
// `zh` is kept alongside for the day someone wires up a language toggle (the
// visit-report module already has one in i18n/visitReports.js) — a Chinese
// label is easy to lose and hard to reconstruct from an English one.
export const CONTRACT_DOC_TYPES = {
  COMMERCIAL: { label: 'Commercial contract', short: 'Commercial', zh: '商务合同', tone: 'brand' },
  TECHNICAL: { label: 'Technical agreement', short: 'Technical', zh: '技术协议', tone: 'blue' },
  QUOTATION: { label: 'Quotation', short: 'Quotation', zh: '报价单', tone: 'amber' },
  FAT: { label: 'FAT acceptance', short: 'FAT', zh: '出厂验收', tone: 'emerald' },
  FAC: { label: 'FAC', short: 'FAC', zh: 'FAC', tone: 'violet' },
  OTHER: { label: 'Other', short: 'Other', zh: '其他', tone: 'slate' },
}

// Display order: roughly the order a deal moves through, with the catch-all
// last. Not alphabetical — a quotation precedes a contract in real life.
export const DOC_TYPE_ORDER = ['COMMERCIAL', 'TECHNICAL', 'QUOTATION', 'FAT', 'FAC', 'OTHER']

// Rows written before this feature existed have docType OTHER, and a value the
// frontend does not recognise (someone added an enum member and shipped the
// backend first) must still render as something rather than crash a list.
export const docTypeMeta = (t) => CONTRACT_DOC_TYPES[t] || CONTRACT_DOC_TYPES.OTHER

// ── Upload limits ───────────────────────────────────────────────────────────
// Mirrors ALLOWED_EXT and MAX_FILE_BYTES in backend/src/routes/contracts.js.
// The server stays the authority — this copy exists so a 45 MB drop is refused
// in the browser instead of after uploading 45 MB to be told no. Keep the two
// lists in step; a value only added here would let a file through to a 400.
export const MAX_FILE_BYTES = 40 * 1024 * 1024
export const ALLOWED_EXT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp',
]

// Feeds the file input's `accept` so the OS picker filters too.
export const ACCEPT_ATTR = ALLOWED_EXT.join(',')

export const fmtFileSize = (n) =>
  (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Returns an error string, or '' when the file is acceptable. */
export function validateContractFile(file) {
  if (!file) return 'No file selected'
  const dot = file.name.lastIndexOf('.')
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) return `File type ${ext || '(none)'} is not accepted`
  if (file.size > MAX_FILE_BYTES) return `${fmtFileSize(file.size)} is over the 40 MB limit`
  // A dropped folder arrives as a zero-byte entry with no type — uploading it
  // would store an empty file under the folder's name.
  if (file.size === 0) return 'That looks like an empty file or a folder'
  return ''
}

// ── OCR status ───────────────────────────────────────────────────────────────
// Contracts arrive as scans with no text layer, so a file is not searchable or
// answerable until the DGX has read it. The list says so rather than letting
// someone search a file that cannot match yet and conclude the search is broken.
export const OCR_STATUS = {
  PENDING: { label: 'Queued for reading', zh: '排队待识别', tone: 'slate' },
  RUNNING: { label: 'Being read', zh: '识别中', tone: 'blue' },
  DONE: { label: 'Readable', zh: '已识别', tone: 'emerald' },
  FAILED: { label: 'Could not be read', zh: '识别失败', tone: 'amber' },
  SKIPPED: { label: 'Not a scan', zh: '无需识别', tone: 'slate' },
}

// DONE is the normal state once the backlog clears; badging every row with a
// green tick would be noise. Only the states that explain a missing answer show.
export const ocrNeedsBadge = (s) => s === 'PENDING' || s === 'RUNNING' || s === 'FAILED'
export const ocrMeta = (s) => OCR_STATUS[s] || OCR_STATUS.PENDING

// ── Display name ─────────────────────────────────────────────────────────────
// Scans get run through a shrinker before upload, and whoever does it prefixes
// the file with （已压缩）/(已瘦身). That is a note about the file's history, not
// part of its name, and repeated down a list it pushes the part people actually
// read off to the right. Stripped for display only — download still saves, and
// search still matches, the real stored name.
const SIZE_MARK = /^[\s]*[（(]\s*已\s*(压缩|瘦身)\s*[)）][\s]*/
export function displayFilename(name = '') {
  let out = name
  while (SIZE_MARK.test(out)) out = out.replace(SIZE_MARK, '')
  return out.trim() || name
}
