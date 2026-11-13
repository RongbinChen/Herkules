import express from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  blankVisitDraft,
  sourceLanguage,
  extractVisitTargets,
  structureVisitReport,
  summarizeVisitReport,
} from '../services/visitReport.js';
import { captionVisitPhoto, ocrImage, isGeminiConfigured } from '../services/gemini.js';
import { reportToMarkdown } from '../services/visitReportExport.js';
import {
  buildCaptionPrompt,
  captionContext,
  cleanCaption,
  fillEmptyCaptions,
  fitImageForDocx,
  gatherPhotoCandidates,
  imageAttachments,
  mapPool,
  mergeAttachmentUpdate,
  mergeGeneratedPhotos,
  mimeFromStoredName,
  resolveStoredFile,
  retainSavableAttachments,
  sha256,
  storedNamesOwnedByOthers,
  visitReportStorageRoot,
  writeOriginalDocument,
  writePhotoFiles,
} from '../services/visitReportPhotos.js';
import {
  assembleFromDocx,
  preservedDraft,
  reminderTargets,
  titleFromSource,
} from '../services/visitReportSource.js';
import { normalizeCompany } from '../services/companyName.js';
import {
  canDeleteVisitReport,
  handleDeleteVisitReport,
  withCanDelete,
} from '../services/visitReportAccess.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authenticateToken);

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;
const canEdit = (report, user) => report.authorId === user.userId || user.isAdmin;
const GEMINI_MISSING = '图片识别未配置（服务器缺少 GEMINI_API_KEY）。可先只用文字随手记。';

function parseExistingAttachments(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function takenPhotoNames(exceptId = null) {
  const rows = await prisma.visitReport.findMany({ select: { id: true, attachments: true } });
  return storedNamesOwnedByOthers(rows, exceptId);
}

// Persist only names that resolve to a real file in the storage root, and
// never a file that already belongs to a different report.
async function attachmentsFromClient(list, { reportId = null, ownedNames = [] } = {}) {
  if (!Array.isArray(list)) return null;
  const needsFiles = list.some((item) => item && item.storedName);
  const taken = needsFiles ? await takenPhotoNames(reportId) : new Set();
  return retainSavableAttachments(list, {
    storageRoot: visitReportStorageRoot(),
    takenNames: taken,
    ownedNames,
  });
}

function sendImage(res, buffer, filename, mimeType) {
  const mime = (mimeType && String(mimeType).startsWith('image/')) ? String(mimeType) : mimeFromStoredName(filename);
  if (!mime) return res.status(404).json({ error: 'Not found' });
  const safe = String(filename || 'photo').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'photo';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.send(buffer);
}

function captionLanguage(draft, sourceText) {
  const body = [
    draft?.summary,
    draft?.content?.needs,
    draft?.content?.equipment,
    draft?.content?.attendees,
    draft?.content?.nextSteps,
    draft?.content?.risks,
  ].filter(Boolean).join('\n');
  return sourceLanguage(body || sourceText || draft?.title || '');
}

// Resolve customer/project names for AI context.
async function contextFor(customerId, threadKey) {
  const [customer, project] = await Promise.all([
    customerId ? prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }) : null,
    threadKey ? prisma.bidProject.findFirst({ where: { threadKey }, select: { projectName: true } }) : null,
  ]);
  return { customerName: customer?.name || '', projectName: project?.projectName || '' };
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { customerId, threadKey, mine } = req.query;
    const where = {};
    if (customerId) where.customerId = parseInt(customerId);
    if (threadKey) where.threadKey = threadKey;
    if (mine === 'true') where.authorId = req.user.userId;
    const reports = await prisma.visitReport.findMany({
      where,
      orderBy: { visitDate: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
      },
    });
    // Read visibility stays "every logged-in user". canDelete is the only
    // addition: the uploader or an admin, same rule the DELETE route enforces.
    res.json(reports.map((report) => withCanDelete(report, req.user)));
  } catch (error) {
    console.error('Error listing visit reports:', error);
    res.status(500).json({ error: 'Failed to list visit reports' });
  }
});

// ── Duplicate check ───────────────────────────────────────────────────────────
// Same customer + same visit day is almost always a second copy of a report
// that is already on file: a .docx imported twice, or two people writing up the
// same meeting. Almost — two separate visits to one customer in one day do
// happen — so this only reports what exists and lets the caller decide. A hard
// unique constraint would also mean a schema change, which stops the deploy.
//
// Declared BEFORE `/:id`: Express matches in order, and `/duplicates` would
// otherwise be read as a report id.
router.get('/duplicates', async (req, res) => {
  try {
    const customerId = parseInt(req.query.customerId, 10);
    const day = String(req.query.visitDate || '').slice(0, 10);
    const excludeId = parseInt(req.query.excludeId, 10);
    // No customer or no date is not an error — there is simply nothing to
    // compare yet, and the caller polls this while the form is still being
    // filled in.
    if (!Number.isInteger(customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.json([]);
    // Visit dates are written as `new Date('YYYY-MM-DD')` (UTC midnight) and
    // read back through toISOString(), so the UTC day is the day the user sees.
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 3600e3);
    const reports = await prisma.visitReport.findMany({
      where: {
        customerId,
        visitDate: { gte: start, lt: end },
        ...(Number.isInteger(excludeId) ? { NOT: { id: excludeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        visitDate: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });
    res.json(reports);
  } catch (error) {
    console.error('Error checking visit report duplicates:', error);
    res.status(500).json({ error: 'Failed to check duplicates' });
  }
});

// Draft photos (generated, not saved on a report yet). Same login as viewing
// a report — the name is an unguessable id, and the file must sit in the
// storage root. Saved photos are also served from the report-scoped route.
router.get('/files/:storedName', async (req, res) => {
  try {
    const file = await readStoredImage(req.params.storedName);
    if (!file) return res.status(404).json({ error: 'Not found' });
    return sendImage(res, file.buffer, req.params.storedName, file.mime);
  } catch (error) {
    console.error('Error reading visit report photo:', error);
    return res.status(500).json({ error: 'Failed to load photo' });
  }
});

// Explicit "regenerate caption" before the report row exists. Does not write
// the database; the client keeps the text until save.
router.post('/photos/:storedName/caption', async (req, res) => {
  try {
    const contextText = String(req.body?.context || '').slice(0, 4000);
    const result = await captionStoredPhoto(req.params.storedName, {
      language: sourceLanguage(contextText),
      context: captionContext({ nearby: contextText }),
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ caption: result.caption });
  } catch (error) {
    console.error('Error captioning visit report photo:', error);
    return res.status(500).json({ error: 'Failed to caption photo' });
  }
});

async function readStoredImage(storedName) {
  const abs = resolveStoredFile(storedName, visitReportStorageRoot());
  if (!abs) return null;
  const mime = mimeFromStoredName(storedName);
  if (!mime) return null;
  try {
    return { buffer: await readFile(abs), mime };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function captionStoredPhoto(storedName, { language, context, mimeType }) {
  const file = await readStoredImage(storedName);
  if (!file) return { status: 404, error: 'Not found' };
  if (!isGeminiConfigured()) return { status: 503, error: GEMINI_MISSING };
  const caption = cleanCaption(await captionVisitPhoto(
    file.buffer,
    mimeType || file.mime,
    buildCaptionPrompt({ language, context }),
  ));
  if (!caption) return { status: 502, error: '图片说明生成失败，请稍后重试或手写一句。' };
  return { status: 200, caption };
}

// ── Single ─────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const report = await prisma.visitReport.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        customer: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
      },
    });
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json({ ...report, canEdit: canEdit(report, req.user), canDelete: canDeleteVisitReport(report, req.user) });
  } catch (error) {
    console.error('Error fetching visit report:', error);
    res.status(500).json({ error: 'Failed to fetch visit report' });
  }
});

// Conservative customer matching for AI-extracted company names: normalize
// via shared companyName helper and require a UNIQUE contains-match either
// way — ambiguous or missing → null (leave unlinked).
async function matchCustomerByName(name) {
  const target = normalizeCompany(name);
  if (!target || target.length < 3) return null;
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const hits = customers.filter((c) => {
    const cn = normalizeCompany(c.name);
    return cn && (cn.includes(target) || target.includes(cn));
  });
  return hits.length === 1 ? hits[0] : null;
}

// Pandoc markdown keeps paragraphs, lists, and tables. Raw HTML is turned off
// so a crafted document cannot embed markup. This is still not a lossless copy.
function pandocTo(buffer, to, ext) {
  const stamp = `${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}`;
  const inPath = join(tmpdir(), `vr-in-${stamp}.docx`);
  const outPath = join(tmpdir(), `vr-in-${stamp}.${ext}`);
  return (async () => {
    try {
      await writeFile(inPath, buffer);
      await new Promise((resolve, reject) => {
        execFile('pandoc', [inPath, '-f', 'docx', '-t', to, '--wrap=none', '-o', outPath], (err) =>
          err ? reject(err) : resolve());
      });
      return await readFile(outPath, 'utf8');
    } finally {
      unlink(inPath).catch(() => {});
      unlink(outPath).catch(() => {});
    }
  })();
}

function docxToMarkdown(buffer) {
  return pandocTo(buffer, 'markdown-raw_html-native_divs-native_spans', 'md');
}

// Word import: the file's text is the body. Summary and targets are separate
// calls and may fail without discarding that text. Reminders are not created
// here; the existing create route does that when the user saves.
async function respondPreservedImport(req, res, { doc, files, customerId, visitDate }) {
  let markdown = '';
  try {
    markdown = await docxToMarkdown(doc.buffer);
  } catch (err) {
    console.error('[visit-report] docx convert error:', err.message);
    return res.status(422).json({ error: 'Word 文档解析失败，请确认文件未损坏' });
  }
  let packed;
  try {
    packed = assembleFromDocx(doc.buffer, markdown);
  } catch (err) {
    if (err.code === 'EMPTY_BODY') {
      return res.status(422).json({ error: '未能从 Word 中读出正文。请换一个 .docx，或改用手动输入。' });
    }
    if (err.code === 'BODY_TOO_LARGE') {
      return res.status(413).json({ error: '报告正文过长，无法保存。' });
    }
    throw err;
  }

  const gathered = gatherPhotoCandidates({
    uploads: files.map((f) => ({
      buffer: f.buffer,
      mimeType: f.mimetype || 'image/jpeg',
      name: f.originalname || 'photo',
    })),
    docxBuffer: doc.buffer,
    existing: parseExistingAttachments(req.body.existingAttachments),
  });
  if (files.length > 0 && !isGeminiConfigured()) {
    return res.status(503).json({ error: GEMINI_MISSING });
  }

  const language = sourceLanguage(packed.originalBody);
  const captionOne = async (buffer, mimeType, extra) => {
    const prompt = buildCaptionPrompt({
      language,
      context: captionContext({
        visitDate,
        nearby: extra.nearby,
        ocrText: extra.ocrText,
        draft: { summary: packed.originalBody.slice(0, 500) },
      }),
    });
    return captionVisitPhoto(buffer, mimeType, prompt);
  };
  const captioned = await mapPool(gathered.fresh, 3, async (photo) => ({
    ...photo,
    caption: await captionOne(photo.buffer, photo.mimeType, { nearby: photo.nearby, ocrText: '' }),
  }));
  const savedPhotos = await writePhotoFiles(captioned, visitReportStorageRoot());
  let attachments = mergeGeneratedPhotos(gathered.existing, savedPhotos) || [];
  const original = await writeOriginalDocument(doc.buffer, doc.originalname, visitReportStorageRoot());
  if (original) attachments = [...attachments, original];

  let summary = null;
  let summaryError = null;
  try {
    summary = await summarizeVisitReport(packed.originalBody);
  } catch (err) {
    summaryError = err.message || 'summary failed';
    console.error('[visit-report] summary kept off the body:', err.message);
  }
  let targets = [];
  let targetsError = null;
  try {
    targets = await extractVisitTargets(packed.originalBody, { visitDate });
  } catch (err) {
    targetsError = err.message || 'targets failed';
    console.error('[visit-report] targets kept off the body:', err.message);
  }

  const draft = preservedDraft({
    originalBody: packed.originalBody,
    warnings: packed.warnings,
    summary,
    summaryError,
    targets,
    targetsError,
    title: titleFromSource(packed.originalBody),
  });
  let customerMatch = null;
  if (!customerId && draft.customerName) {
    customerMatch = await matchCustomerByName(draft.customerName);
  }
  return res.json({
    ...draft,
    customerMatch,
    rawNotes: packed.originalBody,
    attachments,
    warnings: packed.warnings,
  });
}

// ── AI generate (does NOT save the report row) ─────────────────────────────────
// multipart: images[] (photos) + document (one .docx) + rawNotes + customerId?
// + threadKey? + visitDate? + existingAttachments? (JSON; captions already on
// the draft are kept — only empty ones are filled).
// Photo files ARE written, so the client can save them with the report.
router.post('/generate', upload.fields([{ name: 'images', maxCount: 10 }, { name: 'document', maxCount: 1 }]), async (req, res) => {
  try {
    const { rawNotes = '', customerId, threadKey, visitDate } = req.body;
    const files = (req.files?.images || []).filter((f) => IMAGE_RE.test(f.originalname || '') || (f.mimetype || '').startsWith('image/'));

    // A Word file keeps its own text. Notes-only generate still structures below.
    const doc = (req.files?.document || [])[0];
    if (doc) {
      if (!/\.docx$/i.test(doc.originalname || '')) {
        return res.status(400).json({ error: '文档导入目前支持 .docx（Word 2007+）格式' });
      }
      return await respondPreservedImport(req, res, { doc, files, customerId, visitDate });
    }

    const docText = '';
    const gathered = gatherPhotoCandidates({
      uploads: files.map((f) => ({
        buffer: f.buffer,
        mimeType: f.mimetype || 'image/jpeg',
        name: f.originalname || 'photo',
      })),
      docxBuffer: doc?.buffer,
      existing: parseExistingAttachments(req.body.existingAttachments),
    });

    // OCR each uploaded photo → fold into the notes fed to the model.
    // Docx body text already came from pandoc; its pictures are captioned, not OCR'd into the notes.
    let ocrText = '';
    const ocrByHash = new Map();
    if (files.length > 0) {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ error: GEMINI_MISSING });
      }
      const parts = [];
      for (const f of files) {
        const digest = sha256(f.buffer);
        try {
          const t = await ocrImage(f.buffer, f.mimetype || 'image/jpeg');
          if (t) {
            parts.push(`【照片：${f.originalname || 'image'}】\n${t}`);
            ocrByHash.set(digest, t);
          }
        } catch (err) {
          console.error('[visit-report] OCR error:', err.message);
        }
      }
      ocrText = parts.join('\n\n');
    }

    const combined = [rawNotes.trim(), docText, ocrText].filter(Boolean).join('\n\n');
    if (!combined && gathered.fresh.length === 0) {
      return res.status(400).json({ error: '请至少提供文字随手记、Word 文档或一张照片' });
    }

    const { customerName, projectName } = await contextFor(
      customerId ? parseInt(customerId) : null, threadKey || null);
    const draft = combined
      ? await structureVisitReport(combined, { customerName, projectName, visitDate })
      : blankVisitDraft(visitDate);

    const language = captionLanguage(draft, combined);
    const captionOne = async (buffer, mimeType, extra) => {
      const prompt = buildCaptionPrompt({
        language,
        context: captionContext({
          customerName: customerName || draft.customerName,
          projectName,
          visitDate: draft.visitDate || visitDate,
          draft,
          nearby: extra.nearby,
          ocrText: extra.ocrText,
        }),
      });
      return captionVisitPhoto(buffer, mimeType, prompt);
    };

    const captioned = await mapPool(gathered.fresh, 3, async (photo) => ({
      ...photo,
      caption: await captionOne(photo.buffer, photo.mimeType, {
        nearby: photo.nearby,
        ocrText: ocrByHash.get(photo.sha256) || '',
      }),
    }));
    const saved = await writePhotoFiles(captioned, visitReportStorageRoot());
    let attachments = mergeGeneratedPhotos(gathered.existing, saved);

    // A second generate fills captions that are still empty. Edited ones stay.
    const existingNames = new Set(gathered.existing.map((item) => item.storedName).filter(Boolean));
    const blanks = (attachments || []).filter((item) => (
      existingNames.has(item.storedName) && !item.captionEdited && !item.caption
    ));
    if (blanks.length && isGeminiConfigured()) {
      const filled = new Map();
      await mapPool(blanks, 3, async (item) => {
        const abs = resolveStoredFile(item.storedName, visitReportStorageRoot());
        if (!abs) return;
        try {
          const buf = await readFile(abs);
          const caption = await captionOne(buf, item.mimeType || mimeFromStoredName(item.storedName) || 'image/jpeg', {});
          if (caption) filled.set(item.storedName, caption);
        } catch (err) {
          console.error('[visit-report] caption refill error:', err.message);
        }
      });
      if (filled.size) attachments = fillEmptyCaptions(attachments, filled);
    }

    // Match the AI-extracted company against the Customers module — only a
    // unique hit auto-links; otherwise the picker stays empty for manual choice.
    let customerMatch = null;
    if (!customerId && draft.customerName) {
      customerMatch = await matchCustomerByName(draft.customerName);
    }
    res.json({ ...draft, customerMatch, rawNotes: combined, attachments: attachments || [] });
  } catch (error) {
    if (error.isDeepSeek || error.isGemini) return res.status(502).json({ error: error.message });
    console.error('Error generating visit report:', error);
    res.status(500).json({ error: 'Failed to generate visit report' });
  }
});

// ── AI summarize (does NOT save; keeps the body untouched) ──────────────────────
router.post('/summarize', async (req, res) => {
  try {
    const text = req.body?.text || '';
    if (!String(text).trim()) return res.status(400).json({ error: '缺少可总结的文本' });
    const summary = await summarizeVisitReport(text);
    res.json({ summary });
  } catch (error) {
    if (error.isDeepSeek) return res.status(502).json({ error: error.message });
    console.error('Error summarizing visit report:', error);
    res.status(500).json({ error: 'Failed to summarize' });
  }
});

// Resolve the report's actual author (the docx "From" field) to a system user.
// Unique case-insensitive contains-match; otherwise fall back to the uploader.
async function resolveAuthorId(content, fallbackId) {
  const name = String(content?.meta?.author || '').trim().toLowerCase();
  if (name.length < 3) return fallbackId;
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const hits = users.filter((u) => {
    const un = u.name.trim().toLowerCase();
    return un.includes(name) || name.includes(un);
  });
  return hits.length === 1 ? hits[0].id : fallbackId;
}

// ── Create ─────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, visitDate, customerId, threadKey, summary, content, rawNotes, attachments, status, aiModel } = req.body;
    if (!title || !visitDate) return res.status(400).json({ error: 'title 与 visitDate 必填' });
    // Imported reports are often written by someone else — credit the "From"
    // person when they map to a system user (uploader stays the fallback).
    const authorId = await resolveAuthorId(content, req.user.userId);
    const storedAttachments = await attachmentsFromClient(attachments);
    const report = await prisma.visitReport.create({
      data: {
        title,
        visitDate: new Date(visitDate),
        customerId: customerId ? parseInt(customerId) : null,
        threadKey: threadKey || null,
        authorId,
        summary: summary || null,
        content: content ?? null,
        rawNotes: rawNotes || null,
        attachments: storedAttachments,
        status: status === 'FINAL' ? 'FINAL' : 'DRAFT',
        aiModel: aiModel || null,
      },
    });

    // AI-extracted targets with a concrete date → REMINDER calendar events for
    // the author (create only — updates never duplicate reminders).
    let remindersCreated = 0;
    const targets = reminderTargets(content);
    for (const tg of targets) {
      if (!tg?.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(tg.date || ''))) continue;
      try {
        const start = new Date(`${tg.date}T09:00:00+08:00`);
        await prisma.event.create({
          data: {
            // No target id exists on content.targets[]. This title is how the
            // dashboard deep-links back to the row (`⏰ ` + title, 180 chars).
            title: `⏰ ${String(tg.title).slice(0, 180)}`,
            description: [`From visit report: ${title}`, tg.note ? `“${tg.note}”` : null].filter(Boolean).join('\n'),
            start,
            end: new Date(start.getTime() + 60 * 60 * 1000),
            allDay: true,
            category: 'REMINDER',
            // Targets >30 days in the past (importing an old report) are history →
            // DONE. Anything recent/future stays PLANNED — the owner decides via
            // the dashboard's due-reminders prompt (done / postpone / delete).
            status: start < new Date(Date.now() - 30 * 24 * 3600e3) ? 'DONE' : 'PLANNED',
            color: '#e11d48',
            customerId: report.customerId,
            visitReportId: report.id, // clickable back-link to the source report
            userId: authorId, // reminders belong to the report's actual author
          },
        });
        remindersCreated++;
      } catch (err) {
        console.error('[visit-report] reminder event failed:', err.message);
      }
    }

    res.status(201).json({ ...report, remindersCreated });
  } catch (error) {
    console.error('Error creating visit report:', error);
    res.status(500).json({ error: 'Failed to create visit report' });
  }
});

// ── Update (author or admin) ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.visitReport.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(existing, req.user)) return res.status(403).json({ error: '只有创建人或管理员可编辑' });
    const { title, visitDate, customerId, threadKey, summary, content, rawNotes, status, attachments } = req.body;
    let storedAttachments;
    if (attachments !== undefined) {
      const merged = mergeAttachmentUpdate(existing.attachments, attachments);
      const owned = imageAttachments(existing.attachments).map((item) => item.storedName);
      storedAttachments = await attachmentsFromClient(merged || [], {
        reportId: existing.id,
        ownedNames: owned,
      });
    }
    const report = await prisma.visitReport.update({
      where: { id: existing.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(visitDate !== undefined ? { visitDate: new Date(visitDate) } : {}),
        ...(customerId !== undefined ? { customerId: customerId ? parseInt(customerId) : null } : {}),
        ...(threadKey !== undefined ? { threadKey: threadKey || null } : {}),
        ...(summary !== undefined ? { summary: summary || null } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(rawNotes !== undefined ? { rawNotes: rawNotes || null } : {}),
        ...(status !== undefined ? { status: status === 'FINAL' ? 'FINAL' : 'DRAFT' } : {}),
        ...(attachments !== undefined ? { attachments: storedAttachments } : {}),
      },
    });
    // Keep this report's auto-created reminders in sync with its customer link —
    // otherwise reminders created before the customer was picked stay orphaned
    // and never show up in the customer's activity history.
    if (customerId !== undefined) {
      await prisma.event.updateMany({
        where: { visitReportId: report.id },
        data: { customerId: report.customerId },
      });
    }
    res.json(report);
  } catch (error) {
    console.error('Error updating visit report:', error);
    res.status(500).json({ error: 'Failed to update visit report' });
  }
});

// Original Word file, or a photo, only when this report lists that stored name.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
router.get('/:id/attachments/:storedName', async (req, res) => {
  try {
    const report = await prisma.visitReport.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!report) return res.status(404).json({ error: 'Not found' });
    const list = Array.isArray(report.attachments) ? report.attachments : [];
    const item = list.find((entry) => entry && entry.storedName === req.params.storedName);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const abs = resolveStoredFile(item.storedName, visitReportStorageRoot());
    if (!abs) return res.status(404).json({ error: 'Not found' });
    const buffer = await readFile(abs);
    const isDoc = item.kind === 'document' || /\.docx$/i.test(item.storedName);
    if (isDoc) {
      const safe = String(item.name || 'original.docx').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'original.docx';
      res.setHeader('Content-Type', DOCX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(buffer);
    }
    return sendImage(res, buffer, item.name || item.storedName, item.mimeType);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    console.error('Error reading visit report attachment:', error);
    return res.status(500).json({ error: 'Failed to load attachment' });
  }
});

// Saved photo, only if this report lists it. Same auth as reading the report.
router.get('/:id/photos/:storedName', async (req, res) => {
  try {
    const report = await prisma.visitReport.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!report) return res.status(404).json({ error: 'Not found' });
    const item = imageAttachments(report.attachments).find((photo) => photo.storedName === req.params.storedName);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const file = await readStoredImage(item.storedName);
    if (!file) return res.status(404).json({ error: 'Not found' });
    return sendImage(res, file.buffer, item.name || item.storedName, item.mimeType || file.mime);
  } catch (error) {
    console.error('Error reading visit report photo:', error);
    return res.status(500).json({ error: 'Failed to load photo' });
  }
});

// Explicit regenerate. Overwrites the caption and clears captionEdited.
router.post('/:id/photos/:storedName/caption', async (req, res) => {
  try {
    const report = await prisma.visitReport.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { customer: { select: { name: true } } },
    });
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(report, req.user)) return res.status(403).json({ error: '只有创建人或管理员可编辑' });
    const item = imageAttachments(report.attachments).find((photo) => photo.storedName === req.params.storedName);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const result = await captionStoredPhoto(item.storedName, {
      language: captionLanguage(report, report.rawNotes || ''),
      mimeType: item.mimeType,
      context: captionContext({
        customerName: report.customer?.name,
        visitDate: report.visitDate,
        draft: report,
      }),
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    const attachments = (Array.isArray(report.attachments) ? report.attachments : []).map((photo) => {
      if (!photo || photo.storedName !== item.storedName) return photo;
      const next = { ...photo, caption: result.caption };
      delete next.captionEdited;
      return next;
    });
    const updated = await prisma.visitReport.update({
      where: { id: report.id },
      data: { attachments },
    });
    return res.json({ caption: result.caption, attachments: updated.attachments });
  } catch (error) {
    console.error('Error regenerating visit report caption:', error);
    return res.status(500).json({ error: 'Failed to regenerate caption' });
  }
});

// ── Export to Word (.docx via pandoc) ───────────────────────────────────────────
const runPandoc = (mdPath, docxPath, cwd) =>
  new Promise((resolve, reject) => {
    execFile('pandoc', [mdPath, '-f', 'markdown', '-t', 'docx', '-o', docxPath], { cwd }, (err) =>
      err ? reject(err) : resolve());
  });

router.get('/:id/export', async (req, res) => {
  let work;
  try {
    work = await mkdtemp(join(tmpdir(), 'vr-export-'));
    const mdPath = join(work, 'report.md');
    const docxPath = join(work, 'report.docx');
    const report = await prisma.visitReport.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        customer: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
      },
    });
    if (!report) return res.status(404).json({ error: 'Not found' });

    const photos = [];
    const root = visitReportStorageRoot();
    for (const item of imageAttachments(report.attachments)) {
      const abs = resolveStoredFile(item.storedName, root);
      if (!abs) continue;
      try {
        const raw = await readFile(abs);
        let jpeg;
        try {
          jpeg = await fitImageForDocx(raw);
        } catch (err) {
          console.error('[visit-report] resize failed, skipping photo in export:', err.message);
          continue;
        }
        const filename = `photo-${photos.length + 1}.jpg`;
        await writeFile(join(work, filename), jpeg);
        photos.push({ caption: item.caption, name: item.name, markdownPath: filename });
      } catch (err) {
        console.error('[visit-report] export photo skipped:', err.message);
      }
    }

    await writeFile(mdPath, reportToMarkdown(report, { photos }), 'utf8');
    await runPandoc(mdPath, docxPath, work);
    const buf = await readFile(docxPath);

    const safe = (report.title || 'visit-report').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.docx"`);
    res.send(buf);
  } catch (error) {
    console.error('Error exporting visit report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  } finally {
    if (work) rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

// ── Delete (uploader or admin) ──────────────────────────────────────────────────
// Same lookup as GET, so a report you cannot see is a 404 and a report you can
// read but did not upload is a 403. Hard-delete: the row goes, attachment
// metadata goes with it, and any storedName blob under VISIT_REPORT_STORAGE_DIR
// is unlinked. Reminders stay; their visitReportId is set null by the schema.
router.delete('/:id', (req, res) => handleDeleteVisitReport(req, res, {
  findReport: (id) => prisma.visitReport.findUnique({ where: { id } }),
  removeRow: (reportId) => prisma.visitReport.delete({ where: { id: reportId } }),
  unlinkFile: (file) => unlink(file),
  storageRoot: visitReportStorageRoot(),
}));

export default router;
