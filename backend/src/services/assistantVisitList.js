/**
 * Canonical "recent visits" list for Ask AI answers.
 * Built from trusted report sources (tool hrefs + stored summary/date), never
 * invented at render time. Replaces a model's markdown table so the answer
 * body stays in the numbered Date / Overview / Report-link shape.
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

// Replace a "最近拜访" heading plus a pipe table, or a standalone visit-report
// table, with the canonical list. If no table is found, insert the list before
// a Next-steps / Other heading, or append it.
export function ensureVisitReportList(reply, sources = [], lang = 'en') {
  const reports = reportsFromSources(sources);
  const list = formatVisitReportList(reports, lang);
  const text = String(reply || '').replace(/\r\n/g, '\n');
  if (!list) return text;

  const lines = text.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!isVisitReportTableHeader(lines[i])) continue;
    if (i + 1 >= lines.length || !isSepLine(lines[i + 1])) continue;
    start = i;
    if (i > 0 && SECTION_HEADING.test(lines[i - 1].trim())) start = i - 1;
    if (start > 0 && !lines[start - 1].trim()) start -= 1;
    end = i + 2;
    while (end < lines.length) {
      const row = lines[end].trim();
      if (row.includes('|') && !isSepLine(row) && (row.startsWith('|') || row.includes('|'))) {
        end += 1;
        continue;
      }
      break;
    }
    break;
  }

  if (start >= 0) {
    const before = lines.slice(0, start).join('\n').trimEnd();
    const after = lines.slice(end).join('\n').trimStart();
    return [before, list, after].filter((p) => String(p || '').length).join('\n\n');
  }

  if (text.includes('/visit-reports/') && /报告链接|Report link/.test(text)) {
    // A previous pass (or the model) already used the canonical labels; if it
    // still has a table we would have replaced it above. Leave prose+list as is
    // only when our list would be a duplicate of the same hrefs.
    const hrefs = reports.map((r) => r.href);
    if (hrefs.every((h) => text.includes(h))) return text;
  }

  const match = INSERT_BEFORE.exec(text);
  if (match && match.index > 0) {
    const before = text.slice(0, match.index).trimEnd();
    const after = text.slice(match.index).trimStart();
    return `${before}\n\n${list}\n\n${after}`;
  }
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n${list}` : list;
}
