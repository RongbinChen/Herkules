// Contract files, gated by a per-team PIN.
//
// The PIN is verified here, not in the browser. Unlocking mints a short-lived
// token scoped to one team; every read, upload and download demands it. A
// front-end-only gate would still send the file list — and the files — to
// anyone who asked, which is not protection but the appearance of it.
//
// Files live outside the web root (CONTRACT_STORAGE_DIR) so nginx can never
// serve one directly; downloads always pass through this router.
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { wakeDgx } from '../services/dgxWake.js';
import { answerContractQuestion, DgxOfflineError } from '../services/contractQa.js';
import { embedPagesForFile } from '../services/contractEmbeddings.js';
import { summariseContractFile } from '../services/contractSummary.js';
import { sendMail } from '../services/mailer.js';
import { renderEmail } from '../services/emailTemplate.js';

const router = express.Router();

// Resolved once, and the only spelling of the storage path in this file. The
// download guard compares an absolute prefix, so a relative or trailing-slash
// value of CONTRACT_STORAGE_DIR used to make every download 404: the path being
// built and the path being compared were not the same string.
const STORAGE_ROOT = path.resolve(process.env.CONTRACT_STORAGE_DIR || '/home/ubuntu/contract-files');
const TEAMS = new Set(['WRC', 'HRC']);

// The master PIN lets an admin open either team with one password. It lives in
// the same TeamContractPin table under the UserTeam member nothing else uses —
// `OTHER` is not in TEAMS, so no unlock can ever mint a token for it and no
// ContractFile can ever be filed under it. Reusing the slot keeps this a
// deploy-safe change: a new model would stop the pipeline for a manual pass
// over the VPS. The API says MASTER; only storage says OTHER.
const MASTER_SLOT = 'OTHER';
// Longer than a team PIN's 4 because one guess opens everything.
const MASTER_MIN_LEN = 8;

// Mirrors the Prisma enum ContractDocType. Kept as a plain array so zod and the
// summary endpoint share one source of truth.
const DOC_TYPES = ['COMMERCIAL', 'TECHNICAL', 'QUOTATION', 'FAT', 'FAC', 'OTHER'];
const docTypeSchema = z.enum(DOC_TYPES);
// Long enough to work through a customer without re-entering, short enough that
// a forgotten open tab is not a standing key.
const UNLOCK_TTL = '45m';
const MAX_FILE_BYTES = 40 * 1024 * 1024;

// Contracts arrive as documents, not archives or executables.
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp',
]);

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_ROOT),
    // The stored name is generated, never taken from the upload: a filename
    // like "../../etc/passwd" must not be able to decide where bytes land.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`File type ${ext || '(none)'} is not accepted`));
    cb(null, true);
  },
});

// ── Unlock ───────────────────────────────────────────────────────────────────

router.post('/unlock', authenticateToken, async (req, res) => {
  try {
    const team = String(req.body?.team || '').toUpperCase();
    const pin = String(req.body?.pin || '');
    if (!TEAMS.has(team)) return res.status(400).json({ error: 'team must be WRC or HRC' });
    if (!pin) return res.status(400).json({ error: 'PIN is required' });

    // The master PIN is only ever fetched for an admin, so for everyone else
    // this route behaves exactly as it did before — same queries, same replies.
    const isAdmin = req.user.isAdmin === true;
    const [row, master] = await Promise.all([
      prisma.teamContractPin.findUnique({ where: { team } }),
      isAdmin ? prisma.teamContractPin.findUnique({ where: { team: MASTER_SLOT } }) : null,
    ]);
    if (!row && !master) {
      return res.status(409).json({ error: `No PIN has been set for ${team} yet. Ask an admin to set one.` });
    }

    let via = null;
    if (row && await bcrypt.compare(pin, row.pinHash)) via = 'team';
    else if (master && await bcrypt.compare(pin, master.pinHash)) via = 'master';

    if (!via) {
      // Deliberately vague and deliberately slow-ish (bcrypt already is): do not
      // hint whether the team exists, whether a master PIN exists, or how close
      // the guess was. A non-admin typing the master PIN lands here too.
      console.warn(`[contracts] failed unlock for ${team} by user ${req.user.userId}`);
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    // Worth a line in the log: one credential opening any team should be
    // attributable after the fact.
    if (via === 'master') console.warn(`[contracts] master unlock for ${team} by admin ${req.user.userId}`);

    // The token still covers exactly ONE team no matter which PIN opened it, so
    // `where.team = req.contractTeam` downstream stays the whole story. A master
    // unlock is a second key to the same door, not a wider door.
    const token = jwt.sign(
      { scope: 'contract', team, userId: req.user.userId, via },
      process.env.JWT_SECRET,
      { expiresIn: UNLOCK_TTL },
    );
    res.json({ token, team, via, expiresIn: UNLOCK_TTL });
  } catch (error) {
    console.error('[contracts] unlock error:', error.message);
    res.status(500).json({ error: 'Unlock failed' });
  }
});

// Requires a valid unlock token and pins req.contractTeam to the team it covers.
function requireUnlock(req, res, next) {
  const raw = req.headers['x-contract-token'];
  if (!raw) return res.status(401).json({ error: 'locked' });
  try {
    const payload = jwt.verify(String(raw), process.env.JWT_SECRET);
    if (payload.scope !== 'contract' || !TEAMS.has(payload.team)) {
      return res.status(401).json({ error: 'locked' });
    }
    // The unlock is tied to the account that performed it, so a token cannot be
    // passed to a colleague who never entered the PIN.
    if (payload.userId !== req.user.userId) return res.status(401).json({ error: 'locked' });
    req.contractTeam = payload.team;
    next();
  } catch {
    res.status(401).json({ error: 'locked' });
  }
}

// ── Admin: set or change a team's PIN ─────────────────────────────────────────

// `team` is WRC, HRC, or MASTER. Setting MASTER again rotates it; there is no
// separate revoke, because replacing the PIN already invalidates the old one.
router.put('/pin', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Admin only' });
    const team = String(req.body?.team || '').toUpperCase();
    const pin = String(req.body?.pin || '');
    const isMaster = team === 'MASTER';
    if (!isMaster && !TEAMS.has(team)) return res.status(400).json({ error: 'team must be WRC, HRC or MASTER' });

    const minLen = isMaster ? MASTER_MIN_LEN : 4;
    if (pin.length < minLen) {
      return res.status(400).json({ error: `${isMaster ? 'The master PIN' : 'PIN'} must be at least ${minLen} characters` });
    }

    const slot = isMaster ? MASTER_SLOT : team;
    const pinHash = await bcrypt.hash(pin, 10);
    await prisma.teamContractPin.upsert({
      where: { team: slot },
      create: { team: slot, pinHash, updatedById: req.user.userId },
      update: { pinHash, updatedById: req.user.userId },
    });
    console.warn(`[contracts] ${isMaster ? 'MASTER' : team} PIN set by admin ${req.user.userId}`);
    res.json({ team, message: isMaster ? 'Master PIN updated' : 'PIN updated' });
  } catch (error) {
    console.error('[contracts] set pin error:', error.message);
    res.status(500).json({ error: 'Failed to update the PIN' });
  }
});

// Which teams have a PIN configured — safe to answer while locked, so the UI can
// say "ask an admin" instead of failing at the unlock step.
router.get('/pin-status', authenticateToken, async (req, res) => {
  try {
    const rows = await prisma.teamContractPin.findMany({ select: { team: true } });
    // Whether a master PIN exists is only told to admins — nobody else can use
    // it, and its existence is not something the rest of the staff needs to know.
    res.json({
      configured: rows.map((r) => r.team).filter((t) => TEAMS.has(t)),
      master: req.user.isAdmin === true ? rows.some((r) => r.team === MASTER_SLOT) : undefined,
    });
  } catch (error) {
    console.error('[contracts] pin status error:', error.message);
    res.status(500).json({ error: 'Failed to read PIN status' });
  }
});

// ── Files (all require an unlock token) ──────────────────────────────────────

const FILE_SELECT = {
  id: true, docType: true, filename: true, mimeType: true, size: true, note: true, createdAt: true,
  // Whether the file has been read yet. Surfaced so the UI can say "still
  // being read" instead of letting the assistant answer from nothing and look
  // like it is wrong about the contract.
  ocrStatus: true, ocrPages: true,
  // Only the timestamp travels with a list row — the summary body is a
  // kilobyte apiece and is fetched when someone actually opens one.
  summaryAt: true,
  uploadedBy: { select: { id: true, name: true } },
};

// The cross-customer list needs the customer's name; the per-customer list
// already knows it from the page it is on.
const LIST_SELECT = { ...FILE_SELECT, customer: { select: { id: true, name: true } } };

router.get('/customer/:customerId', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const files = await prisma.contractFile.findMany({
      where: { customerId: parseInt(req.params.customerId, 10), team: req.contractTeam },
      orderBy: { createdAt: 'desc' },
      select: FILE_SELECT,
    });
    res.json(files);
  } catch (error) {
    console.error('[contracts] list error:', error.message);
    res.status(500).json({ error: 'Failed to list contract files' });
  }
});

router.post('/customer/:customerId', authenticateToken, requireUnlock, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    try {
      const customerId = parseInt(req.params.customerId, 10);
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) {
        fs.unlink(path.join(STORAGE_ROOT, req.file.filename), () => {});
        return res.status(404).json({ error: 'Customer not found' });
      }
      const saved = await prisma.contractFile.create({
        data: {
          customerId,
          team: req.contractTeam,
          // Browsers send latin1-decoded bytes for non-ASCII names; re-read them
          // as UTF-8 so Chinese filenames survive the round trip.
          filename: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
          storedName: req.file.filename,
          mimeType: req.file.mimetype || null,
          size: req.file.size,
          // An unrecognised or absent value falls back to OTHER rather than
          // rejecting the upload: the bytes are already on disk by this point,
          // and a mislabelled file is fixable through PATCH while a lost upload
          // is not.
          docType: docTypeSchema.catch('OTHER').parse(req.body?.docType),
          note: (req.body?.note || '').trim().slice(0, 500) || null,
          uploadedById: req.user.userId,
        },
        select: FILE_SELECT,
      });
      // Answer the browser first, then poke the DGX. The upload is complete
      // either way — the row is queued as PENDING by default, so a DGX that is
      // off just means the file is read later, not never.
      res.status(201).json(saved);
      wakeDgx(`upload:${saved.id}`).catch(() => {});
    } catch (error) {
      fs.unlink(path.join(STORAGE_ROOT, req.file.filename), () => {});
      console.error('[contracts] upload error:', error.message);
      res.status(500).json({ error: 'Failed to save the file' });
    }
  });
});

// ── Cross-customer list, for the standalone Contracts module ─────────────────

const listQuerySchema = z.object({
  docType: docTypeSchema.optional(),
  customerId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  // Paginated from the start. This is the one list here that grows without
  // bound, and retrofitting pagination later means changing a contract the
  // frontend already depends on.
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/files', authenticateToken, requireUnlock, async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid query', details: parsed.error.issues.slice(0, 3) });
  }
  const { docType, customerId, q, limit, offset } = parsed.data;
  try {
    // team comes from the unlock token and is never read from the query. This
    // single line is what stops a WRC session from listing HRC's contracts.
    const where = {
      team: req.contractTeam,
      ...(docType ? { docType } : {}),
      ...(customerId ? { customerId } : {}),
      ...(q ? {
        OR: [
          { filename: { contains: q, mode: 'insensitive' } },
          { note: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.contractFile.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, select: LIST_SELECT }),
      prisma.contractFile.count({ where }),
    ]);
    res.json({ items, total, limit, offset });
  } catch (error) {
    console.error('[contracts] list all error:', error.message);
    res.status(500).json({ error: 'Failed to list contract files' });
  }
});

// Counts per category, so the filter chips can show numbers instead of making
// people click each one to find out it is empty.
router.get('/files/summary', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const rows = await prisma.contractFile.groupBy({
      by: ['docType'],
      where: { team: req.contractTeam },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(DOC_TYPES.map((t) => [t, 0]));
    for (const r of rows) counts[r.docType] = r._count._all;
    res.json({ team: req.contractTeam, total: rows.reduce((n, r) => n + r._count._all, 0), counts });
  } catch (error) {
    console.error('[contracts] summary error:', error.message);
    res.status(500).json({ error: 'Failed to summarise contract files' });
  }
});

// The customers that actually have contracts on file, for this team. Feeds the
// Ask-AI picker: there is no point offering the other ~500 customers when a
// question can only be answered from a customer that has files. `readable` is
// how many of those files the DGX has already transcribed — a customer with 0
// readable can be picked but cannot be answered yet.
router.get('/customers', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const [all, done] = await Promise.all([
      prisma.contractFile.groupBy({ by: ['customerId'], where: { team: req.contractTeam }, _count: { _all: true } }),
      prisma.contractFile.groupBy({ by: ['customerId'], where: { team: req.contractTeam, ocrStatus: 'DONE' }, _count: { _all: true } }),
    ]);
    const readableById = new Map(done.map((r) => [r.customerId, r._count._all]));
    const ids = all.map((r) => r.customerId);
    const customers = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameById = new Map(customers.map((c) => [c.id, c.name]));
    const items = all
      .map((r) => ({
        id: r.customerId,
        name: nameById.get(r.customerId) || `#${r.customerId}`,
        files: r._count._all,
        readable: readableById.get(r.customerId) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ team: req.contractTeam, items });
  } catch (error) {
    console.error('[contracts] customers error:', error.message);
    res.status(500).json({ error: 'Failed to list contract customers' });
  }
});

// Fix a wrong category or note. Picking the wrong type on upload is a certainty,
// and without this the only remedy is delete-and-reupload, which throws away the
// upload record and timestamp.
const patchSchema = z.object({
  docType: docTypeSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine((v) => v.docType !== undefined || v.note !== undefined, { message: 'Nothing to update' });

router.patch('/files/:id', authenticateToken, requireUnlock, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid payload', details: parsed.error.issues.slice(0, 3) });
  }
  try {
    const file = await prisma.contractFile.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    // 404 rather than 403 across teams, matching download and delete: whether a
    // given id exists is itself something the other team should not learn.
    if (!file || file.team !== req.contractTeam) return res.status(404).json({ error: 'Not found' });
    if (req.user.isAdmin !== true && file.uploadedById !== req.user.userId) {
      return res.status(403).json({ error: 'Only the uploader or an admin can edit this file' });
    }
    const data = {};
    if (parsed.data.docType !== undefined) data.docType = parsed.data.docType;
    if (parsed.data.note !== undefined) data.note = parsed.data.note || null;
    const updated = await prisma.contractFile.update({ where: { id: file.id }, data, select: FILE_SELECT });
    res.json(updated);
  } catch (error) {
    console.error('[contracts] patch error:', error.message);
    res.status(500).json({ error: 'Failed to update the file' });
  }
});

router.get('/files/:id/download', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const file = await prisma.contractFile.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!file || file.team !== req.contractTeam) return res.status(404).json({ error: 'Not found' });

    const abs = path.join(STORAGE_ROOT, file.storedName);
    // storedName is generated, but check anyway — a path that resolves outside
    // the storage directory must never be streamed.
    if (!abs.startsWith(STORAGE_ROOT + path.sep) || !fs.existsSync(abs)) {
      return res.status(404).json({ error: 'File missing on disk' });
    }
    res.download(abs, file.filename);
  } catch (error) {
    console.error('[contracts] download error:', error.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

router.delete('/files/:id', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const file = await prisma.contractFile.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!file || file.team !== req.contractTeam) return res.status(404).json({ error: 'Not found' });
    if (req.user.isAdmin !== true && file.uploadedById !== req.user.userId) {
      return res.status(403).json({ error: 'Only the uploader or an admin can delete this file' });
    }
    await prisma.contractFile.delete({ where: { id: file.id } });
    // The row is the record of truth; a leftover blob is harmless, a missing row
    // with a live file is not. Delete the bytes after, best effort.
    fs.unlink(path.join(STORAGE_ROOT, file.storedName), () => {});
    res.status(204).end();
  } catch (error) {
    console.error('[contracts] delete error:', error.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── Ask AI about one customer's contracts ────────────────────────────────────
//
// Scoped to a single customer on purpose (see the memory note): a cross-customer
// search would need a vector store and would have to reason about the PIN
// boundary all over again. Here the boundary is the same one line as every other
// read — where.team is the unlock token's team, and the customerId is checked to
// belong to it — so a WRC session can only ever ask about WRC's files.
//
// The heavy work (rendering pages, running the vision model) happens on the DGX
// through the reverse tunnel. This route only locates the pages and relays the
// question; the answer is read off the original page images, never off the
// lossy transcription. When the DGX is offline it says so rather than guessing.
const askSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  question: z.string().trim().min(2).max(500),
  // Prior turns of this conversation, for follow-up questions. Capped and
  // trimmed: only the last few turns matter for resolving a reference, and a
  // long answer is truncated so the history cannot blow the model's context.
  history: z.array(z.object({
    question: z.string().trim().max(500),
    answer: z.string().trim().max(4000),
  })).max(8).optional().default([]),
});

router.post('/ask', authenticateToken, requireUnlock, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid payload', details: parsed.error.issues.slice(0, 3) });
  }
  const { customerId, question } = parsed.data;
  try {
    // The customer must belong to this team's files, checked the same way a
    // cross-team id is handled everywhere else: 404, because whether the id
    // exists is itself not the other team's business. A customer with no files
    // under this team simply has nothing to answer from.
    const has = await prisma.contractFile.findFirst({
      where: { customerId, team: req.contractTeam },
      select: { id: true },
    });
    if (!has) return res.status(404).json({ error: 'No contracts for this customer' });

    const result = await answerContractQuestion({ customerId, team: req.contractTeam, question, history: parsed.data.history.slice(-6) });
    res.json(result);
  } catch (error) {
    if (error instanceof DgxOfflineError) {
      // 503, and flagged, so the UI can show "the local model is offline" rather
      // than a generic failure — and crucially so it does NOT retry against the
      // text, which is the path that misreads a spec table.
      return res.status(503).json({ error: error.message, offline: true });
    }
    console.error('[contracts] ask error:', error.message);
    res.status(500).json({ error: 'Failed to answer' });
  }
});

// Key-terms summary of one file — contract number, parties, value, payment,
// delivery, warranty. Cached on the row, so the second reader pays nothing.
//
// POST rather than GET because the uncached path spends a minute of GPU: it is
// an action someone chose to take, not something a list render should trigger.
// `refresh` re-runs it, and is restricted to the uploader or an admin for the
// same reason — anyone may read the summary, but re-spending the GPU is not a
// decision every viewer should be able to make on someone else's file.
router.post('/files/:id/summary', authenticateToken, requireUnlock, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const refresh = req.body?.refresh === true;

  try {
    if (refresh) {
      const file = await prisma.contractFile.findFirst({
        where: { id, team: req.contractTeam },
        select: { uploadedById: true },
      });
      if (!file) return res.status(404).json({ error: 'File not found' });
      if (req.user.isAdmin !== true && file.uploadedById !== req.user.userId) {
        return res.status(403).json({ error: 'Only the uploader or an admin can regenerate' });
      }
    }

    const result = await summariseContractFile({ fileId: id, team: req.contractTeam, refresh });
    // 404 for a file this team cannot see, matching download / patch / delete:
    // whether the id exists is not the other team's business.
    if (!result) return res.status(404).json({ error: 'File not found' });
    res.json(result);
  } catch (error) {
    if (error instanceof DgxOfflineError) {
      return res.status(503).json({ error: error.message, offline: true });
    }
    console.error('[contracts] summary error:', error.message);
    res.status(500).json({ error: 'Failed to summarise' });
  }
});

// ── Transcription pause control (one owner only) ─────────────────────────────
//
// OCR transcription and Q&A share one worker and one GPU on the DGX. Pausing
// transcription frees the GPU for fast answers without taking the worker (and
// thus Q&A) down. This is an operator control, deliberately restricted to a
// single person — NOT all admins — so it is gated on the exact account rather
// than on isAdmin. No PIN/unlock: it touches no contract data, only the queue.
const OCR_ADMIN_EMAIL = (process.env.CONTRACT_OCR_ADMIN_EMAIL || 'rongbin.chen@waldrich-siegen.com').toLowerCase();
// The worker's loopback port, reached over the same reverse tunnel Q&A uses.
const DGX_OCR_BASE = (process.env.DGX_OCR_URL || 'http://127.0.0.1:9099').replace(/\/$/, '');

function requireOcrAdmin(req, res, next) {
  if (String(req.user?.email || '').toLowerCase() !== OCR_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Not permitted' });
  }
  next();
}

// Relay a control call to the DGX worker. Returns the worker's JSON, or throws
// so the route can answer 503 when the DGX is unreachable (tunnel down / off).
async function dgxOcrControl(pathname, method = 'GET') {
  const token = process.env.OCR_TOKEN;
  if (!token || token.length < 16) throw new DgxOfflineError('OCR control is not configured');
  let res;
  try {
    res = await fetch(`${DGX_OCR_BASE}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Ocr-Token': token },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new DgxOfflineError(`worker unreachable (${err.name})`);
  }
  if (!res.ok) throw new Error(`worker returned ${res.status}`);
  return res.json();
}

router.get('/ocr/control', authenticateToken, requireOcrAdmin, async (req, res) => {
  try {
    const h = await dgxOcrControl('/health', 'GET');
    res.json({ paused: h.paused === true, draining: h.draining === true, online: true });
  } catch (error) {
    // The worker being offline is a normal, reportable state, not a 500 — the
    // button shows "worker offline" rather than an error.
    if (error instanceof DgxOfflineError) return res.json({ online: false });
    console.error('[contracts] ocr status error:', error.message);
    res.status(500).json({ error: 'Failed to read status' });
  }
});

router.post('/ocr/control', authenticateToken, requireOcrAdmin, async (req, res) => {
  const action = req.body?.action;
  if (action !== 'pause' && action !== 'resume') {
    return res.status(400).json({ error: 'action must be pause or resume' });
  }
  try {
    const out = await dgxOcrControl(`/${action}`, 'POST');
    console.warn(`[contracts] transcription ${action} by ${req.user.email}`);
    res.json({ paused: out.paused === true });
  } catch (error) {
    if (error instanceof DgxOfflineError) {
      return res.status(503).json({ error: 'The DGX worker is offline — cannot change transcription.', offline: true });
    }
    console.error('[contracts] ocr control error:', error.message);
    res.status(500).json({ error: `Failed to ${action}` });
  }
});

export default router;

// ── OCR queue (machine endpoints, worker token — NOT the PIN) ────────────────
//
// Every contract on file is a scanned image with no text layer, so a person
// searching for "质保期" finds nothing and the assistant has nothing to read.
// The DGX transcribes them with a local vision model and posts the text back.
//
// SECURITY — read this before adding an endpoint here.
//
// These routes bypass the team PIN, because a machine has no PIN to type. That
// makes the worker token a second key to the same cupboard, so the endpoints
// are deliberately built to be worth stealing as little as possible:
//
//   1. NO FILE BYTES EVER LEAVE THROUGH THIS DOOR. The queue hands out ids and
//      stored names, never content. The worker already has the files: the
//      nightly backup rsyncs the whole directory over SSH, an authorised path
//      that predates this feature. Adding an HTTP route that served contract
//      PDFs to a bearer token would have been a real PIN bypass; pointing the
//      worker at a channel it already has is not.
//   2. THE TEXT GOES IN, BUT NEVER COMES BACK OUT HERE. Transcriptions are
//      read only through the PIN-guarded routes above. This door is write-only
//      by design.
//   3. A SEPARATE TOKEN. Not INGEST_TOKEN — that one is for tender scraping and
//      lives in the same .env, but one leaked secret should not open both.

function requireOcrToken(req, res, next) {
  const expected = process.env.OCR_TOKEN;
  // Fail closed: an unset value must not be comparable to an absent header.
  if (!expected || expected.length < 16) {
    console.warn('[ocr] queue hit but OCR_TOKEN is not configured');
    return res.status(503).json({ error: 'ocr not configured' });
  }
  const got = Buffer.from(String(req.get('X-Ocr-Token') || ''));
  const want = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so length is compared first.
  // That leaks the length, which is not the secret.
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    console.warn(`[ocr] queue rejected: bad token from ${req.ip}`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// What still needs reading. Returns metadata only — the worker resolves
// storedName against its own copy of the files.
router.get('/ocr/pending', requireOcrToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const items = await prisma.contractFile.findMany({
      where: { ocrStatus: 'PENDING' },
      // Smallest first: a 1-page quotation should not wait behind a 174-page
      // technical appendix, and early results make the queue visibly moving.
      orderBy: [{ size: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, storedName: true, filename: true, mimeType: true, size: true, ocrAttempt: true },
    });
    const pending = await prisma.contractFile.count({ where: { ocrStatus: 'PENDING' } });
    res.json({ items, pending });
  } catch (error) {
    console.error('[ocr] pending failed:', error.message);
    res.status(500).json({ error: 'failed to list pending' });
  }
});

// Claim before working, so two workers (or a retry racing the original) cannot
// both transcribe the same file. The attempt counter returned here has to come
// back with the result.
router.post('/ocr/claim/:id', requireOcrToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    // Conditional update: only PENDING rows can be claimed, and the count tells
    // us whether we won. Read-then-write would leave a gap for a second worker.
    const claimed = await prisma.contractFile.updateMany({
      where: { id, ocrStatus: 'PENDING' },
      data: { ocrStatus: 'RUNNING', ocrError: null, ocrAttempt: { increment: 1 } },
    });
    if (claimed.count === 0) return res.status(409).json({ error: 'already claimed or not pending' });
    const file = await prisma.contractFile.findUnique({
      where: { id },
      select: { id: true, storedName: true, filename: true, ocrAttempt: true },
    });
    res.json(file);
  } catch (error) {
    console.error('[ocr] claim failed:', error.message);
    res.status(500).json({ error: 'claim failed' });
  }
});

const ocrResultSchema = z.object({
  attempt: z.number().int().positive(),
  pages: z.array(z.object({
    pageNo: z.number().int().positive(),
    text: z.string().max(200000),
  })).max(2000),
  error: z.string().max(2000).nullable().optional(),
  skipped: z.boolean().optional(),
});

router.post('/ocr/result/:id', requireOcrToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const parsed = ocrResultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'bad result', detail: parsed.error.issues.slice(0, 3) });
    const { attempt, pages, error, skipped } = parsed.data;

    const file = await prisma.contractFile.findUnique({ where: { id }, select: { ocrAttempt: true } });
    if (!file) return res.status(404).json({ error: 'not found' });
    // A result from an abandoned attempt (worker restarted, file re-queued) must
    // not overwrite a newer pass that is already running or finished.
    if (file.ocrAttempt !== attempt) {
      console.warn(`[ocr] stale result for file ${id}: attempt ${attempt}, current ${file.ocrAttempt}`);
      return res.status(409).json({ error: 'stale attempt' });
    }

    if (error) {
      await prisma.contractFile.update({
        where: { id },
        data: { ocrStatus: 'FAILED', ocrError: error.slice(0, 2000), ocrAt: new Date() },
      });
      return res.json({ ok: true, status: 'FAILED' });
    }

    // Replace rather than merge: a re-run is the authority on the whole file,
    // and leaving stale pages behind would mix two transcriptions of one page.
    await prisma.$transaction([
      prisma.contractPage.deleteMany({ where: { fileId: id } }),
      prisma.contractPage.createMany({
        data: pages.map((p) => ({ fileId: id, pageNo: p.pageNo, text: p.text })),
      }),
      prisma.contractFile.update({
        where: { id },
        data: {
          ocrStatus: skipped ? 'SKIPPED' : 'DONE',
          ocrPages: pages.length,
          ocrError: null,
          ocrAt: new Date(),
        },
      }),
    ]);
    // Answer the worker first, then embed the new pages for semantic search.
    // Best-effort and fire-and-forget: a page with no embedding still answers
    // via keyword retrieval, and the backfill script catches any that were
    // missed here (embed worker busy, tunnel flapping).
    res.json({ ok: true, status: skipped ? 'SKIPPED' : 'DONE', pages: pages.length });
    if (!skipped && pages.length) {
      embedPagesForFile(prisma, id)
        .catch((e) => console.warn(`[ocr] auto-embed file ${id} failed: ${e.message}`));
    }
  } catch (error) {
    console.error('[ocr] result failed:', error.message);
    res.status(500).json({ error: 'result failed' });
  }
});

// The worker says when it has emptied the queue. The VPS decides whether that
// is worth an email, because only the VPS has the mailer and the admin list —
// and duplicating SMTP credentials onto the DGX to save one request would be a
// second copy of a secret for no gain.
const drainedSchema = z.object({
  processed: z.number().int().min(0),
  pages: z.number().int().min(0),
  failed: z.number().int().min(0),
  elapsedMs: z.number().int().min(0),
});

router.post('/ocr/drained', requireOcrToken, async (req, res) => {
  const parsed = drainedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad summary' });
  const { processed, pages, failed, elapsedMs } = parsed.data;
  // Answer immediately: the worker should not wait on SMTP.
  res.json({ ok: true });

  try {
    // A pass that did nothing is the normal idle case — the worker only reports
    // after real work, but check anyway rather than trusting the caller.
    if (processed === 0) return;
    const [pending, stuck, admins] = await Promise.all([
      prisma.contractFile.count({ where: { ocrStatus: 'PENDING' } }),
      prisma.contractFile.count({ where: { ocrStatus: 'FAILED' } }),
      prisma.user.findMany({ where: { isAdmin: true }, select: { email: true } }),
    ]);
    // Still work left means this was a pause, not a finish — no mail for that.
    if (pending > 0) return;

    const to = admins.map((a) => a.email).filter(Boolean).join(',');
    if (!to) return;

    const hours = elapsedMs / 3600000;
    const spent = hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(elapsedMs / 60000)} min`;
    const mail = renderEmail({
      tone: failed > 0 ? 'alert' : 'info',
      title: {
        en: 'Contract files are now readable',
        zh: '合同文件已识别完成',
      },
      intro: {
        en: `${processed} file${processed > 1 ? 's' : ''} finished reading. Their text is searchable now, and the assistant can answer from them.`,
        zh: `${processed} 个文件识别完成。文字已可检索，助手也能据此回答了。`,
      },
      facts: [
        { k: { en: 'Files read', zh: '识别文件数' }, v: String(processed) },
        { k: { en: 'Pages', zh: '页数' }, v: String(pages) },
        { k: { en: 'Time taken', zh: '耗时' }, v: spent },
        ...(failed > 0 ? [{ k: { en: 'Failed', zh: '失败' }, v: String(failed) }] : []),
        ...(stuck > 0 ? [{ k: { en: 'Needs attention', zh: '待处理' }, v: `${stuck} file(s) in FAILED` }] : []),
      ],
      action: { label: { en: 'Open Contracts', zh: '打开合同模块' }, url: 'https://www.herkulesgroup-china.com/contracts' },
      note: stuck > 0
        ? {
            en: 'Files marked FAILED were not read. Re-queue them by setting ocrStatus back to PENDING; the worker picks them up on its own.',
            zh: '标记为 FAILED 的文件没有读成功。把 ocrStatus 改回 PENDING 即可重新排队，worker 会自己领走。',
          }
        : {
            en: 'Reading runs on the DGX with a local model — the files themselves never leave the company.',
            zh: '识别在 DGX 上用本地模型完成，文件本身不出公司。',
          },
    });
    await sendMail({
      to,
      subject: `[Herkules] Contract files readable / 合同识别完成 — ${processed} files, ${pages} pages`,
      text: mail.text,
      html: mail.html,
    });
  } catch (error) {
    // Never surface this to the worker: the transcription already landed, and a
    // mail failure must not make a successful pass look failed.
    console.error('[ocr] drained notification failed:', error.message);
  }
});
