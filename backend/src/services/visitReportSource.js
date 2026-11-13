// Word import keeps the document text as the body. A model may write the
// summary and the separate target list. It does not get to replace the body.
import { unzipSync } from './visitReportPhotos.js';
import { SUMMARY_MODEL } from './visitReport.js';

export const BODY_SOURCE = 'original';
export const MAX_ORIGINAL_CHARS = 1_500_000;

const RECOVERY = {
  'body-gap': 'Text recovered from the document body',
  'text-box': 'Text recovered from text boxes',
  header: 'Text recovered from the header',
  footer: 'Text recovered from the footer',
};

export function isPreservedBody(content) {
  return Boolean(
    content
    && content.bodySource === BODY_SOURCE
    && typeof content.originalBody === 'string'
    && content.originalBody.trim(),
  );
}

// Null bytes only. Angle brackets such as "<X>" are technical text. The page
// renders them as text, and the Word export is asked not to treat them as HTML.
export function sanitizeOriginalBody(text) {
  if (typeof text !== 'string') {
    const err = new Error('Original report text must be text.');
    err.code = 'BODY_TYPE';
    throw err;
  }
  const s = text.replace(/\u0000/g, '');
  if (s.length > MAX_ORIGINAL_CHARS) {
    const err = new Error('The report text is too large to store.');
    err.code = 'BODY_TOO_LARGE';
    throw err;
  }
  return s;
}

// Legacy structured content passes through. A preserved body is checked on
// create and update so a huge or non-text body is rejected instead of cut.
export function assertPreservedContent(content) {
  if (content == null || typeof content !== 'object' || Array.isArray(content)) return content;
  if (content.bodySource !== BODY_SOURCE) return content;
  return { ...content, originalBody: sanitizeOriginalBody(content.originalBody) };
}

export function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Paragraphs in document order, including paragraphs inside tables and text boxes.
export function piecesFromWordXml(xml) {
  const paras = String(xml || '').match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const pieces = [];
  for (const para of paras) {
    const texts = [...para.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((match) => decodeXml(match[1]));
    const line = texts.join('').trim();
    if (normalizeSpace(line).length >= 2) pieces.push(line);
  }
  return pieces;
}

export function textBoxPieces(xml) {
  const boxes = String(xml || '').match(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g) || [];
  return boxes.flatMap((box) => piecesFromWordXml(box));
}

export function coverMissingPieces(markdown, pieces, { minLength = 8 } = {}) {
  const hay = normalizeSpace(markdown);
  const missing = [];
  for (const piece of pieces || []) {
    const norm = normalizeSpace(piece);
    if (norm.length < minLength) continue;
    if (!hay.includes(norm)) missing.push(String(piece).trim());
  }
  return missing;
}

function appendRecovered(body, pieces, code) {
  if (!pieces.length) return body;
  const title = RECOVERY[code] || 'Recovered text';
  return `${body}\n\n${title}\n\n${pieces.join('\n\n')}`.trim();
}

// markdown is pandoc's reading of the file. Pieces the XML still has, and
// pandoc did not keep, are appended and named in warnings. This is not a
// byte-for-byte copy of the Word file: drawings without text are not transcribed.
export function assembleOriginalBody({ markdown = '', documentXml = '', headerXmls = [], footerXmls = [] } = {}) {
  const warnings = [];
  let body = sanitizeOriginalBody(markdown);
  const missingParas = coverMissingPieces(body, piecesFromWordXml(documentXml));
  if (missingParas.length) {
    warnings.push({ code: 'body-gap', count: missingParas.length });
    body = appendRecovered(body, missingParas, 'body-gap');
  }
  const missingBoxes = coverMissingPieces(body, textBoxPieces(documentXml));
  if (missingBoxes.length) {
    warnings.push({ code: 'text-box', count: missingBoxes.length });
    body = appendRecovered(body, missingBoxes, 'text-box');
  }
  const headerPieces = headerXmls.flatMap((xml) => piecesFromWordXml(xml));
  const missingHeaders = coverMissingPieces(body, headerPieces, { minLength: 80 });
  if (missingHeaders.length) {
    warnings.push({ code: 'header', count: missingHeaders.length });
    body = appendRecovered(body, missingHeaders, 'header');
  }
  const footerPieces = footerXmls.flatMap((xml) => piecesFromWordXml(xml));
  const missingFooters = coverMissingPieces(body, footerPieces, { minLength: 80 });
  if (missingFooters.length) {
    warnings.push({ code: 'footer', count: missingFooters.length });
    body = appendRecovered(body, missingFooters, 'footer');
  }
  if (body.length > MAX_ORIGINAL_CHARS) {
    const err = new Error('The report text is too large to store.');
    err.code = 'BODY_TOO_LARGE';
    throw err;
  }
  if (!normalizeSpace(body)) {
    const err = new Error('No report text could be read from this Word file.');
    err.code = 'EMPTY_BODY';
    throw err;
  }
  return { originalBody: body, warnings };
}

export function docxXmlParts(buffer) {
  let entries = [];
  try { entries = unzipSync(buffer); } catch { entries = []; }
  const text = (name) => entries.find((entry) => entry.name === name)?.data?.toString('utf8') || '';
  return {
    documentXml: text('word/document.xml'),
    headerXmls: entries.filter((entry) => /^word\/header\d+\.xml$/.test(entry.name)).map((entry) => entry.data.toString('utf8')),
    footerXmls: entries.filter((entry) => /^word\/footer\d+\.xml$/.test(entry.name)).map((entry) => entry.data.toString('utf8')),
  };
}

export function assembleFromDocx(buffer, markdown) {
  const parts = buffer ? docxXmlParts(buffer) : { documentXml: '', headerXmls: [], footerXmls: [] };
  return assembleOriginalBody({ markdown, ...parts });
}

export function preservedContent({
  originalBody,
  targets = [],
  warnings = [],
  summaryModel = null,
  targetsModel = null,
}) {
  return {
    bodySource: BODY_SOURCE,
    originalBody,
    extractionWarnings: warnings,
    summaryModel,
    targets: Array.isArray(targets) ? targets : [],
    targetsModel,
  };
}

// Summary and targets are optional. A failure there must not drop the body.
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function isoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Only unambiguous dates. A slash date such as 07/14/2026 is left unset
// rather than guessed, and nothing here invents "today".
export function parseSourceDate(raw) {
  const text = normalizeSpace(raw).replace(/[,.]/g, '');
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match && MONTHS[match[2].toLowerCase()]) {
    return isoDate(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  }
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (match && MONTHS[match[1].toLowerCase()]) {
    return isoDate(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  }
  return null;
}

// Header lines only. The body text is not rewritten to match them.
export function sourceMeta(text) {
  const lines = String(text || '').split(/\n/).slice(0, 80);
  let visitDate = null;
  let customerName = null;
  for (const line of lines) {
    if (!visitDate) {
      const date = line.match(/^\s*(?:date of visit|visit date|日期|拜访日期)\s*[:：]\s*(.+)$/i);
      if (date) visitDate = parseSourceDate(date[1]);
    }
    if (!customerName) {
      const company = line.match(/^\s*(?:company|customer|公司|客户)\s*[:：]\s*(.+)$/i);
      const name = company ? normalizeSpace(company[1]) : '';
      if (name.length >= 2 && name.length <= 180) customerName = name;
    }
  }
  return { visitDate, customerName };
}

export function preservedDraft({
  originalBody,
  warnings = [],
  summary = null,
  summaryError = null,
  targets = [],
  targetsError = null,
  title = null,
  visitDate = null,
  customerName = null,
}) {
  const targetsOk = !targetsError;
  return {
    preserved: true,
    title: title || null,
    summary: summary || null,
    summaryError: summaryError || null,
    targetsError: targetsError || null,
    visitDate: visitDate || null,
    customerName: customerName || null,
    aiModel: null,
    content: preservedContent({
      originalBody,
      warnings,
      targets: targetsOk ? targets : [],
      summaryModel: summary ? SUMMARY_MODEL : null,
      targetsModel: targetsOk ? SUMMARY_MODEL : null,
    }),
  };
}

// First heading, else the first substantial line. Not a model title.
export function titleFromSource(markdown) {
  const lines = String(markdown || '').split(/\n/);
  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading && normalizeSpace(heading[1])) return normalizeSpace(heading[1]).slice(0, 180);
  }
  for (const line of lines) {
    const plain = normalizeSpace(line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, ''));
    if (plain.length >= 8 && !plain.startsWith('|')) return plain.slice(0, 180);
  }
  return null;
}

// First conversion copies rawNotes into the body and keeps the targets already
// saved. rawNotes stays the import evidence. Once a report is preserved, this
// does not replace originalBody, including when someone has edited it.
// It does not return customer, date, title, status, summary, rawNotes, or
// attachments, and it does not create or delete reminders. Not run automatically.
export function reprocessPreservedFromRawNotes(report) {
  const prev = report?.content && typeof report.content === 'object' ? report.content : {};
  const targets = Array.isArray(prev.targets) ? prev.targets : [];
  if (isPreservedBody(prev)) {
    return { applied: false, reason: 'already-preserved', content: prev };
  }
  const originalBody = sanitizeOriginalBody(typeof report?.rawNotes === 'string' ? report.rawNotes : '');
  if (!normalizeSpace(originalBody)) {
    const err = new Error('Stored source text is empty.');
    err.code = 'NO_SOURCE';
    throw err;
  }
  return {
    applied: true,
    reason: 'restored-from-source',
    content: preservedContent({
      originalBody,
      targets,
      warnings: [{
        code: 'reprocess',
        count: 0,
        detail: 'Body restored from the stored source text. Existing targets were kept.',
      }],
      summaryModel: prev.summaryModel || null,
      targetsModel: prev.targetsModel || null,
    }),
  };
}

// Captions are optional. A missing key, a rejection, or a timeout must not
// drop the body. Empty caption means none was written. Nothing is invented.
export async function enrichPreservedPhotos(fresh, { captionImage, writePhoto, geminiConfigured }) {
  const warnings = [];
  const saved = [];
  const list = Array.isArray(fresh) ? fresh : [];
  if (list.length && !geminiConfigured) {
    warnings.push({ code: 'caption-unavailable', count: list.length });
  }
  for (const photo of list) {
    let caption = '';
    if (geminiConfigured) {
      try {
        caption = String(await captionImage(photo) || '').trim();
      } catch {
        warnings.push({ code: 'caption-failed', count: 1 });
      }
    }
    try {
      const meta = await writePhoto({ ...photo, caption });
      if (meta) saved.push(meta);
    } catch {
      warnings.push({ code: 'photo-not-stored', count: 1 });
    }
  }
  return { photos: saved, warnings };
}

// Dated targets become calendar reminders on create. Updates do not call this.
export function reminderTargets(content) {
  const list = Array.isArray(content?.targets) ? content.targets : [];
  return list.filter((tg) => tg?.title && /^\d{4}-\d{2}-\d{2}$/.test(String(tg?.date || '')));
}

// Stamp the summary model without touching the body or the target list.
export function withSummaryModel(content, summaryModel) {
  if (!content || typeof content !== 'object') return content;
  return { ...content, summaryModel: summaryModel || content.summaryModel || null };
}
