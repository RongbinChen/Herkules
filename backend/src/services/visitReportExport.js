// Render a stored visit report into Markdown, which pandoc converts to .docx.
// Keeping this separate from the route makes the layout easy to tweak.
import { isPreservedBody } from './visitReportSource.js';

const esc = (v) => String(v ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
const altText = (v) => String(v ?? '').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Photo';

const SECTIONS = [
  ['attendees', 'Attendees'],
  ['needs', 'Customer Needs'],
  ['equipment', 'Equipment Discussed'],
  ['competitors', 'Competitors'],
  ['budgetTimeline', 'Budget & Timeline'],
  ['nextSteps', 'Next Steps'],
  ['risks', 'Risks'],
];

const META_ROWS = [
  ['recipients', 'To'],
  ['cc', 'CC'],
  ['location', 'Location'],
  ['industry', 'Industry'],
  ['machineType', 'Machine / Type'],
  ['quotationNo', 'Quotation No.'],
];

const fmtDate = (d) => {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
};

export function reportToMarkdown(report, options = {}) {
  const c = report.content || {};
  const meta = c.meta || {};
  const lines = [];

  lines.push(`# ${report.title || 'Visit Report'}`, '');

  // Header table (report metadata).
  const headerRows = [
    ['Date of Visit', fmtDate(report.visitDate)],
    ['Customer', report.customer?.name || ''],
    ['Author', report.author?.name || ''],
    ...META_ROWS.map(([k, label]) => [label, meta[k] || '']).filter(([, v]) => v),
  ].filter(([, v]) => v);
  if (headerRows.length) {
    lines.push('| Field | Value |', '| --- | --- |');
    for (const [k, v] of headerRows) lines.push(`| ${esc(k)} | ${esc(v)} |`);
    lines.push('');
  }

  if (report.summary) {
    lines.push('## Summary', '', String(report.summary).trim(), '');
  }

  // Imported Word text is the body. The summary above is separate, and the
  // old section buckets are not written out beside it.
  if (isPreservedBody(c)) {
    lines.push(String(c.originalBody).trim(), '');
    appendPhotos(lines, options.photos);
    return lines.join('\n');
  }

  for (const [key, label] of SECTIONS) {
    const val = c[key];
    if (val) lines.push(`## ${label}`, '', String(val).trim(), '');
  }

  // Structured tables.
  const tables = Array.isArray(c.tables) ? c.tables : [];
  for (const t of tables) {
    if (!Array.isArray(t.columns) || !t.columns.length) continue;
    if (t.title) lines.push(`## ${t.title}`, '');
    lines.push(`| ${t.columns.map(esc).join(' | ')} |`);
    lines.push(`| ${t.columns.map(() => '---').join(' | ')} |`);
    for (const row of (t.rows || [])) {
      const cells = t.columns.map((_, i) => esc(row[i]));
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  // Photos stay after the body: summary, sections, and tables above, gallery last.
  appendPhotos(lines, options.photos);

  return lines.join('\n');
}

function appendPhotos(lines, photos) {
  const placed = (Array.isArray(photos) ? photos : []).filter((photo) => photo?.markdownPath);
  if (!placed.length) return;
  lines.push('## Report photos', '');
  for (const photo of placed) {
    const caption = altText(photo.caption || photo.name || 'Photo');
    lines.push(`![${caption}](${photo.markdownPath}){width=14cm}`, '');
  }
}
