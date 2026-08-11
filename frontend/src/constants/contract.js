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
  SAT: { label: 'SAT acceptance', short: 'SAT', zh: 'SAT 验收', tone: 'emerald' },
  FAC: { label: 'FAC', short: 'FAC', zh: 'FAC', tone: 'violet' },
  OTHER: { label: 'Other', short: 'Other', zh: '其他', tone: 'slate' },
}

// Display order: roughly the order a deal moves through, with the catch-all
// last. Not alphabetical — a quotation precedes a contract in real life.
export const DOC_TYPE_ORDER = ['COMMERCIAL', 'TECHNICAL', 'QUOTATION', 'SAT', 'FAC', 'OTHER']

// Rows written before this feature existed have docType OTHER, and a value the
// frontend does not recognise (someone added an enum member and shipped the
// backend first) must still render as something rather than crash a list.
export const docTypeMeta = (t) => CONTRACT_DOC_TYPES[t] || CONTRACT_DOC_TYPES.OTHER
