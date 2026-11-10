// Pure date math and clause reading for a follow-up's execution timeline.
//
// Two inputs, one shape out. The fast path reads the key-terms summary the
// contracts module already cached (payment / delivery / warranty / signed
// date) — English prose, because that is what the summariser is told to write.
// The slow path reads a fixed line format from a focused DGX ask over the
// payment, letter-of-credit and delivery pages. Both become the same clause
// list, and only then are relative phrases ("within 15 days of signing",
// "12 months after effective") turned into calendar dates.
//
// Nothing here touches the database or the GPU, so the date arithmetic can be
// tested without either. contractTimeline.js does the I/O.
import { rankPages } from './contractRetrieval.js';

// Same order as MILESTONES in followUps.js and as the Prisma enum. A test
// checks the three stay in step — a kind the parser can emit that the
// follow-up cannot store would 400 on apply.
export const TIMELINE_KINDS = [
  'CONTRACT_SIGNED',
  'CONTRACT_EFFECTIVE',
  'LC_OPEN_DEADLINE',
  'LC_RECEIVED',
  'LC_LATEST_SHIPMENT',
  'LC_PRESENTATION',
  'PAYMENT_DOWN',
  'PAYMENT_SHIPMENT',
  'PAYMENT_FINAL',
  'GUARANTEE_EXPIRY',
  'DRAWING_APPROVAL',
  'FAT',
  'SHIPMENT',
  'INSTALLATION',
  'FAC',
  'WARRANTY_EXPIRY',
];

const KIND_SET = new Set(TIMELINE_KINDS);

// What a relative phrase may be counted from. The DGX line format uses these
// tokens; the prose parser maps "signing", "验收证书", "装运" onto the same set.
const BASES = new Set([
  'SIGNED', 'EFFECTIVE', 'SHIPMENT', 'FAT', 'FAC', 'INSTALLATION', 'PAYMENT_DOWN', 'LC_OPEN',
  'LC_RECEIVED',
]);

const BASE_TO_KIND = {
  SIGNED: 'CONTRACT_SIGNED',
  EFFECTIVE: 'CONTRACT_EFFECTIVE',
  SHIPMENT: 'SHIPMENT',
  FAT: 'FAT',
  FAC: 'FAC',
  INSTALLATION: 'INSTALLATION',
  PAYMENT_DOWN: 'PAYMENT_DOWN',
  LC_OPEN: 'LC_OPEN_DEADLINE',
  LC_RECEIVED: 'LC_RECEIVED',
  CONTRACT_SIGNED: 'CONTRACT_SIGNED',
  CONTRACT_EFFECTIVE: 'CONTRACT_EFFECTIVE',
  LC_OPEN_DEADLINE: 'LC_OPEN_DEADLINE',
};

// Letter-of-credit dates are commercial terms. A technical agreement describes
// the machine; it does not say when the credit must arrive or the last day it
// may be shipped against. Kept out of a technical file's ask, and dropped if a
// cached answer still contains them.
export const COMMERCIAL_LC_KINDS = new Set([
  'LC_OPEN_DEADLINE', 'LC_RECEIVED', 'LC_LATEST_SHIPMENT', 'LC_PRESENTATION',
]);

// These two are only useful when the commercial text states a real number or a
// calendar date. A line that says "within N days" is the model leaving the
// blank in, not a clause, and the milestone row already accepts a typed date.
const LC_NEEDS_CONCRETE = new Set(['LC_RECEIVED', 'LC_LATEST_SHIPMENT']);

// 交货期起算 is not one company-wide rule. A commercial contract either counts
// delivery from the signing date or from receipt of the down payment (often by
// saying the contract becomes effective at that receipt). Anything else is
// not a start we are allowed to guess.
export const DELIVERY_STARTS = new Set(['SIGNED', 'PAYMENT_DOWN']);

// Bumped when the line format or the prose reader changes what a stored answer
// means. A mismatch re-asks (or re-reads the stored raw, when the prompt is
// unchanged). See contractTimeline.js.
// Bumped when the reader learns a new base (LC_RECEIVED). A stored answer is
// re-parsed from its raw text and not re-asked. The prompt version stays put
// on purpose: letter-of-credit lines cached from a technical file are dropped
// when the timeline is assembled, so re-asking every contract would spend the
// GPU to learn dates the commercial text already holds. See contractTimeline.js.
export const TIMELINE_VERSION = 2;
export const TIMELINE_PROMPT_VERSION = 1;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// More specific patterns first. On a distance tie the earlier rule wins, which
// is what stops "signing the acceptance certificate" being read as the date of
// signature — that phrase is the acceptance, and the warranty is counted from it.
const BASE_RULES = [
  ['FAC', /signing the acceptance|acceptance certificate|签署验收|验收证书|终验收|最终验收|final acceptance|(?<!factory\s)\bacceptance\b|(?<!出厂)验收合格|验收后|验收时|验收款|\bfac\b/gi],
  ['FAT', /factory acceptance|\bfat\b|出厂验收|预验收/gi],
  ['INSTALLATION', /commissioning|installation|安装调试|安装|调试/gi],
  // Receipt of the credit, before the generic "shipment" / "装运" rule, so
  // "90 days after the letter of credit is received" is not read as 90 days
  // after shipment. Distance still decides; this order is only the tie-break.
  ['LC_RECEIVED', /receipt of (?:the )?(?:l\/?c|letter of credit)|(?:l\/?c|letter of credit) (?:is |was |being )?received|信用证收到|收到信用证|信用证送达|信用证到达/gi],
  ['SHIPMENT', /shipping documents|bill of lading|\bb\/?l\b|shipment|delivery|装运|发货|交货|到港/gi],
  ['PAYMENT_DOWN', /down payment|prepayment|advance payment|\badvance\b|\bdeposit\b|预付款|定金|订金|首付/gi],
  ['EFFECTIVE', /effectiveness|\beffective\b|生效/gi],
  ['LC_OPEN', /开证|开立|opening deadline|opening of the (?:l\/?c|letter of credit)|(?:l\/?c|letter of credit) (?:is |was )?opened/gi],
  // "signing the acceptance" is excluded — see FAC. 签署验收 likewise.
  ['SIGNED', /signing(?!\s+the\s+acceptance)|signature|(?<![a-z])signed\b|合同签订|签订|签署(?!验收)/gi],
];

const LEAD_PAGES = 2;
const MAX_SENT_PAGES = 8;
const MAX_SENT_CHARS = 20000;
const PER_TOPIC = 2;

const TIMELINE_TOPICS = [
  '付款条件 支付 预付款 信用证 开证 letter of credit terms of payment',
  '交货期 交货 装运 最晚装运 delivery time shipment',
  '质保期 验收 出厂验收 终验收 warranty acceptance FAT FAC',
  '签订日期 合同生效 date of signature effective',
  '图纸确认 drawings approval',
  '保函 bank guarantee performance bond',
];

export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

// A real calendar day, not "2026-02-31" and not a datetime. Apply refuses
// anything else so a proposal cannot write a reminder onto a nonsense date.
export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const parsed = parseDate(s);
  return parsed?.date === s && !parsed.monthOnly;
}

function pad(n) { return String(n).padStart(2, '0'); }

function ymd(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function asDate(date, monthOnly = false) {
  return date ? { date, monthOnly } : null;
}

function monthEnd(y, m) {
  const year = Number(y);
  const month = Number(m);
  if (month < 1 || month > 12) return null;
  const dt = new Date(Date.UTC(year, month, 0));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// The first date a contract phrase actually states. A month with no day
// ("delivery in March 2027") is the end of that month — a delivery window is a
// deadline, and the last day is the one that is not yet late. Dotted numeric
// dates are read day-month-year: these contracts are German or Chinese, and
// 03.04.2026 means 3 April. A number over 12 on either side breaks the tie.
export function parseDate(text) {
  const s = String(text || '');
  let m = /(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/.exec(s);
  if (m) {
    if (m[3]) return asDate(ymd(m[1], m[2], m[3]));
    return asDate(monthEnd(m[1], m[2]), true);
  }
  m = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(s);
  if (m) return asDate(ymd(m[1], m[2], m[3]));

  m = /(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return asDate(ymd(m[3], MONTHS[m[2].toLowerCase()], m[1]));

  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return asDate(ymd(m[3], MONTHS[m[1].toLowerCase()], m[2]));

  m = /\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return asDate(monthEnd(m[2], MONTHS[m[1].toLowerCase()]), true);

  m = /(?:^|[^\d])(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[^\d]|$)/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) return asDate(ymd(m[3], b, a));
    if (b > 12 && a <= 12) return asDate(ymd(m[3], a, b));
    if (a <= 12 && b <= 12) return asDate(ymd(m[3], b, a));
  }
  return null;
}

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = (m - 1) + n;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return ymd(year, month + 1, Math.min(d, dim));
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function shift(iso, offset) {
  const sign = offset.dir === 'before' ? -1 : 1;
  if (offset.unit === 'months') return addMonths(iso, sign * offset.n);
  return addDays(iso, sign * offset.n);
}

export function clipNote(s, n = 180) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t || t === '—' || t === '-' || t === '–') return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// Milestone notes are readable by every logged-in user, not only the team that
// unlocked the contract. A timing clause is useful; the price figure inside it
// is the contract value, which the follow-up already stores behind the team
// check. Percentages stay — "20% within 15 days" is not the price.
export function redactMoney(text) {
  if (!text) return text;
  return String(text)
    .replace(/(?:€|\$|¥)\s?\d[\d.,]*/g, '[value]')
    .replace(/\b(?:EUR|USD|RMB|CNY|GBP|JPY|EURO|EUROS)\b\s*\d[\d.,]*/gi, '[value]')
    .replace(/\d[\d.,]*\s*(?:€|\$|¥|\b(?:EUR|USD|RMB|CNY|EURO|EUROS)\b)/gi, '[value]')
    .replace(/(?:欧元|美元|人民币)\s*\d[\d.,]*/g, '[value]');
}

export function redactProposalNotes(proposals) {
  return (proposals || []).map((p) => (
    p?.notes ? { ...p, notes: clipNote(redactMoney(p.notes)) } : p
  ));
}

function blankValue(v) {
  const s = String(v ?? '').trim();
  return !s || s === '—' || s === '-' || s === '–' || /^n\/?a$/i.test(s) || /^not (found|specified|mentioned|stated|given)/i.test(s);
}

function stripDates(text) {
  return String(text || '')
    .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/\d{4}\s*年\s*\d{1,2}\s*月/g, ' ')
    .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, ' ')
    .replace(/\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}/gi, ' ')
    .replace(/[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi, ' ')
    .replace(/(?:^|[^\d])\d{1,2}[./]\d{1,2}[./]\d{4}(?=[^\d]|$)/g, ' ');
}

// Closest base word to `pivot`. Used on a slice, so the pivot is 0 when the
// slice starts at the number (English: the base follows "after" / "before")
// and the slice length when the slice ends at the number (Chinese: "签订后15日").
function nearestBaseIn(text, pivot) {
  if (!text) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [base, re] of BASE_RULES) {
    const r = new RegExp(re.source, 'gi');
    let m;
    while ((m = r.exec(text))) {
      const dist = Math.abs(m.index - pivot);
      if (dist < bestDist) {
        bestDist = dist;
        best = base;
      }
      if (m.index === r.lastIndex) r.lastIndex += 1;
    }
  }
  return best;
}

// The words after the number are the clock ("15 days after signing",
// "14 days before shipment"). The milestone's own name often sits in front
// ("FAT 14 days before shipment") and must not win just because it is closer
// to the digit. Chinese writes the base first ("签订后15日"), so that side
// is the fallback when nothing after the number is a base.
function baseForNumber(text, numberIndex, numberLen) {
  // Chinese writes the base in front of the number: "签订后30日内开立" — the
  // 开立 after the number is the verb (the L/C is what gets opened), not the
  // clock. When 前/后 is glued to the number, the base is whatever that
  // particle is attached to.
  const prefix = text.slice(Math.max(0, numberIndex - 16), numberIndex);
  if (/[前后]\s*$/.test(prefix)) {
    const from = Math.max(0, numberIndex - 24);
    const before = text.slice(from, numberIndex).replace(/[前后]\s*$/, '');
    const glued = nearestBaseIn(before, before.length);
    if (glued) return glued;
  }
  const after = text.slice(numberIndex + numberLen, numberIndex + numberLen + 56);
  const afterBase = nearestBaseIn(after, 0);
  if (afterBase) return afterBase;
  const from = Math.max(0, numberIndex - 32);
  const before = text.slice(from, numberIndex);
  return nearestBaseIn(before, before.length);
}

function directionNear(text, index) {
  const prefix = text.slice(Math.max(0, index - 3), index);
  if (/前\s*$/.test(prefix)) return 'before';
  if (/后\s*$/.test(prefix)) return 'after';
  const window = text.slice(Math.max(0, index - 12), index + 24);
  if (/before|prior/i.test(window)) return 'before';
  return 'after';
}

function parseRelative(text) {
  const re = /(\d+)\s*(?:working\s+|calendar\s+)?(days?|weeks?|months?|years?|个?月|日|天)/gi;
  let m;
  while ((m = re.exec(text))) {
    const word = m[2].toLowerCase();
    let n = Number(m[1]);
    let unit = 'days';
    if (/year/.test(word)) { unit = 'months'; n *= 12; }
    else if (/month|月/.test(word)) unit = 'months';
    else if (/week/.test(word)) { unit = 'days'; n *= 7; }
    if (!n) continue;
    const base = baseForNumber(text, m.index, m[0].length);
    if (!base) continue;
    return { offset: { n, unit, dir: directionNear(text, m.index), base } };
  }
  return null;
}

function parseAnchor(text) {
  const prep = /(?:on|upon|at|against|before|prior to)\s+(?:the\s+)?(?:date\s+of\s+)?/i.exec(text);
  if (prep) {
    const base = nearestBaseIn(text.slice(prep.index + prep[0].length, prep.index + prep[0].length + 40), 0);
    if (base) return { anchor: base };
  }
  if (/发货前|发货时|装运前|装运时|验收后|验收时|签订时|签署时|预付款到账/.test(text)) {
    const base = nearestBaseIn(text, 0);
    if (base) return { anchor: base };
  }
  return null;
}

function splitSentences(text) {
  return String(text || '')
    .split(/\n|;|；|。|\.\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A full calendar date wins over a relative phrase only when there is no
// relative phrase. "within 15 days of signing, i.e. by 30 March 2026" keeps
// the rule (the date is the contract doing the arithmetic for one signing
// date). A bare "by 30 March 2027" is absolute.
export function parseTiming(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const rel = parseRelative(stripDates(raw));
  if (rel) return rel;
  const date = parseDate(raw);
  if (date?.date) return { absolute: date.date };
  return parseAnchor(raw);
}

function spreadTiming(t) {
  if (!t) return {};
  if (t.absolute) return { absolute: t.absolute };
  if (t.offset) return { offset: t.offset };
  if (t.anchor) return { anchor: t.anchor };
  return {};
}

function baseOf(timing) {
  if (!timing) return null;
  return timing.offset?.base || timing.anchor || null;
}

function circular(kind, timing) {
  const b = baseOf(timing);
  if (!b) return false;
  return (BASE_TO_KIND[b] || b) === kind;
}

function splitPayment(text) {
  const protectedText = String(text || '').replace(/L\/C/gi, 'LC');
  return protectedText
    .split(/\s*(?:\/|;|；|、|\+)\s*|\s*,\s*(?=\d+\s*%|advance|down|final|balance|lc\b|letter)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function kindsInPayment(seg) {
  const s = seg.toLowerCase();
  const kinds = [];
  const isLc = /信用证|开证|\blc\b|letter of credit/.test(s);
  const isDown = /预付款|定金|订金|首付|advance|down payment|prepayment|deposit/.test(s);
  const isFinal = /尾款|质保金|验收款|final payment|retention|balance payment|on acceptance|upon acceptance|after acceptance|final acceptance/.test(s);
  const isShipPay = /发货款|shipment payment|before shipment|on shipment|upon shipment|against shipment|prior to shipment|on delivery|before delivery|shipping documents/.test(s);
  if (isDown) kinds.push('PAYMENT_DOWN');
  if (isFinal) kinds.push('PAYMENT_FINAL');
  if (isShipPay) kinds.push('PAYMENT_SHIPMENT');
  if (isLc) {
    if (/open|opened|opening|开立|开证|within|日内|天内/.test(s) || !isShipPay) kinds.push('LC_OPEN_DEADLINE');
    if (/shipping documents|shipment|装运|发货/.test(s) && !kinds.includes('PAYMENT_SHIPMENT')) {
      kinds.push('PAYMENT_SHIPMENT');
    }
  }
  if (!kinds.length && /%/.test(seg) && /acceptance|\bfac\b|终验收|验收/.test(s)) kinds.push('PAYMENT_FINAL');
  if (!kinds.length && /%/.test(seg) && /shipment|delivery|发货|装运/.test(s)) kinds.push('PAYMENT_SHIPMENT');
  return kinds;
}

// One segment often states two milestones with different clocks: the L/C must
// be opened within 30 days of signing, and the money it pays moves on shipment.
// Giving both the opening offset would schedule the shipment payment a month
// after signature.
function timingForKind(kind, seg) {
  const timing = parseTiming(seg);
  if (kind === 'PAYMENT_SHIPMENT') {
    const openingClock = timing?.offset?.base === 'SIGNED' && /open|opened|opening|开证|开立/.test(seg);
    if (openingClock && /shipping documents|shipment|装运|发货/.test(seg.toLowerCase())) {
      return { anchor: 'SHIPMENT' };
    }
  }
  if (kind === 'PAYMENT_FINAL' && !timing && /acceptance|\bfac\b|验收/.test(seg.toLowerCase())) {
    return { anchor: 'FAC' };
  }
  return timing;
}

function clausesFromPayment(text) {
  if (blankValue(text)) return [];
  const out = [];
  for (const seg of splitPayment(text)) {
    const kinds = kindsInPayment(seg);
    for (const kind of kinds) {
      out.push({ kind, ...spreadTiming(timingForKind(kind, seg)), notes: clipNote(seg) });
    }
  }
  return out;
}

// A length with no clock ("delivery within 12 months"). parseRelative refuses
// that, because a payment with no base must not be invented as "on signing".
// Delivery is the one milestone whose missing clock is a question for the
// reader rather than a clause to drop: the length is real, the start is not.
function parseDuration(text) {
  const re = /(\d+)\s*(?:working\s+|calendar\s+)?(days?|weeks?|months?|years?|个?月|日|天)/gi;
  const m = re.exec(text);
  if (!m) return null;
  const word = m[2].toLowerCase();
  let n = Number(m[1]);
  let unit = 'days';
  if (/year/.test(word)) { unit = 'months'; n *= 12; }
  else if (/month|月/.test(word)) unit = 'months';
  else if (/week/.test(word)) { unit = 'days'; n *= 7; }
  if (!n) return null;
  return { n, unit, dir: directionNear(text, m.index) };
}

function clausesFromDelivery(text) {
  if (blankValue(text)) return [];
  // The first sentence that is actually about delivery. A leading "FAT 14 days
  // before shipment" is a different milestone and must not become the shipment
  // date, nor hide the delivery sentence that follows it.
  //
  // The clock has to be one this contract actually names. Signing, receipt of
  // the down payment, and effectiveness (which itself resolves to one of those
  // two, or stays open) are delivery-start rules. "After FAT" or a bare
  // "12 months" is not one of them — keep the length, leave the start blank,
  // and let the person choose. Guessing "from the signature" is how every
  // order was silently given the same 交货期起算.
  for (const part of splitSentences(text)) {
    // 最晚装运期 is the letter-of-credit milestone, not the delivery period.
    // Leaving it here would turn "90 days after the credit is received" into
    // an unknown 交货期起算 and ask the reader to invent one.
    if (/latest (?:date of )?shipment|最晚装运/i.test(part)) continue;
    const timing = parseTiming(part);
    if (timing?.absolute) {
      return [{ kind: 'SHIPMENT', absolute: timing.absolute, notes: clipNote(text) }];
    }
    if (timing && !circular('SHIPMENT', timing)) {
      const base = timing.offset?.base || timing.anchor || null;
      if (base === 'SIGNED' || base === 'PAYMENT_DOWN' || base === 'EFFECTIVE') {
        return [{ kind: 'SHIPMENT', ...spreadTiming(timing), notes: clipNote(text) }];
      }
      if (timing.offset) {
        return [{
          kind: 'SHIPMENT',
          offset: { ...timing.offset, base: null },
          unresolvedStart: true,
          notes: clipNote(text),
        }];
      }
    }
    if (!/deliver|shipment|交货|装运|发货/i.test(part)) continue;
    const dur = parseDuration(part);
    if (!dur) continue;
    return [{
      kind: 'SHIPMENT',
      offset: { ...dur, base: null },
      unresolvedStart: true,
      notes: clipNote(text),
    }];
  }
  return [];
}

function clausesFromWarranty(text) {
  if (blankValue(text)) return [];
  const timing = parseTiming(text);
  if (!timing || circular('WARRANTY_EXPIRY', timing)) return [];
  return [{ kind: 'WARRANTY_EXPIRY', ...spreadTiming(timing), notes: clipNote(text) }];
}

function segmentContaining(text, re) {
  const hit = splitSentences(text).find((p) => re.test(p));
  re.lastIndex = 0;
  return hit || text;
}

function effectiveClause(blob) {
  // "when the down payment arrives" is how these contracts say it, not only
  // "upon receipt of the down payment". Both mean the delivery period that is
  // counted from effectiveness starts when the money is in.
  if (/effective\s+(?:upon|on|after|when)\s+(?:the\s+)?(?:receipt\s+of\s+)?(?:the\s+)?(?:down payment|advance|deposit)|预付款(?:到账|支付).{0,12}生效|自预付款.{0,16}生效|定金到账后生效|定金到账/i.test(blob)) {
    return { kind: 'CONTRACT_EFFECTIVE', anchor: 'PAYMENT_DOWN', notes: clipNote('Effective when the down payment is received') };
  }
  if (/effective\s+(?:upon|on|from)\s+(?:the\s+)?sign|自签订之日起生效|签订后生效|签署之日生效/i.test(blob)) {
    return { kind: 'CONTRACT_EFFECTIVE', anchor: 'SIGNED', notes: clipNote('Effective on signing') };
  }
  return null;
}

const EXTRA_RULES = [
  ['DRAWING_APPROVAL', /drawings?|图纸|技术协议确认/i],
  ['GUARANTEE_EXPIRY', /bank guarantee|performance bond|保函/i],
  ['FAT', /\bfat\b|factory acceptance|出厂验收/i],
  ['INSTALLATION', /installation|commissioning|安装调试/i],
  ['LC_PRESENTATION', /document presentation|presentation of documents|presented within|交单/i],
  ['LC_LATEST_SHIPMENT', /latest (?:date of )?shipment|最晚装运/i],
  ['LC_RECEIVED', /l\/?c (?:is |was |be |been |shall be |must be |to be )?received|letter of credit (?:is |was |shall be |must be |to be )?received|信用证收到|收到信用证|信用证(?:送达|到达)/i],
];

function extraClauses(blob) {
  if (!blob) return [];
  const out = [];
  for (const [kind, re] of EXTRA_RULES) {
    if (!re.test(blob)) continue;
    const seg = segmentContaining(blob, new RegExp(re.source, re.flags));
    const timing = parseTiming(seg);
    if (!timing || circular(kind, timing)) continue;
    out.push({ kind, ...spreadTiming(timing), notes: clipNote(seg) });
  }
  return out;
}

function specificity(c) {
  if (c?.absolute) return 3;
  if (c?.offset) return 2;
  if (c?.anchor) return 1;
  return 0;
}

function joinNotes(a, b) {
  const parts = [a, b].filter(Boolean);
  if (parts.length < 2) return parts[0] || null;
  if (parts[0].includes(parts[1])) return clipNote(parts[0]);
  if (parts[1].includes(parts[0])) return clipNote(parts[1]);
  return clipNote(parts.join(' · '));
}

export function mergeClauses(clauses) {
  const byKind = new Map();
  for (const c of clauses || []) {
    if (!c?.kind || !KIND_SET.has(c.kind)) continue;
    const prev = byKind.get(c.kind);
    if (!prev) { byKind.set(c.kind, c); continue; }
    const sa = specificity(prev);
    const sb = specificity(c);
    let winner = prev;
    let loser = c;
    // The delivery period is a commercial term. A technical agreement can still
    // supply installation, FAT and a shipment date of its own when the
    // commercial contract is silent — but it must not outrank a commercial
    // delivery clause just because the technical file stated a calendar day.
    const commercialShipment = (a, b) => a?.kind === 'SHIPMENT'
      && a.docType === 'COMMERCIAL'
      && b?.docType !== 'COMMERCIAL'
      && (a.absolute || a.offset || a.anchor || a.unresolvedStart);
    if (commercialShipment(c, prev)) { winner = c; loser = prev; }
    else if (commercialShipment(prev, c)) { winner = prev; loser = c; }
    else if (sb > sa) { winner = c; loser = prev; }
    else if (sb === sa) {
      const prevCom = prev.docType === 'COMMERCIAL' ? 1 : 0;
      const nextCom = c.docType === 'COMMERCIAL' ? 1 : 0;
      if (nextCom > prevCom) { winner = c; loser = prev; }
    }
    const notes = winner.kind === 'SHIPMENT' && winner.docType !== loser.docType
      ? winner.notes
      : joinNotes(winner.notes, loser.notes);
    byKind.set(c.kind, { ...winner, notes });
  }
  return [...byKind.values()];
}

function fieldMap(fields) {
  const out = {};
  for (const f of fields || []) {
    if (!f?.key || blankValue(f.value)) continue;
    out[f.key] = String(f.value).trim();
  }
  return out;
}

// Summary fields → clauses, before any date is computed. `fields` is the
// cached summary shape: [{ key, value }].
export function timelineFromSummary(fields) {
  const byKey = fieldMap(fields);
  const clauses = [];
  const signed = byKey.signedDate ? parseDate(byKey.signedDate) : null;
  // A month with no day is not a signature date — counting twelve months from
  // "March" would silently pick the 31st. Leave the base unset instead.
  if (signed?.date && !signed.monthOnly) {
    clauses.push({ kind: 'CONTRACT_SIGNED', absolute: signed.date, notes: clipNote(byKey.signedDate) });
  }
  clauses.push(...clausesFromPayment(byKey.payment));
  clauses.push(...clausesFromDelivery(byKey.delivery));
  clauses.push(...clausesFromWarranty(byKey.warranty));
  const blob = [byKey.payment, byKey.delivery, byKey.warranty].filter(Boolean).join('\n');
  const eff = effectiveClause(blob);
  if (eff) clauses.push(eff);
  clauses.push(...extraClauses(blob));
  return mergeClauses(clauses);
}

// The summary already states a clock we can start. One dated execution
// milestone anchored on the signature (or an absolute date) is enough to skip
// a second GPU read. A relative phrase whose base we do not have is not
// enough — the pages may still hold the missing date.
export function summaryTimelineEnough(clauses) {
  const signed = (clauses || []).some((c) => c.kind === 'CONTRACT_SIGNED' && c.absolute);
  const executable = (clauses || []).filter((c) => c.kind !== 'CONTRACT_SIGNED' && (c.absolute || c.offset || c.anchor));
  const resolvable = executable.filter((c) => {
    if (c.absolute) return true;
    const b = c.offset?.base || c.anchor;
    return signed && (b === 'SIGNED' || b === 'CONTRACT_SIGNED');
  });
  return resolvable.length >= 1;
}

function parseWhen(when) {
  const w = String(when || '').trim();
  if (!w || /^[—\-–]$/.test(w) || /^n\/?a$/i.test(w)) return {};
  const on = /^on\s+([A-Za-z_]+)$/i.exec(w);
  if (on) {
    const base = on[1].toUpperCase();
    if (BASES.has(base) || BASE_TO_KIND[base]) return { anchor: BASES.has(base) ? base : base };
  }
  const rel = /^(\d+)\s*(day|days|week|weeks|month|months|year|years)\s+(after|before)\s+([A-Za-z_]+)$/i.exec(w);
  if (rel) {
    const base = rel[4].toUpperCase();
    if (BASES.has(base) || BASE_TO_KIND[base]) {
      let n = Number(rel[1]);
      let unit = 'days';
      if (/year/i.test(rel[2])) { unit = 'months'; n *= 12; }
      else if (/month/i.test(rel[2])) unit = 'months';
      else if (/week/i.test(rel[2])) { unit = 'days'; n *= 7; }
      return { offset: { n, unit, dir: rel[3].toLowerCase(), base: BASES.has(base) ? base : base } };
    }
  }
  const date = parseDate(w);
  if (date?.date) return { absolute: date.date };
  return {};
}

// DGX line format: `KIND | WHEN | note`. WHEN is `YYYY-MM-DD`, `N days after
// BASE`, `on BASE`, or `—`. Anything else is dropped rather than guessed.
export function parseTimelineAnswer(text) {
  const clauses = [];
  for (const line of String(text || '').split('\n')) {
    const clean = line.replace(/\*\*/g, '').replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim();
    if (!clean.includes('|')) continue;
    const [kindRaw, whenRaw, ...noteParts] = clean.split('|');
    const kind = String(kindRaw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!KIND_SET.has(kind)) continue;
    const notes = clipNote(noteParts.join('|'));
    clauses.push({ kind, ...parseWhen(whenRaw), notes });
  }
  return mergeClauses(clauses);
}

export function timelineKindsFor(docType) {
  if (docType === 'COMMERCIAL') return TIMELINE_KINDS;
  return TIMELINE_KINDS.filter((k) => !COMMERCIAL_LC_KINDS.has(k));
}

export function timelinePrompt(docType) {
  const kinds = timelineKindsFor(docType);
  const commercial = docType === 'COMMERCIAL';
  const extra = commercial
    ? `- LC_RECEIVED and LC_LATEST_SHIPMENT only when the pages state a real number of days or a calendar date. If the number is not written, omit the line. Never write the letter N in place of a number.
- When the latest shipment is counted from arrival of the letter of credit, BASE is LC_RECEIVED.
- SHIPMENT (delivery time) uses the base the sentence names. "After signing" / 签订后 is SIGNED. "After receipt of the down payment" / 预付款到账后 is PAYMENT_DOWN. "After the contract becomes effective" is EFFECTIVE. If the sentence gives a length but does not say which of those it is counted from, WHEN is — and the note quotes the length. Do not assume signing.`
    : `- Do not extract letter-of-credit milestones (opening, receipt, latest shipment, presentation). Those belong to the commercial contract. Omit the line even if a page mentions shipment or payment in passing.
- Delivery, installation, FAT, FAC, drawings and warranty still belong here when this document states them.`;
  return `Extract the execution milestones this contract actually states. One line per milestone, nothing else:

KIND | WHEN | note

KIND is one of: ${kinds.join(', ')}

WHEN is one of:
- a calendar date as YYYY-MM-DD
- "N days after BASE", "N months after BASE", "N weeks after BASE", or the same with "before"
- "on BASE"
- — when the contract names the milestone but gives no time

BASE is one of: SIGNED, EFFECTIVE, SHIPMENT, FAT, FAC, INSTALLATION, PAYMENT_DOWN, LC_OPEN${commercial ? ', LC_RECEIVED' : ''}

Rules:
- Only include a milestone the pages state. Do not invent dates or milestones.
- SIGNED is the date the contract was signed. EFFECTIVE is when it takes effect (often when the down payment arrives, sometimes on signing — copy which one the pages say).
- "within N days of signing" is "N days after SIGNED". "within N days before shipment" is "N days before SHIPMENT".
- The note is one short English clause (under 140 characters) quoting the timing. Do not include the contract price or any currency amount.
- If the pages are silent on a milestone, omit the line.
${extra}`;
}

export function pickTimelinePages(pages) {
  if (!pages?.length) return [];
  const byNo = new Map(pages.map((p) => [p.pageNo, p]));
  const picked = new Map();
  for (const p of pages.slice(0, LEAD_PAGES)) picked.set(p.pageNo, p);
  for (const query of TIMELINE_TOPICS) {
    const { pages: seeds } = rankPages(pages, query, { maxPages: PER_TOPIC, maxPerFile: PER_TOPIC });
    for (const seed of seeds) {
      const page = byNo.get(seed.pageNo);
      if (page) picked.set(page.pageNo, page);
    }
  }
  const sent = [];
  let chars = 0;
  for (const p of [...picked.values()].sort((a, b) => a.pageNo - b.pageNo)) {
    if (sent.length >= MAX_SENT_PAGES || chars + String(p.text || '').length > MAX_SENT_CHARS) continue;
    sent.push(p);
    chars += String(p.text || '').length;
  }
  return sent;
}

function kindOfBase(base) {
  return BASE_TO_KIND[base] || base;
}

// Walk anchors until every clause that can be dated is dated. Cycles (shipment
// "before shipment") and missing bases stay undated — a blank is filled in by
// hand, a wrong date starts the wrong reminder.
export function resolveTimeline(clauses, { today } = {}) {
  const dates = new Map();
  const items = (clauses || []).filter((c) => c?.kind && KIND_SET.has(c.kind));
  for (const c of items) {
    if (c.absolute && !dates.has(c.kind)) dates.set(c.kind, c.absolute);
  }
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const c of items) {
      if (dates.has(c.kind)) continue;
      let baseDate = null;
      let offset = null;
      if (c.anchor) {
        baseDate = dates.get(kindOfBase(c.anchor));
        offset = { n: 0, unit: 'days', dir: 'after' };
      } else if (c.offset) {
        baseDate = dates.get(kindOfBase(c.offset.base));
        offset = c.offset;
      }
      if (!baseDate || !offset) continue;
      const due = shift(baseDate, offset);
      if (!due) continue;
      dates.set(c.kind, due);
      changed = true;
    }
    if (!changed) break;
  }
  return items.map((c) => {
    const dueDate = dates.get(c.kind) || null;
    // The signature date is a fact that already happened. Leaving it open
    // would put every new follow-up at the top of the list as overdue.
    // A down-payment date the contract states ("within 10 days of signing")
    // is only the expectation. It is not marked received: the money is
    // confirmed by the person, on the milestone, when it arrives.
    const done = c.kind === 'CONTRACT_SIGNED' && Boolean(dueDate) && Boolean(today) && dueDate < today;
    return {
      kind: c.kind,
      dueDate,
      label: c.label || null,
      notes: c.notes || null,
      done,
      confirmReceipt: c.kind === 'PAYMENT_DOWN' && Boolean(dueDate),
      needsStart: Boolean(c.unresolvedStart) && !dueDate,
      docType: c.docType || null,
      fileId: c.fileId || null,
      filename: c.filename || null,
    };
  });
}

const KIND_ORDER = new Map(TIMELINE_KINDS.map((k, i) => [k, i]));

export function orderProposals(proposals) {
  return [...(proposals || [])].sort((a, b) => (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99));
}

// A real number of days or a calendar date. An anchor that copies another
// milestone ("on opening") is not a date the text stated.
export function hasConcreteTiming(clause) {
  if (!clause) return false;
  if (clause.absolute && isIsoDate(clause.absolute)) return true;
  const n = clause.offset?.n;
  return Boolean(clause.offset?.base) && Number.isInteger(n) && n > 0;
}

export function clausesForDocument(clauses, docType) {
  // No document type means a bare parser fixture, which has no file to
  // mis-attribute. A real file that is not the commercial contract cannot
  // contribute letter-of-credit milestones.
  const commercial = !docType || docType === 'COMMERCIAL';
  return (clauses || []).filter((c) => {
    if (!c?.kind) return false;
    if (!commercial && COMMERCIAL_LC_KINDS.has(c.kind)) return false;
    if (LC_NEEDS_CONCRETE.has(c.kind) && !hasConcreteTiming(c)) return false;
    return true;
  });
}

const LC_PAGE_RULES = [
  ['LC_LATEST_SHIPMENT', /latest (?:date of )?shipment|最晚装运/i],
  ['LC_RECEIVED', /l\/?c (?:is |was |be |been |shall be |must be |to be )?received|letter of credit (?:is |was |shall be |must be |to be )?received|信用证收到|收到信用证|信用证(?:送达|到达)/i],
];

// Commercial page text, not the one-line summary. The summary is told to
// condense payment to "20% advance / 70% by letter of credit", which drops
// "received within 15 days of opening" and the latest shipment date. Only a
// sentence that carries a real number or a calendar date is kept.
export function lcClausesFromText(text) {
  if (!text) return [];
  const out = [];
  for (const [kind, re] of LC_PAGE_RULES) {
    for (const part of splitSentences(text)) {
      if (!re.test(part)) {
        re.lastIndex = 0;
        continue;
      }
      re.lastIndex = 0;
      const timing = parseTiming(part);
      if (!timing || circular(kind, timing)) continue;
      const clause = { kind, ...spreadTiming(timing), notes: clipNote(part) };
      if (!hasConcreteTiming(clause)) continue;
      out.push(clause);
      break;
    }
  }
  return out;
}

// What this commercial contract uses as 交货期起算.
//
// Read from the delivery clause the commercial file actually produced:
//   - base SIGNED            → counted from the signing date
//   - base PAYMENT_DOWN      → counted from receipt of the down payment
//   - base EFFECTIVE, and effectiveness is itself "when the down payment
//     arrives" or "on signing" → that same rule
//   - a calendar date        → no start rule is needed; the day is written
//   - a length with no clock, effectiveness that the text does not define,
//     or any other base      → ambiguous. Do not pick signing as a default.
//
// `clauses` must already be the commercial file's clauses. A technical
// agreement's delivery sentence is a different document and is not a vote.
export function detectDeliveryStart(clauses) {
  const list = clauses || [];
  const shipment = list.find((c) => c.kind === 'SHIPMENT');
  const effective = list.find((c) => c.kind === 'CONTRACT_EFFECTIVE');
  if (!shipment) return { rule: null, evidence: null, ambiguous: false };
  if (shipment.absolute && !shipment.offset && !shipment.anchor) {
    return { rule: null, evidence: shipment.notes || null, ambiguous: false };
  }
  const base = shipment.offset?.base || shipment.anchor || null;
  const evidence = shipment.notes || effective?.notes || null;
  if (base === 'SIGNED') return { rule: 'SIGNED', evidence, ambiguous: false };
  if (base === 'PAYMENT_DOWN') return { rule: 'PAYMENT_DOWN', evidence, ambiguous: false };
  if (base === 'EFFECTIVE') {
    const eff = effective?.offset?.base || effective?.anchor || null;
    if (eff === 'PAYMENT_DOWN') {
      return { rule: 'PAYMENT_DOWN', evidence: effective?.notes || evidence, ambiguous: false };
    }
    if (eff === 'SIGNED') {
      return { rule: 'SIGNED', evidence: effective?.notes || evidence, ambiguous: false };
    }
    return { rule: null, evidence, ambiguous: true };
  }
  if (shipment.unresolvedStart || shipment.offset || shipment.anchor) {
    return { rule: null, evidence, ambiguous: true };
  }
  return { rule: null, evidence: null, ambiguous: false };
}

// A person's choice, used only when the contract did not name a start (or
// they are correcting a reading). It does not rewrite a calendar date the
// contract printed. An explicit SIGNED / PAYMENT_DOWN base is replaced only
// because `source` is `manual` — the caller must not pass that for a rule
// the text already stated, or a correct reading would be overwritten on
// every pass. Callers pass `manual` for a stored or just-made choice.
export function normalizeDeliveryClauses(clauses, { rule, source } = {}) {
  if (source !== 'manual') return clauses || [];
  if (rule !== 'SIGNED' && rule !== 'PAYMENT_DOWN') return clauses || [];
  return (clauses || []).map((c) => {
    if (c.kind !== 'SHIPMENT' || c.absolute || !c.offset) return c;
    const { anchor, ...rest } = c;
    return {
      ...rest,
      unresolvedStart: false,
      offset: { ...c.offset, base: rule },
    };
  });
}

export function milestoneDay(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const day = value.slice(0, 10);
    return isIsoDate(day) ? day : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

// `signedDate` and `paymentDate` are facts already on the follow-up. They
// replace the contractual expectation for that one milestone so everything
// counted from it moves with the confirmation. Passing neither leaves the
// clause's own timing, which is the theoretical date from the text.
export function projectTimeline(clauses, {
  signedDate, paymentDate, deliveryStart, deliveryStartSource, today,
} = {}) {
  const normalized = normalizeDeliveryClauses(clauses, {
    rule: deliveryStart || null,
    source: deliveryStartSource || null,
  });
  const anchored = normalized.map((c) => {
    if (c.kind === 'CONTRACT_SIGNED' && signedDate) {
      const { offset, anchor, ...rest } = c;
      return { ...rest, absolute: signedDate };
    }
    if (c.kind === 'PAYMENT_DOWN' && paymentDate) {
      const { offset, anchor, unresolvedStart, ...rest } = c;
      return { ...rest, absolute: paymentDate };
    }
    return c;
  });
  return resolveTimeline(anchored, { today });
}

export function assembleProposals(groups, { today, deliveryStart } = {}) {
  const collected = [];
  for (const g of groups || []) {
    const docType = g?.docType || null;
    for (const c of clausesForDocument(g?.clauses, docType)) {
      collected.push({
        ...c,
        docType: c.docType || docType,
        fileId: g.fileId ?? c.fileId ?? null,
        filename: g.filename || c.filename || null,
      });
    }
  }
  const merged = mergeClauses(collected);
  const detected = detectDeliveryStart(merged.filter((c) => c.docType === 'COMMERCIAL'));
  const manual = deliveryStart === 'SIGNED' || deliveryStart === 'PAYMENT_DOWN' ? deliveryStart : null;
  // Rewriting when the text already named this rule would flatten
  // "12 months after effectiveness, and effectiveness is the down payment"
  // into "12 months after the down payment", dropping any gap between the
  // two. A choice only replaces the base when it differs from the reading.
  const normalized = manual && manual !== detected.rule
    ? normalizeDeliveryClauses(merged, { rule: manual, source: 'manual' })
    : merged;
  const proposals = redactProposalNotes(orderProposals(resolveTimeline(normalized, { today })))
    .map(({ filename, ...rest }) => rest);
  return {
    proposals,
    deliveryStart: {
      rule: manual || detected.rule || null,
      detected: detected.rule,
      source: manual ? 'manual' : (detected.rule ? 'contract' : null),
      ambiguous: Boolean(detected.ambiguous) && !manual,
      evidence: detected.evidence || null,
    },
  };
}

// What should move when an anchor moves. A milestone the person has ticked
// off, or whose date no longer matches the previous calculation, is left
// where they put it. A blank row that is already on the record is filled
// when the new calculation has a day. Rows that were never applied stay
// unapplied — the suggestion list is what the person applies.
// The anchor that just changed is not written again.
export function planAnchorShift({ clauses, existing, movedKind, before, after }) {
  const prev = projectTimeline(clauses, before || {});
  const next = projectTimeline(clauses, after || {});
  const prevBy = new Map(prev.map((p) => [p.kind, p]));
  const updates = [];
  for (const item of next) {
    if (item.kind === movedKind || item.kind === 'CONTRACT_SIGNED') continue;
    if (item.kind === 'PAYMENT_DOWN' && movedKind === 'PAYMENT_DOWN') continue;
    const row = (existing || []).find((m) => m.kind === item.kind);
    if (row?.doneAt) continue;
    // Confirming the signature may slide a down payment that is still the
    // contractual "N days after signing". A receipt already ticked, or a
    // date the person typed over the formula, does not slide.
    if (item.kind === 'PAYMENT_DOWN' && movedKind !== 'CONTRACT_SIGNED') continue;
    const prevDate = prevBy.get(item.kind)?.dueDate || null;
    const nextDate = item.dueDate || null;
    const stored = row ? milestoneDay(row.dueDate) : null;
    if (!row) continue;
    if (stored && stored !== prevDate) continue;
    if (stored === nextDate) continue;
    updates.push({
      kind: item.kind,
      id: row.id,
      action: 'update',
      dueDate: nextDate,
    });
  }
  return updates;
}

// What apply should do. A milestone that already has a date or is ticked off
// is left alone unless the caller passes replace. Notes a person typed on an
// otherwise empty row are kept. doneAt is only set when creating a signed
// milestone whose date is already past — replacing a date does not untick work
// someone marked done, and it does not tick a payment we have not seen arrive.
export function planMilestoneApply(existing, proposals, { replace = false } = {}) {
  const byKind = new Map((existing || []).map((m) => [m.kind, m]));
  const seen = new Set();
  const actions = [];
  for (const p of proposals || []) {
    if (!p?.kind || seen.has(p.kind) || !KIND_SET.has(p.kind)) continue;
    seen.add(p.kind);
    if (!p.dueDate && !p.notes && !p.label) {
      actions.push({ kind: p.kind, action: 'skip', reason: 'empty' });
      continue;
    }
    const row = byKind.get(p.kind);
    const filled = Boolean(row && (row.dueDate || row.doneAt));
    if (filled && !replace) {
      actions.push({ kind: p.kind, action: 'skip', reason: 'filled' });
      continue;
    }
    const data = {};
    if (p.dueDate && (replace || !row?.dueDate)) data.dueDate = p.dueDate;
    if (p.label && (replace || !row?.label)) data.label = p.label;
    if (p.notes && (replace || !row?.notes)) data.notes = p.notes;
    if (!row && p.done && p.kind === 'CONTRACT_SIGNED') data.done = true;
    if (!Object.keys(data).length) {
      actions.push({ kind: p.kind, action: 'skip', reason: 'nothing-new' });
      continue;
    }
    actions.push({ kind: p.kind, action: row ? 'update' : 'create', data });
  }
  return actions;
}
