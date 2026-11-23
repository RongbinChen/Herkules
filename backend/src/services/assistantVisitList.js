/**
 * Canonical "recent visits" list for Ask AI answers.
 * Built from trusted report sources (tool hrefs + stored summary/date), never
 * invented at render time. Replaces a model's markdown table OR a dashed /
 * raw-path list so only one numbered Date / Overview / Report-link list remains.
 */

const REPORT_TABLE_HEAD = /日期|报告|要点|概述|摘要|^date$|^report$|^overview$|^summary$|^title$/i;
const REPORT_TABLE_HINT = /日期|报告|要点|概述|visit\s*report|overview|summary/i;
const SECTION_HEADING = /^(?:#{1,4}\s*)?(?:\*\*)?(?:最近拜访|近期拜访|拜访报告|recent visits|visit reports)(?:\*\*)?/i;
const INSERT_BEFORE = /^(?:#{1,4}\s*)?(?:\*\*)?(?:下一步|next steps|其他|other)\b/im;

function fmtDay(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: m[1], mo: m[2], d: m[3] };
  try {
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '';
    const iso = dt.toISOString().slice(0, 10);
    const p = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return p ? { y: p[1], mo: p[2], d: p[3] } : '';
  } catch {
    return '';
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function formatVisitDate(value, lang = 'en') {
  const parts = fmtDay(value);
  if (!parts) return '';
  if (lang === 'zh') return `${parts.y}年${Number(parts.mo)}月${Number(parts.d)}日`;
  return `${MONTHS[Number(parts.mo) - 1]} ${Number(parts.d)}, ${parts.y}`;
}

export function visitListLabels(lang = 'en') {
  if (lang === 'zh') {
    return {
      heading: '最近拜访',
      count: (n) => `（共 ${n} 份报告）`,
      date: '日期',
      overview: '概述',
      link: '报告链接',
      view: '点击查看',
    };
  }
  return {
    heading: 'Recent visits',
    count: (n) => ` (${n})`,
    date: 'Date',
    overview: 'Overview',
    link: 'Report link',
    view: 'View report',
  };
}

export function reportsFromSources(sources = []) {
  const seen = new Set();
  const rows = [];
  for (const s of sources || []) {
    if (!s || s.type !== 'report') continue;
    const href = typeof s.href === 'string' ? s.href : '';
    if (!href.startsWith('/visit-reports/')) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    rows.push(s);
  }
  rows.sort((a, b) => String(b.visitDate || '').localeCompare(String(a.visitDate || '')));
  return rows;
}

export function formatVisitReportList(reports = [], lang = 'en') {
  const t = visitListLabels(lang);
  const items = (reports || []).filter((r) => r && r.title && r.href);
  if (!items.length) return '';
  const lines = items.map((r, i) => {
    const block = [`${i + 1}. **${String(r.title).trim()}**`];
    const colon = lang === 'zh' ? '：' : ': ';
    const day = formatVisitDate(r.visitDate, lang);
    if (day) block.push(`   ${t.date}${colon}${day}`);
    const overview = String(r.summary || '').trim();
    if (overview) block.push(`   ${t.overview}${colon}${overview}`);
    block.push(`   ${t.link}${colon}[${t.view}](${r.href})`);
    return block.join('\n');
  });
  const heading = `**${t.heading}**${t.count(items.length)}`;
  return `${heading}\n\n${lines.join('\n\n')}`;
}

function headerCells(line) {
  const t = String(line || '').trim();
  if (!t.includes('|')) return [];
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean);
}

function isSepLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  return /^\|?[\s:|-]+\|?$/.test(t) && t.includes('-');
}

export function isVisitReportTableHeader(line) {
  const cells = headerCells(line);
  if (cells.length < 2) return false;
  const joined = cells.join(' ');
  const hits = cells.filter((c) => REPORT_TABLE_HEAD.test(c)).length;
  return hits >= 2 || (hits >= 1 && REPORT_TABLE_HINT.test(joined));
}

const META_LINE = /^(?:[-*•]\s*)?(?:\*\*)?(?:Date|Overview|Report link|日期|概述|报告链接)(?:\*\*)?\s*[:：]/i;
const ITEM_START = /^\d+\.\s+\S/;
const BARE_REPORT_HREF = /\/visit-reports\/\d+/;

export function isVisitListHeading(line) {
  return SECTION_HEADING.test(String(line || '').trim());
}

export function isVisitListBodyLine(line) {
  const raw = String(line || '');
  const t = raw.trim();
  if (!t) return false;
  if (ITEM_START.test(t)) return true;
  if (META_LINE.test(t)) return true;
  if (BARE_REPORT_HREF.test(t)) return true;
  if (isVisitReportTableHeader(t) || isSepLine(t)) return true;
  if (t.startsWith('|') && t.includes('|')) return true;
  if (/^(?: {2,}|\t)/.test(raw) && t) return true;
  return false;
}

function looksLikeVisitItem(lines, index) {
  if (!ITEM_START.test(String(lines[index] || '').trim())) return false;
  for (let i = index + 1; i < Math.min(lines.length, index + 8); i += 1) {
    const t = String(lines[i] || '').trim();
    if (!t) continue;
    if (META_LINE.test(t) || BARE_REPORT_HREF.test(t)) return true;
    if (ITEM_START.test(t) || isVisitListHeading(t) || INSERT_BEFORE.test(t)) return false;
  }
  return false;
}

function isVisitBlockStart(lines, index) {
  const t = String(lines[index] || '').trim();
  if (isVisitListHeading(t)) return true;
  if (isVisitReportTableHeader(lines[index]) && index + 1 < lines.length && isSepLine(lines[index + 1])) return true;
  if (looksLikeVisitItem(lines, index)) return true;
  return false;
}

function consumeVisitBlock(lines, start) {
  let i = start;
  if (isVisitListHeading(lines[i]) || isVisitReportTableHeader(lines[i])) i += 1;
  while (i < lines.length) {
    const t = String(lines[i] || '').trim();
    if (!t) {
      const peek = lines[i + 1];
      if (peek == null) break;
      const pt = peek.trim();
      if (!pt) { i += 1; continue; }
      if (INSERT_BEFORE.test(pt)) break;
      if (isVisitListBodyLine(peek) || isVisitListHeading(pt)) { i += 1; continue; }
      break;
    }
    if (INSERT_BEFORE.test(t)) break;
    if (isVisitListBodyLine(lines[i]) || isVisitListHeading(t)) { i += 1; continue; }
    break;
  }
  return i;
}

// Remove every model-written recent-visits table or dashed/raw-path list.
// Used so packReply can insert exactly one canonical list.
export function stripVisitListBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const keep = [];
  let i = 0;
  let firstRemovedAt = null;
  while (i < lines.length) {
    if (!isVisitBlockStart(lines, i)) {
      keep.push(lines[i]);
      i += 1;
      continue;
    }
    let start = i;
    if (start > 0 && !String(lines[start - 1] || '').trim() && keep.length && !keep[keep.length - 1].trim()) {
      keep.pop();
    }
    if (firstRemovedAt == null) firstRemovedAt = keep.length;
    i = consumeVisitBlock(lines, start);
  }
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), firstRemovedAt };
}

// Replace any existing recent-visits table or list with the canonical numbered
// list (long-form dates, no leading dashes, clickable View report links).
// If none was found, insert the list before Next-steps / Other, or append it.
export function ensureVisitReportList(reply, sources = [], lang = 'en') {
  const reports = reportsFromSources(sources);
  const list = formatVisitReportList(reports, lang);
  const text = String(reply || '').replace(/\r\n/g, '\n');
  if (!list) return text;

  const stripped = stripVisitListBlocks(text);
  const body = stripped.text;

  if (stripped.firstRemovedAt != null && body) {
    const bodyLines = body.split('\n');
    const at = Math.min(stripped.firstRemovedAt, bodyLines.length);
    const before = bodyLines.slice(0, at).join('\n').trimEnd();
    const after = bodyLines.slice(at).join('\n').trimStart();
    return [before, list, after].filter((p) => String(p || '').length).join('\n\n');
  }

  const match = INSERT_BEFORE.exec(body);
  if (match && match.index > 0) {
    const before = body.slice(0, match.index).trimEnd();
    const after = body.slice(match.index).trimStart();
    return `${before}\n\n${list}\n\n${after}`;
  }
  const trimmed = body.trim();
  return trimmed ? `${trimmed}\n\n${list}` : list;
}
