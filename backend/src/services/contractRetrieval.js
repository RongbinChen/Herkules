// Pure page-retrieval logic for contract Q&A — no database, no I/O, so it can be
// reasoned about and tested on its own. contractQa.js pulls the pages from the
// DB and hands them here to be scored and ranked.
//
// This is the "locate with text" half. It only has to surface roughly the right
// pages; the vision model does the real reading off the original image. So the
// tokenizer is deliberately crude — bigrams for Chinese, whole words for latin —
// rather than a real segmenter that would be a dependency to keep in step for a
// step whose mistakes the model step forgives.

// Chinese stopwords and question scaffolding that would otherwise match every
// page. Kept short: the goal is to drop noise, not to build a real tokenizer.
const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '有', '为', '这', '那', '什么',
  '多少', '多久', '哪', '哪些', '如何', '怎么', '怎样', '请问', '吗', '呢', '吧',
  '一下', '关于', '合同', '文件', '里', '中', '内', '对', '把', '给', '到', '会',
  'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on', 'for', 'and', 'or',
  'what', 'how', 'much', 'many', 'long', 'does', 'do', 'this', 'that', 'please',
]);

// Concept expansion. A contract states one thing under many names — the total
// is a "总价" or "TOTAL CONTRACT VALUE", never the "金额" the reader typed — so a
// question that only matched the reader's word would miss the page that holds
// the answer. This was not hypothetical: "合同金额是多少" retrieved only the
// installment pages (which repeat 金额) and skipped page 1's "TOTAL CONTRACT
// VALUE: EUR 1,546,500.00", and the model then reported the 70% installment as
// the total. When any trigger appears in the question, its group's terms are
// added to the search set. Synonyms that appear nowhere cost nothing (they score
// zero); the win is the one page they do match.
const EXPAND = [
  { triggers: ['金额', '价格', '价款', '总价', '总额', '合同价', '多少钱', '价值', '货款', '单价', 'amount', 'price', 'value', 'cost'],
    add: ['总价', '总额', '金额', '价款', '价值', '合同价', '单价', 'total', 'amount', 'value', 'contract value', 'contract price'] },
  { triggers: ['质保', '保修', '保质', '质量保证', 'warranty', 'guarantee'],
    add: ['质保', '保修', '保证期', 'warranty', 'guarantee'] },
  { triggers: ['付款', '支付', '款项', '结算', 'payment', 'pay'],
    add: ['付款', '支付', 'payment', 'terms of payment'] },
  { triggers: ['交货', '交付', '货期', '交期', 'delivery', 'deliver', 'lead time'],
    add: ['交货', '交付', 'delivery', 'shipment'] },
  // Equipment / model. A "what machine / model / type was sold" question rarely
  // shares words with the page that names it: contracts write "HERKULES HEAVY
  // DUTY ROLL GRINDER, Model WS 180 CNC", not "machine type". Without this, the
  // model page is never retrieved and the answer is "not found".
  { triggers: ['machine', 'equipment', 'model', 'grinder', 'grinding', '设备', '机床', '机型', '型号', '磨床', '规格', '几台', '什么型号', '哪些设备'],
    add: ['grinder', 'grinding', 'model', 'machine', 'cnc', 'roll grinder', 'polishing', '磨床', '机床', '设备', '型号', '规格'] },
];

// Break a question into search terms. CJK runs become overlapping bigrams (Chinese
// has no spaces, and a bigram like "质保" matches "质保期" / "质保金" alike);
// latin words and bare numbers are kept whole. Everything is lower-cased and the
// stopwords above are dropped. Then any concept whose trigger appears is expanded
// (see EXPAND) so a page using a synonym of the reader's word is still found.
export function extractTerms(question) {
  const terms = new Set();
  const q = String(question || '').toLowerCase();
  // Latin words (3+ letters) and standalone numbers.
  for (const m of q.matchAll(/[a-z]{3,}|\d[\d.,]*\d|\d/g)) {
    if (!STOP.has(m[0])) terms.add(m[0]);
  }
  // CJK runs → bigrams (plus the single char when a run is length 1).
  for (const run of q.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) { if (!STOP.has(run)) terms.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP.has(bg)) terms.add(bg);
    }
  }
  // Concept expansion: raw-question substring match, so multi-char triggers like
  // "合同价" fire even though bigramming would have split them.
  for (const grp of EXPAND) {
    if (grp.triggers.some((t) => q.includes(t))) {
      for (const a of grp.add) terms.add(a.toLowerCase());
    }
  }
  return [...terms];
}

// A short window of page text around the first matched term, so the UI can show
// why a page was cited without shipping the whole transcription.
export function snippetAround(text, terms) {
  const hay = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = hay.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return text.slice(0, 120).trim();
  const start = Math.max(0, at - 40);
  return (start > 0 ? '…' : '') + text.slice(start, at + 120).trim() + (at + 120 < text.length ? '…' : '');
}

// Definition boost. Keyword frequency can find the pages that *mention* a
// concept but not the one page that *states its value*: in one contract "合同总价"
// appears on a dozen pages ("合同总价的80%…") while the actual figure ("合同总价为
// CIF … 3,067,000 欧元") sits on exactly one. Without this, an amount question
// retrieves the installment pages and the model reports the 80% figure as the
// total. When the question is about a concept below and a page carries its
// "here is the value" phrasing, that page is pushed to the front.
const DEFINE_BOOST = [
  { triggers: ['金额', '价格', '价款', '总价', '总额', '合同价', '多少钱', '价值', '货款', 'amount', 'price', 'value', 'cost'],
    // The page that STATES the figure, not the ones that reference it. Chinese
    // stays narrow (a colon or 为 right after the phrase) because "合同总价" recurs
    // on every installment page ("合同总价的80%"). English is broader: contracts
    // phrase the total as "The total price … amounts to: EURO X" or "TOTAL
    // CONTRACT VALUE: EUR X", so "total price/value/amount" and "amounts to
    // <currency>" both qualify. Installment pages may also match, but they land
    // beside the stating page, not instead of it, and the prompt tells the model
    // to report the stated total rather than an installment.
    pattern: /(?:合同总价|合同价格|合同价款|总价|总额)\s*[为：:]|(?:total\s+(?:contract\s+)?(?:price|value|amount)|amounts?\s+to)\b[^。\n]{0,60}(?:eur|euro|usd|rmb|cny|€|\$|欧元|美元)\s*[\d.,]{4,}/i,
    bonus: 60 },
];

// Score pages against the question and return the top ones, capped per file so a
// long appendix can't crowd out the page that holds the answer.
//
// pages: [{ pageNo, text, fileId, filename, storedName }]
// returns: { pages: [{ fileId, filename, storedName, pageNo, snippet }], terms }
export function rankPages(pages, question, { maxPages = 5, maxPerFile = 3 } = {}) {
  const terms = extractTerms(question);
  if (!terms.length || !pages.length) return { pages: [], terms };
  const q = String(question || '').toLowerCase();
  const boosts = DEFINE_BOOST.filter((b) => b.triggers.some((t) => q.includes(t)));

  const scored = pages.map((p) => {
    const hay = String(p.text || '').toLowerCase();
    let score = 0;
    let distinct = 0;
    for (const t of terms) {
      // Count occurrences, capped so one page repeating a term does not swamp a
      // page that holds several different ones.
      let n = 0;
      let from = 0;
      while (n < 5) {
        const at = hay.indexOf(t, from);
        if (at === -1) break;
        n += 1;
        from = at + t.length;
      }
      if (n > 0) { score += n; distinct += 1; }
    }
    // Matching several distinct terms is a stronger signal than one term many
    // times, so weight breadth over depth.
    let total = score + distinct * 3;
    // The page that states the value, not merely references it, jumps the queue —
    // but only if it already matched the question at all, so an unrelated page
    // carrying the phrase is not dragged in.
    if (total > 0) {
      for (const b of boosts) { if (b.pattern.test(p.text || '')) { total += b.bonus; break; } }
    }
    return { p, score: total };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score || a.p.pageNo - b.p.pageNo);

  const perFile = new Map();
  const chosen = [];
  for (const s of scored) {
    const used = perFile.get(s.p.fileId) || 0;
    if (used >= maxPerFile) continue;
    perFile.set(s.p.fileId, used + 1);
    chosen.push({
      fileId: s.p.fileId,
      filename: s.p.filename,
      storedName: s.p.storedName,
      pageNo: s.p.pageNo,
      snippet: snippetAround(String(s.p.text || ''), terms),
    });
    if (chosen.length >= maxPages) break;
  }
  return { pages: chosen, terms };
}

// ── Semantic ranking ─────────────────────────────────────────────────────────
// Cosine similarity between two equal-length vectors.
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

// Rank pages by cosine similarity to the question vector. Pages without a vector
// are skipped (they fall to the keyword path). Same output shape and per-file
// cap as rankPages, so the two can be unioned.
//
// pages: [{ pageNo, text, fileId, filename, storedName, embedding }]
export function rankByVector(pages, qVec, { maxPages = 6, maxPerFile = 3 } = {}) {
  if (!qVec || !qVec.length) return [];
  const scored = pages
    .filter((p) => Array.isArray(p.embedding) && p.embedding.length)
    .map((p) => ({ p, score: cosine(qVec, p.embedding) }))
    .sort((a, b) => b.score - a.score);

  const perFile = new Map();
  const chosen = [];
  for (const s of scored) {
    const used = perFile.get(s.p.fileId) || 0;
    if (used >= maxPerFile) continue;
    perFile.set(s.p.fileId, used + 1);
    chosen.push({
      fileId: s.p.fileId,
      filename: s.p.filename,
      storedName: s.p.storedName,
      pageNo: s.p.pageNo,
      score: s.score,
      snippet: String(s.p.text || '').slice(0, 160).trim(),
    });
    if (chosen.length >= maxPages) break;
  }
  return chosen;
}

// Hybrid: union the vector hits and the keyword hits, vector first (it has the
// better recall), keyword close behind (it catches the page that STATES a value
// via the definition boost). Deduped by page. This is what Q&A retrieval uses
// when embeddings are available; with none it is just the keyword result.
export function rankHybrid(pages, question, qVec, { maxPages = 8, maxPerFile = 3 } = {}) {
  const vec = rankByVector(pages, qVec, { maxPages, maxPerFile });
  const { pages: kw, terms } = rankPages(pages, question, { maxPages, maxPerFile });
  const seen = new Set();
  const merged = [];
  // Interleave so neither method is starved: take from vector and keyword in
  // turn until the budget fills.
  for (let i = 0; i < Math.max(vec.length, kw.length) && merged.length < maxPages; i++) {
    for (const list of [vec, kw]) {
      const p = list[i];
      if (!p) continue;
      const key = `${p.fileId}:${p.pageNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
      if (merged.length >= maxPages) break;
    }
  }
  return { pages: merged, terms, usedVector: vec.length > 0 };
}
