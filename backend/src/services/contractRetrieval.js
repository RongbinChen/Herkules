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
    // Deliberately narrow: the phrasing that STATES the figure ("合同总价为：CIF
    // … 3,067,000 欧元", "TOTAL CONTRACT VALUE: EUR 1,546,500"), not the phrasing
    // that references it ("合同总价的80%", "total contract value shall be paid").
    // The discriminator is a colon or 为 straight after the phrase — a reference
    // uses 的 or "shall".
    pattern: /合同总价\s*[为：:]|合同价格\s*[为：:]|总价\s*为|total\s+contract\s+(price|value)\s*[：:]/i,
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
