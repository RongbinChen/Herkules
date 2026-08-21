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
const TOPICS = [
  { key: 'amount', q: '合同金额 总价 总额 total contract value contract price' },
  { key: 'payment', q: '付款条件 支付 terms of payment' },
  { key: 'delivery', q: '交货期 交货 交付 delivery time shipment' },
  { key: 'warranty', q: '质保期 质量保证期 保证期 warranty period guarantee period' },
  { key: 'parties', q: '买方 卖方 buyer seller 合同号 contract no' },
  { key: 'komNo', q: 'kom nr kom no 委托号 机器号' },
];
// Pages to take per topic. Two, because the clause and the figure it refers to
// are often on facing pages.
const PER_TOPIC = Number(process.env.CONTRACT_SUMMARY_PER_TOPIC || 2);

export const SUMMARY_FIELDS = [
  { key: 'contractNo', label: '合同号' },
  { key: 'buyer', label: '买方' },
  { key: 'seller', label: '卖方' },
  { key: 'amount', label: '合同金额' },
  { key: 'payment', label: '付款条件' },
  { key: 'delivery', label: '交货期' },
  { key: 'warranty', label: '质保期' },
  { key: 'komNo', label: 'Kom. No.' },
];

// "Not in these pages" has to be a value the model can pick, or it invents one.
const NONE = '—';
// The worker's own ask prompt tells the model to say "未在提供的页面中找到" when
// a fact is absent, and that instruction reaches the model alongside this one.
// Rather than have the two prompts argue, the answer is normalised here — any
// phrasing of "I could not find it" becomes the same empty marker.
const ABSENT = /^(—|-|无|未找到|没有找到|未提及|未注明|未在.*找到|not (found|specified|mentioned)|n\/?a)[。.\s]*$/i;

export function summaryPrompt() {
  return `请把这份合同的关键信息按下面固定的格式列出来，一行一项，顺序不要变，除这几行外不要输出别的内容：

${SUMMARY_FIELDS.map((f) => `${f.label}: <值> ｜ 出处: <第N页>`).join('\n')}

规则：
- 提供的页面里找不到的项，值和出处都写 ${NONE}，不要猜。
- 合同金额照抄币种和数字原样，不要换算、不要四舍五入。
- 付款条件压缩成一行，例如"20% 预付 / 70% 装运 / 10% 验收"。
- 买方卖方写公司全称。
- Kom. No. 是卖方内部的机器委托号，形如 30-0004 或 98950，通常跟在 "Kom. No." /
  "Kom. Nr." 后面。它不是合同号——页面上没有单独写出 Kom. No. 就填 ${NONE}，
  不要拿合同号顶替。
- 出处只写页码。`;
}

// Lenient on purpose. The model is told to emit exactly these lines, but a
// stray bullet, a bolded label or a full-width colon should not cost the whole
// summary — an unparsed line falls through and the raw text is kept alongside.
export function parseSummary(answer) {
  const lines = String(answer || '').split('\n');
  const fields = SUMMARY_FIELDS.map((f) => ({ ...f, value: NONE, source: null }));

  for (const line of lines) {
    // Drop list markers and markdown emphasis before matching the label.
    const clean = line.replace(/^\s*[-*•]\s*/, '').replace(/\*\*/g, '').trim();
    if (!clean) continue;
    const field = fields.find((f) => {
      const head = clean.slice(0, f.label.length + 2).toLowerCase();
      return head.startsWith(f.label.toLowerCase());
    });
    if (!field) continue;

    let rest = clean.slice(clean.indexOf(field.label) + field.label.length).replace(/^\s*[:：]\s*/, '');
    // The source rides after a pipe; both widths appear in practice.
    const [value, ...srcParts] = rest.split(/[｜|]/);
    const src = srcParts.join(' ').replace(/^\s*出处\s*[:：]?\s*/, '').trim();
    const v = value.trim();
    field.value = !v || ABSENT.test(v) ? NONE : v;
    field.source = src && !ABSENT.test(src) && field.value !== NONE ? src : null;
  }
  return fields;
}

// Choose the pages to send from a file's pages, already loaded.
//
// Two ceilings, because either one alone leaks. Pages guard the model's
// attention; characters guard its context window — ten dense pages of a
// bilingual contract run past what num_ctx holds, and an overflowing prompt is
// silently truncated at the far end, which is where the answer was.
export function pickSummaryPages(pages) {
  if (!pages.length) return [];
  const byNo = new Map(pages.map((p) => [p.pageNo, p]));

  // Lead pages first so that if the character budget runs out, what survives is
  // the contract head — the one region that carries several fields at once.
  const picked = new Map();
  for (const p of pages.slice(0, LEAD_PAGES)) picked.set(p.pageNo, p);
  for (const topic of TOPICS) {
    const { pages: seeds } = rankPages(pages, topic.q, {
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
