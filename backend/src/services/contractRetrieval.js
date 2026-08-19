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

// Break a question into search terms. CJK runs become overlapping bigrams (Chinese
// has no spaces, and a bigram like "质保" matches "质保期" / "质保金" alike);
// latin words and bare numbers are kept whole. Everything is lower-cased and the
// stopwords above are dropped.
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

// Score pages against the question and return the top ones, capped per file so a
// long appendix can't crowd out the page that holds the answer.
//
// pages: [{ pageNo, text, fileId, filename, storedName }]
// returns: { pages: [{ fileId, filename, storedName, pageNo, snippet }], terms }
export function rankPages(pages, question, { maxPages = 5, maxPerFile = 3 } = {}) {
  const terms = extractTerms(question);
  if (!terms.length || !pages.length) return { pages: [], terms };

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
    return { p, score: score + distinct * 3 };
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
