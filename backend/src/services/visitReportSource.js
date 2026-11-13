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

export function sanitizeOriginalBody(text) {
  let s = String(text ?? '').replace(/\u0000/g, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<\/?[a-zA-Z!][^>\n]*>/g, '');
  if (s.length > MAX_ORIGINAL_CHARS) {
    const err = new Error('The report text is too large to store.');
    err.code = 'BODY_TOO_LARGE';
    throw err;
  }
  return s.replace(/\n{4,}/g, '\n\n\n').trim();
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
  body = sanitizeOriginalBody(body);
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
export function preservedDraft({
  originalBody,
  warnings = [],
  summary = null,
  summaryError = null,
  targets = [],
  targetsError = null,
  title = null,
}) {
  const targetsOk = !targetsError;
  return {
    preserved: true,
    title: title || null,
    summary: summary || null,
    summaryError: summaryError || null,
    targetsError: targetsError || null,
    visitDate: null,
    customerName: null,
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

// Restore a saved report's body from its stored source text. Keeps the targets
// already on the row. Does not return customer, date, title, status, summary,
// or attachments, and does not create or delete reminders. Not run automatically.
export function reprocessPreservedFromRawNotes(report) {
  const originalBody = sanitizeOriginalBody(report?.rawNotes || '');
  if (!normalizeSpace(originalBody)) {
    const err = new Error('Stored source text is empty.');
    err.code = 'NO_SOURCE';
    throw err;
  }
  const prev = report?.content && typeof report.content === 'object' ? report.content : {};
  const targets = Array.isArray(prev.targets) ? prev.targets : [];
  return {
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
