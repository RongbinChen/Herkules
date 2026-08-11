// Contract document categories. The keys mirror the Prisma enum
// ContractDocType exactly — the backend stores the key, this file owns how it
// reads. Adding a category means changing both, and the schema change is the
// expensive half (it stops the deploy and needs a manual pass over the VPS).
//
// `tone` feeds <Badge tone> from ui.jsx, so the palette stays the app's.
export const CONTRACT_DOC_TYPES = {
  COMMERCIAL: { label: '商务合同', en: 'Commercial contract', tone: 'brand' },
  TECHNICAL: { label: '技术协议', en: 'Technical agreement', tone: 'blue' },
  QUOTATION: { label: '报价单', en: 'Quotation', tone: 'amber' },
  SAT: { label: 'SAT 验收', en: 'SAT acceptance', tone: 'emerald' },
  FAC: { label: 'FAC', en: 'FAC', tone: 'violet' },
  OTHER: { label: '其他', en: 'Other', tone: 'slate' },
}

// Display order: roughly the order a deal moves through, with the catch-all
// last. Not alphabetical — a quotation precedes a contract in real life.
export const DOC_TYPE_ORDER = ['COMMERCIAL', 'TECHNICAL', 'QUOTATION', 'SAT', 'FAC', 'OTHER']

// Rows written before this feature existed have docType OTHER, and a value the
// frontend does not recognise (someone added an enum member and shipped the
// backend first) must still render as something rather than crash a list.
export const docTypeMeta = (t) => CONTRACT_DOC_TYPES[t] || CONTRACT_DOC_TYPES.OTHER
