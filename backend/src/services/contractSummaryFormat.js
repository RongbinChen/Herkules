// Pure formatting and page-selection logic for the contract key-terms summary —
// no database, no network, so the prompt and the parser can be exercised against
// real page text without standing up the app. Same split as
// contractRetrieval.js / contractQa.js: this half decides what to ask and how to
// read the reply, contractSummary.js does the I/O.
import { rankPages } from './contractRetrieval.js';

// The contract head — number, parties, total — is almost always on the first
// page or two, and it is the one region no keyword reliably beats.
const LEAD_PAGES = Number(process.env.CONTRACT_SUMMARY_LEAD || 3);
// Ceilings on what gets sent. Keeps generation inside the ask timeout and well
// under the VPS proxy's 60s — a real contract measured 8 pages / 21k characters
// at 9.3s.
const MAX_SENT_PAGES = Number(process.env.CONTRACT_SUMMARY_SENT || 10);
const MAX_SENT_CHARS = Number(process.env.CONTRACT_SUMMARY_CHARS || 26000);

// One query per field, not one query for all of them. A single query naming
// every concept makes them compete: the ranker returned the payment and price
// pages and dropped the warranty clause, so the model — correctly — reported the
// warranty as absent from a contract that states it on page 12. Retrieving per
// topic guarantees each field its own page or two, and the union is still small.
//
// The terms are written the way a contract writes them, in both languages,
// because that is what the page text contains.
// Retrieval topics, keyed to the fields that need them. A single query naming
// every concept makes them compete: the ranker returned the payment and price
// pages and dropped the warranty clause, so the model — correctly — reported the
// warranty as absent from a contract that states it on page 12. Retrieving per
// topic guarantees each field its own page or two, and the union is still small.
//
// The terms are written the way a contract writes them, in both languages,
// because the page text is bilingual and the model reads whichever half matched.
const TOPICS = {
  parties: '买方 卖方 buyer seller 合同号 contract no',
  amount: '合同金额 总价 总额 total contract value contract price',
  payment: '付款条件 支付 terms of payment',
  delivery: '交货期 交货 交付 delivery time shipment',
  warranty: '质保期 质量保证期 保证期 warranty period guarantee period',
  machine: '机床型号 设备型号 型号 machine type model 磨床 车床 grinder lathe roll',
  scope: '供货范围 供货清单 scope of supply scope of delivery 供货内容',
  signedDate: '签订日期 签署日期 签字 签订于 date of signature signed on entered into',
  komNo: 'kom nr kom no 委托号 机器号',
};
// Pages to take per topic. Two, because the clause and the figure it refers to
// are often on facing pages.
const PER_TOPIC = Number(process.env.CONTRACT_SUMMARY_PER_TOPIC || 2);

// A technical agreement has no price, no payment schedule and no warranty — it
// specifies a machine. Asking it the commercial questions produced a column of
// dashes, which reads as a failure rather than as "wrong question". So the
// field set follows the document type.
//
// `topic` names the retrieval query that finds this field's page; `hint` is the
// extra instruction the model needs for the fields where the obvious reading is
// the wrong one.
const COMMERCIAL_FIELDS = [
  { key: 'contractNo', label: 'Contract No.', topic: 'parties' },
  { key: 'buyer', label: 'Buyer', topic: 'parties' },
  { key: 'seller', label: 'Seller', topic: 'parties' },
  { key: 'amount', label: 'Contract value', topic: 'amount',
    hint: 'copy the currency and figure exactly as printed — do not convert or round' },
  { key: 'payment', label: 'Payment terms', topic: 'payment',
    hint: 'condense to one line, e.g. "20% advance / 70% on shipment / 10% on acceptance"' },
  { key: 'delivery', label: 'Delivery time', topic: 'delivery' },
  { key: 'warranty', label: 'Warranty', topic: 'warranty' },
  { key: 'komNo', label: 'Kom. No.', topic: 'komNo' },
];

const TECHNICAL_FIELDS = [
  { key: 'contractNo', label: 'Contract No.', topic: 'parties' },
  { key: 'buyer', label: 'Buyer', topic: 'parties' },
  { key: 'seller', label: 'Seller', topic: 'parties' },
  { key: 'machine', label: 'Machine model', topic: 'machine',
    hint: 'the machine type designation, e.g. "ProfiMill 300" or "WS 450 x 6000"' },
  { key: 'scope', label: 'Scope of supply', topic: 'scope',
    hint: 'one line — what is being supplied, and how many' },
  { key: 'signedDate', label: 'Signed on', topic: 'signedDate' },
  { key: 'komNo', label: 'Kom. No.', topic: 'komNo' },
];

// Bumped whenever the fields or the prompt change, so summaries stored under
// the old shape are regenerated instead of being rendered with labels that no
// longer match what was asked.
export const SUMMARY_VERSION = 3;

export function summaryFields(docType) {
  return docType === 'TECHNICAL' ? TECHNICAL_FIELDS : COMMERCIAL_FIELDS;
}

// The queries whose pages this document type needs — deduped, since several
// fields share the parties page.
export function summaryTopics(docType) {
  return [...new Set(summaryFields(docType).map((f) => f.topic))].map((k) => TOPICS[k]);
}

// "Not in these pages" has to be a value the model can pick, or it invents one.
const NONE = '\u2014';
// The worker's own ask prompt tells the model to say "\u672a\u5728\u63d0\u4f9b\u7684\u9875\u9762\u4e2d\u627e\u5230" when
// a fact is absent, and that instruction reaches the model alongside this one.
// Rather than have the two prompts argue, the answer is normalised here — any
// phrasing of "I could not find it" becomes the same empty marker, in either
// language.
const ABSENT = /^(\u2014|-|\u65e0|\u672a\u627e\u5230|\u6ca1\u6709\u627e\u5230|\u672a\u63d0\u53ca|\u672a\u6ce8\u660e|\u672a\u5728.*\u627e\u5230|not (found|specified|mentioned|stated|given)|none|n\/?a)[\u3002.\s]*$/i;

// Written in English because the answer has to come back in English: the
// worker's own ask prompt tells the model to reply in the language of the
// question, and these contracts are bilingual, so left in Chinese it would
// answer in Chinese half the time.
export function summaryPrompt(docType) {
  const fields = summaryFields(docType);
  const hints = fields.filter((f) => f.hint).map((f) => `- ${f.label}: ${f.hint}.`);
  return `List the key terms of this contract in exactly the format below, one per line, in this order, and output nothing else:

${fields.map((f) => `${f.label}: <value> | source: <p.N>`).join('\n')}

Rules:
- Answer in English. Where the page gives a company name or a term in both
  Chinese and English, use the English one; where it is only in Chinese,
  translate it.
- If a term is not in the pages provided, write ${NONE} for both the value and
  the source. Do not guess.
${hints.join('\n')}
- Kom. No. is the seller's internal commission number, shaped like 30-0004 or
  98950, usually printed after "Kom. No." / "Kom. Nr.". It is NOT the contract
  number — if no Kom. No. is written on the pages, put ${NONE} rather than
  repeating the contract number.
- The source is the page number only.`;
}

// Lenient on purpose. The model is told to emit exactly these lines, but a
// stray bullet, a bolded label or a full-width colon should not cost the whole
// summary — an unparsed line falls through and the raw text is kept alongside.
export function parseSummary(answer, docType) {
  const lines = String(answer || '').split('\n');
  // hint is a prompt detail; it has no business travelling to the browser.
  const fields = summaryFields(docType).map(({ key, label }) => ({ key, label, value: NONE, source: null }));

  for (const line of lines) {
    // Emphasis first, then the list marker. The other order eats the first
    // asterisk of a bolded label and leaves "*Contract No." behind, which then
    // matches nothing — the whole line is silently dropped.
    const clean = line.replace(/\*\*/g, '').replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim();
    if (!clean) continue;
    const field = fields.find((f) => {
      const head = clean.slice(0, f.label.length + 2).toLowerCase();
      return head.startsWith(f.label.toLowerCase());
    });
    if (!field) continue;

    let rest = clean.slice(clean.indexOf(field.label) + field.label.length).replace(/^\s*[:：]\s*/, '');
    // The source rides after a pipe; both widths appear in practice.
    const [value, ...srcParts] = rest.split(/[｜|]/);
    const src = srcParts.join(' ').replace(/^\s*(出处|source)\s*[:：]?\s*/i, '').trim();
    const v = value.trim();
    field.value = !v || ABSENT.test(v) ? NONE : v;
    field.source = src && !ABSENT.test(src) && field.value !== NONE ? src : null;
  }
  return fields;
}

// Kom. No. is almost never printed in the contract itself — of the files on
// record, not one states it in the body. It lives in the note the uploader
// types ("Kom. No.: 98950, 30-0003 (with RSIS)"), so when the model finds
// nothing in the pages, that is where to look.
//
// The value is cut at the next labelled field, because a note often runs
// several of them together: "Kom. Nr.: 85660/670/680, Contract no.: 01DEN…"
// must yield the Kom part alone, while "98950, 30-0003 (with RSIS)" is one
// value and must survive its comma intact.
export function komFromNote(note) {
  const m = /kom\s*\.?\s*(?:no|nr)\s*\.?\s*[:：]?\s*/i.exec(note || '');
  if (!m) return null;
  let rest = String(note).slice(m.index + m[0].length).split(/[\r\n]/)[0];
  // A separator followed by a word-ish label ending in No./Nr.: — the start of
  // the next field, not part of this one.
  const nextLabel = /[,;.]\s*[A-Za-z][A-Za-z ]{2,}\s*(?:no|nr)\s*\.?\s*[:：]/i.exec(rest);
  if (nextLabel) rest = rest.slice(0, nextLabel.index);
  const value = rest.replace(/[\s.,;]+$/, '').trim();
  return value || null;
}

// Where a value came from. Page citations are what the model read; NOTE marks
// the one field that may instead come from what a colleague typed, because the
// two are not the same kind of evidence and the reader should see which is which.
export const NOTE_SOURCE = 'note';

// Choose the pages to send from a file's pages, already loaded.
//
// Two ceilings, because either one alone leaks. Pages guard the model's
// attention; characters guard its context window — ten dense pages of a
// bilingual contract run past what num_ctx holds, and an overflowing prompt is
// silently truncated at the far end, which is where the answer was.
export function pickSummaryPages(pages, docType) {
  if (!pages.length) return [];
  const byNo = new Map(pages.map((p) => [p.pageNo, p]));

  // Lead pages first so that if the character budget runs out, what survives is
  // the contract head — the one region that carries several fields at once.
  const picked = new Map();
  for (const p of pages.slice(0, LEAD_PAGES)) picked.set(p.pageNo, p);
  for (const query of summaryTopics(docType)) {
    const { pages: seeds } = rankPages(pages, query, {
      maxPages: PER_TOPIC,
      // One file, so the per-file cap that stops an appendix crowding out the
      // contract has nothing to protect against here.
      maxPerFile: PER_TOPIC,
    });
    for (const seed of seeds) {
      const page = byNo.get(seed.pageNo);
      if (page) picked.set(page.pageNo, page);
    }
  }

  const sent = [];
  let chars = 0;
  for (const p of [...picked.values()].sort((a, b) => a.pageNo - b.pageNo)) {
    if (sent.length >= MAX_SENT_PAGES || chars + p.text.length > MAX_SENT_CHARS) continue;
    sent.push(p);
    chars += p.text.length;
  }
  return sent;
}
