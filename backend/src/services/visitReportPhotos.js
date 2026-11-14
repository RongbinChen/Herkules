// On-site photos for visit reports.
//
// Bytes live as a single file under VISIT_REPORT_STORAGE_DIR (one path segment,
// same rule as contract files and visit-report delete). Metadata stays on the
// existing VisitReport.attachments JSON — no new table:
//   { name, kind:'image', storedName, mimeType, caption, captionEdited,
//     width, height, sha256 }
//
// When the env var is unset the directory is backend/data/visit-reports.
// That folder is gitignored, so writing photos does not dirty the checkout
// and does not trip the deploy script's clean-worktree check.
import { createHash, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { fileURLToPath } from 'url';
import { storedAttachmentTargets } from './visitReportAccess.js';

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
const VECTOR_EXT = /\.(emf|wmf|svg|emz|wmz)$/i;
const MAX_CAPTION = 200;
const MAX_NEW_PHOTOS = 24;

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export function visitReportStorageRoot() {
  const configured = String(process.env.VISIT_REPORT_STORAGE_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(SERVICE_DIR, '..', '..', 'data', 'visit-reports');
}

export function isSafeStoredName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return false;
  return trimmed === path.basename(trimmed);
}

export function resolveStoredFile(storedName, storageRoot = visitReportStorageRoot()) {
  if (!isSafeStoredName(storedName)) return null;
  const targets = storedAttachmentTargets([{ storedName: storedName.trim() }], storageRoot);
  return targets[0] || null;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function cleanCaption(value) {
  let text = String(value ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/^["“”'「」]+|["“”'「」]+$/g, '').trim();
  if (text.length > MAX_CAPTION) text = text.slice(0, MAX_CAPTION).trim();
  return text;
}

export function normalizeMime(mime, name = '') {
  const raw = String(mime || '').toLowerCase().split(';')[0].trim();
  if (raw === 'image/jpg' || raw === 'image/pjpeg') return 'image/jpeg';
  if (raw.startsWith('image/')) return raw;
  const ext = path.extname(String(name || '')).toLowerCase();
  return MIME_BY_EXT[ext] || '';
}

export function mimeFromStoredName(storedName) {
  return MIME_BY_EXT[path.extname(String(storedName || '')).toLowerCase()] || '';
}

// Letterheads and logos are not workshop photos. The known example is a
// WaldrichSiegen header, about 445×62: short, and much wider than it is tall.
// Very small stamps and icons are dropped the same way. Unknown dimensions
// are kept unless the file itself is tiny.
export function isSkippableReportImage({ width, height, mimeType, name, byteLength } = {}) {
  const label = `${name || ''} ${mimeType || ''}`;
  if (VECTOR_EXT.test(label) || /(emf|wmf|svg)/i.test(label)) return true;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return byteLength != null && byteLength < 4096;
  }
  if (w < 160 && h < 160) return true;
  if (h <= 120 && w >= h * 4) return true;
  if (w <= 120 && h >= w * 4) return true;
  return false;
}

export function imageSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d && buffer.length >= 26) {
    const height = buffer.readInt32LE(22);
    return { width: buffer.readInt32LE(18), height: Math.abs(height) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpegSize(buffer);
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return webpSize(buffer);
  }
  return null;
}

function jpegSize(buf) {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (i < buf.length && buf[i] === 0xff) i += 1;
    if (i >= buf.length) return null;
    const marker = buf[i];
    i += 1;
    // Standalone markers (SOI, EOI, RSTn, TEM) carry no length.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (i + 1 >= buf.length) return null;
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof && i + 7 < buf.length) {
      return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return null;
}

function webpSize(buf) {
  const kind = buf.slice(12, 16).toString('ascii');
  if (kind === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

// Central-directory unzip. Docx is a zip; pandoc and Word both write one.
// Only store (0) and deflate (8) are read. Anything else is skipped.
export function unzipSync(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) return [];
  const entries = [];
  for (let n = 0; n < count && offset + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    if (dataOff + compSize > buf.length) continue;
    const compressed = buf.subarray(dataOff, dataOff + compSize);
    let data = null;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) {
      try { data = inflateRawSync(compressed); } catch { data = null; }
    }
    if (data) entries.push({ name: name.replace(/\\/g, '/'), data });
  }
  return entries;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function parseRels(xml) {
  const map = {};
  const tags = String(xml || '').matchAll(/<Relationship\b[^>]*>/g);
  for (const tag of tags) {
    const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
    const target = /Target="([^"]+)"/.exec(tag[0])?.[1];
    if (id && target) map[id] = target;
  }
  return map;
}

function stripXml(xml) {
  return String(xml || '')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function nearbyText(xml, index) {
  const from = Math.max(0, index - 1800);
  const to = Math.min(xml.length, index + 1800);
  return stripXml(xml.slice(from, to)).slice(0, 700);
}

function findMedia(entries, target) {
  let norm = String(target || '').replace(/\\/g, '/');
  try { norm = decodeURIComponent(norm); } catch { /* keep raw */ }
  const base = norm.split('/').pop();
  if (!base || !IMAGE_EXT.test(base)) return null;
  return entries.find((entry) => {
    const entryBase = entry.name.split('/').pop();
    return entryBase === base && entry.name.includes('media/');
  }) || null;
}

// Images referenced from the document body. Header and footer relationships
// (letterhead logos) are not walked. Size filtering happens afterwards.
export function extractDocxImages(buffer) {
  if (!buffer || !buffer.length) return [];
  let entries = [];
  try { entries = unzipSync(buffer); } catch { return []; }
  const docEntry = entries.find((entry) => entry.name === 'word/document.xml');
  const relEntry = entries.find((entry) => entry.name === 'word/_rels/document.xml.rels');
  if (!docEntry) return [];
  const xml = docEntry.data.toString('utf8');
  const rels = parseRels(relEntry ? relEntry.data.toString('utf8') : '');
  const images = [];
  const seen = new Set();
  const re = /r:(?:embed|id)="(rId\d+)"/g;
  let match;
  while ((match = re.exec(xml))) {
    const target = rels[match[1]];
    if (!target || seen.has(match[1])) continue;
    const media = findMedia(entries, target);
    if (!media) continue;
    seen.add(match[1]);
    const name = media.name.split('/').pop();
    const size = imageSize(media.data) || {};
    images.push({
      name,
      buffer: media.data,
      mimeType: normalizeMime('', name),
      width: size.width,
      height: size.height,
      nearby: nearbyText(xml, match.index),
      sha256: sha256(media.data),
      source: 'docx',
    });
  }
  return images;
}

function extensionFor(mime, name) {
  const fromName = path.extname(String(name || '')).toLowerCase();
  if (MIME_BY_EXT[fromName] && fromName !== '.tif' && fromName !== '.tiff') {
    return fromName === '.jpeg' ? '.jpg' : fromName;
  }
  const normalized = normalizeMime(mime, name);
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/bmp') return '.bmp';
  if (normalized === 'image/jpeg') return '.jpg';
  return '';
}

function positiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return undefined;
  return n;
}

// Keep only fields we are willing to persist. Drops buffers, paths, and
// anything that could point delete/export outside the storage root.
export function sanitizeAttachment(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180);
  const storedName = isSafeStoredName(item.storedName) ? item.storedName.trim() : '';
  const kind = item.kind === 'document' ? 'document' : 'image';
  if (!storedName) {
    if (!name) return null;
    return { name, kind };
  }
  const mimeType = item.kind === 'document'
    ? (String(item.mimeType || '').trim() || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    : normalizeMime(item.mimeType, storedName || name);
  const out = {
    name: name || storedName,
    kind: item.kind === 'document' ? 'document' : 'image',
    storedName,
  };
  if (mimeType) out.mimeType = mimeType;
  const caption = cleanCaption(item.caption);
  if (caption) out.caption = caption;
  if (item.captionEdited === true) out.captionEdited = true;
  const width = positiveInt(item.width);
  const height = positiveInt(item.height);
  if (width) out.width = width;
  if (height) out.height = height;
  if (typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)) out.sha256 = item.sha256;
  if (item.regenerateCaption === true) out.regenerateCaption = true;
  return out;
}

export function sanitizeAttachmentList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const clean = sanitizeAttachment(item);
    if (!clean) continue;
    const key = clean.storedName || `meta:${clean.kind}:${clean.name}:${out.length}`;
    if (clean.storedName && seen.has(clean.storedName)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function imageAttachments(attachments) {
  return sanitizeAttachmentList(attachments).filter((item) => item.storedName && item.kind === 'image');
}

// Every stored file, photos and the original Word document. Ownership checks
// use this so one report cannot adopt, then delete, another report's file.
export function storedAttachmentNames(attachments) {
  return sanitizeAttachmentList(attachments).filter((item) => item.storedName).map((item) => item.storedName);
}

// Names already stored on some other report. A save may keep names this report
// already owns, and names nobody owns yet (just generated), but not a file
// that belongs to a different report.
export function storedNamesOwnedByOthers(reports, reportId) {
  const names = new Set();
  for (const report of reports || []) {
    if (reportId != null && report?.id === reportId) continue;
    for (const name of storedAttachmentNames(report?.attachments)) names.add(name);
  }
  return names;
}

export function retainSavableAttachments(list, {
  storageRoot = visitReportStorageRoot(),
  takenNames = new Set(),
  ownedNames = [],
} = {}) {
  const owned = new Set(ownedNames.filter(Boolean));
  const out = [];
  for (const item of sanitizeAttachmentList(list)) {
    if (!item.storedName) {
      out.push(item);
      continue;
    }
    if (takenNames.has(item.storedName) && !owned.has(item.storedName)) continue;
    const abs = resolveStoredFile(item.storedName, storageRoot);
    if (!abs || !existsSync(abs)) continue;
    delete item.regenerateCaption;
    out.push(item);
  }
  return out.length ? out : null;
}

// Fresh uploads and docx body images, minus letterheads and bytes we already
// kept. Buffers stay in memory; the route writes them after captions exist.
export function gatherPhotoCandidates({ uploads = [], docxBuffer = null, existing = [] } = {}) {
  const prev = sanitizeAttachmentList(existing);
  const seen = new Set(prev.map((item) => item.sha256).filter(Boolean));
  const fresh = [];
  const considered = [];
  for (const file of uploads) {
    if (!file?.buffer?.length) continue;
    considered.push({
      name: file.name || 'photo',
      buffer: file.buffer,
      mimeType: normalizeMime(file.mimeType, file.name),
      source: 'upload',
    });
  }
  for (const image of extractDocxImages(docxBuffer)) considered.push(image);

  for (const image of considered) {
    if (fresh.length >= MAX_NEW_PHOTOS) break;
    const size = imageSize(image.buffer) || {};
    const width = size.width || image.width;
    const height = size.height || image.height;
    if (isSkippableReportImage({
      width,
      height,
      mimeType: image.mimeType,
      name: image.name,
      byteLength: image.buffer.length,
    })) continue;
    const ext = extensionFor(image.mimeType, image.name);
    // HEIC and other phone formats have no browser-safe extension yet.
    // writePhotoFiles transcodes those to JPEG; anything else is dropped.
    const imageLike = Boolean(ext)
      || String(image.mimeType || '').toLowerCase().startsWith('image/')
      || /\.(heic|heif|tiff?)$/i.test(image.name || '');
    if (!imageLike) continue;
    const digest = image.sha256 || sha256(image.buffer);
    if (seen.has(digest)) continue;
    seen.add(digest);
    fresh.push({
      name: image.name || `photo${ext || '.jpg'}`,
      buffer: image.buffer,
      mimeType: normalizeMime(image.mimeType, image.name) || (ext ? MIME_BY_EXT[ext] : ''),
      width,
      height,
      nearby: image.nearby || '',
      sha256: digest,
      source: image.source || 'upload',
    });
  }
  return { existing: prev, fresh };
}

export async function writePhotoFiles(photos, storageRoot = visitReportStorageRoot()) {
  await mkdir(storageRoot, { recursive: true });
  const saved = [];
  for (const source of photos || []) {
    const photo = await browserSafePhoto(source);
    if (!photo) continue;
    const ext = extensionFor(photo.mimeType, photo.name);
    if (!ext || !photo.buffer?.length) continue;
    const storedName = `${randomUUID()}${ext}`;
    await writeFile(path.join(storageRoot, storedName), photo.buffer);
    const meta = sanitizeAttachment({
      name: photo.name,
      kind: 'image',
      storedName,
      mimeType: photo.mimeType,
      caption: photo.caption,
      width: photo.width,
      height: photo.height,
      sha256: photo.sha256,
    });
    if (meta) saved.push(meta);
  }
  return saved;
}

// The uploaded .docx itself, so a later reader can open the file the text was taken from.
export async function writeOriginalDocument(buffer, originalName, storageRoot = visitReportStorageRoot()) {
  if (!buffer?.length) return null;
  await mkdir(storageRoot, { recursive: true });
  const storedName = `${randomUUID()}.docx`;
  await writeFile(path.join(storageRoot, storedName), buffer);
  return sanitizeAttachment({
    name: originalName || 'original.docx',
    kind: 'document',
    storedName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sha256: sha256(buffer),
  });
}

// Phone galleries sometimes hand us HEIC. Browsers and Word want JPEG/PNG.
async function browserSafePhoto(photo) {
  if (!photo?.buffer?.length) return null;
  if (extensionFor(photo.mimeType, photo.name)) return photo;
  try {
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(photo.buffer, { failOn: 'none' }).rotate().jpeg({ quality: 85 }).toBuffer();
    const size = imageSize(buffer) || {};
    const base = path.basename(String(photo.name || 'photo'), path.extname(String(photo.name || ''))) || 'photo';
    return {
      ...photo,
      buffer,
      mimeType: 'image/jpeg',
      name: `${base}.jpg`,
      width: photo.width || size.width,
      height: photo.height || size.height,
    };
  } catch (err) {
    console.error('[visit-report] unsupported image skipped:', err.message);
    return null;
  }
}

// Append newly stored photos. An existing row is never replaced here, so a
// caption the user already wrote stays put. Same bytes (sha256) are not stored twice.
export function mergeGeneratedPhotos(existing, fresh) {
  const prev = sanitizeAttachmentList(existing);
  const seen = new Set(prev.map((item) => item.sha256).filter(Boolean));
  const added = [];
  for (const photo of fresh || []) {
    const clean = sanitizeAttachment(photo);
    if (!clean?.storedName) continue;
    if (clean.sha256 && seen.has(clean.sha256)) continue;
    if (clean.sha256) seen.add(clean.sha256);
    added.push(clean);
  }
  const merged = [...prev, ...added];
  return merged.length ? merged : null;
}

// Regenerating the report may fill a blank caption. It does not replace one
// that is already there, and it does not touch captionEdited.
export function fillEmptyCaptions(attachments, captionsByStoredName) {
  const list = sanitizeAttachmentList(attachments);
  if (!list.length) return null;
  return list.map((item) => {
    if (!item.storedName || item.captionEdited || item.caption) return item;
    const next = cleanCaption(captionsByStoredName?.get?.(item.storedName));
    if (!next) return item;
    return { ...item, caption: next };
  });
}

// Apply a client save. User edits (captionEdited) win. An explicit
// regenerateCaption overwrites. A non-empty caption is otherwise left as it
// was; only an empty one is filled from the incoming draft.
export function mergeAttachmentUpdate(existing, incoming) {
  const prevList = sanitizeAttachmentList(existing);
  const nextList = sanitizeAttachmentList(incoming);
  const prevByStored = new Map(prevList.filter((item) => item.storedName).map((item) => [item.storedName, item]));
  const seen = new Set();
  const merged = [];

  const apply = (item) => {
    if (!item) return;
    const key = item.storedName || `meta:${item.kind}:${item.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const prev = item.storedName ? prevByStored.get(item.storedName) : null;
    if (!prev) {
      delete item.regenerateCaption;
      merged.push(item);
      return;
    }
    let caption = prev.caption || '';
    let captionEdited = prev.captionEdited === true;
    if (item.regenerateCaption === true) {
      caption = item.caption || '';
      captionEdited = false;
    } else if (item.captionEdited === true) {
      caption = item.caption || '';
      captionEdited = true;
    } else if (!caption && item.caption) {
      caption = item.caption;
      captionEdited = false;
    }
    const kept = { ...item };
    delete kept.regenerateCaption;
    delete kept.caption;
    delete kept.captionEdited;
    if (caption) kept.caption = caption;
    if (captionEdited) kept.captionEdited = true;
    merged.push(kept);
  };

  for (const item of nextList) apply(item);
  for (const item of prevList) apply(item);
  return merged.length ? merged : null;
}

export function buildCaptionPrompt({ language, context } = {}) {
  const lang = language === 'zh'
    ? '用中文写说明。一句，最多两个很短的分句。不要翻译成英文。'
    : 'Write the caption in English. One sentence, or at most two very short clauses. Do not translate it into Chinese.';
  return [
    'Write a short caption for this on-site photo in a customer visit report.',
    lang,
    'Use only what is visible in the photo and what the report context already states.',
    'Do not invent equipment models, serial numbers, measurements, or facts that are not visible in the photo or already in the context.',
    'If the photo is unclear, describe only what it appears to show.',
    'Output the caption only: no title, no quotes, no markdown.',
    context ? `Report context:\n${context}` : '',
  ].filter(Boolean).join('\n');
}

export function captionContext({
  customerName = '',
  projectName = '',
  visitDate = '',
  draft = null,
  nearby = '',
  ocrText = '',
} = {}) {
  const content = draft?.content || {};
  const meta = content.meta || {};
  return [
    customerName && `Customer: ${customerName}`,
    projectName && `Project: ${projectName}`,
    (draft?.visitDate || visitDate) && `Visit date: ${draft?.visitDate || visitDate}`,
    meta.machineType && `Machine: ${meta.machineType}`,
    meta.location && `Location: ${meta.location}`,
    draft?.summary && `Visit purpose: ${draft.summary}`,
    content.equipment && `Equipment discussed: ${String(content.equipment).slice(0, 500)}`,
    nearby && `Nearby notes: ${String(nearby).slice(0, 800)}`,
    ocrText && `Text read from this photo: ${String(ocrText).slice(0, 800)}`,
  ].filter(Boolean).join('\n').slice(0, 2000);
}

export async function mapPool(items, limit, fn) {
  const list = Array.from(items || []);
  const out = new Array(list.length);
  if (!list.length) return out;
  let cursor = 0;
  const workers = Math.min(Math.max(1, limit), list.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(list[index], index);
    }
  }));
  return out;
}

// Downscale for the Word file so a phone photo is not embedded at full
// resolution. Display size is also capped in the markdown ({width=14cm}).
// Sharp is a normal dependency; a corrupt image throws and the caller skips it.
export async function fitImageForDocx(buffer) {
  const sharp = (await import('sharp')).default;
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
