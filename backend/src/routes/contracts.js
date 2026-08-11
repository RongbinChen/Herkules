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
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Resolved once, and the only spelling of the storage path in this file. The
// download guard compares an absolute prefix, so a relative or trailing-slash
// value of CONTRACT_STORAGE_DIR used to make every download 404: the path being
// built and the path being compared were not the same string.
const STORAGE_ROOT = path.resolve(process.env.CONTRACT_STORAGE_DIR || '/home/ubuntu/contract-files');
const TEAMS = new Set(['WRC', 'HRC']);

// Mirrors the Prisma enum ContractDocType. Kept as a plain array so zod and the
// summary endpoint share one source of truth.
const DOC_TYPES = ['COMMERCIAL', 'TECHNICAL', 'QUOTATION', 'SAT', 'FAC', 'OTHER'];
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

    const row = await prisma.teamContractPin.findUnique({ where: { team } });
    if (!row) return res.status(409).json({ error: `No PIN has been set for ${team} yet. Ask an admin to set one.` });

    if (!(await bcrypt.compare(pin, row.pinHash))) {
      // Deliberately vague and deliberately slow-ish (bcrypt already is): do not
      // hint whether the team exists or how close the guess was.
      console.warn(`[contracts] failed unlock for ${team} by user ${req.user.userId}`);
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    const token = jwt.sign(
      { scope: 'contract', team, userId: req.user.userId },
      process.env.JWT_SECRET,
      { expiresIn: UNLOCK_TTL },
    );
    res.json({ token, team, expiresIn: UNLOCK_TTL });
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

router.put('/pin', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Admin only' });
    const team = String(req.body?.team || '').toUpperCase();
    const pin = String(req.body?.pin || '');
    if (!TEAMS.has(team)) return res.status(400).json({ error: 'team must be WRC or HRC' });
    if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });

    const pinHash = await bcrypt.hash(pin, 10);
    await prisma.teamContractPin.upsert({
      where: { team },
      create: { team, pinHash, updatedById: req.user.userId },
      update: { pinHash, updatedById: req.user.userId },
    });
    res.json({ team, message: 'PIN updated' });
  } catch (error) {
    console.error('[contracts] set pin error:', error.message);
    res.status(500).json({ error: 'Failed to update the PIN' });
  }
});

// Which teams have a PIN configured — safe to answer while locked, so the UI can
// say "ask an admin" instead of failing at the unlock step.
router.get('/pin-status', authenticateToken, async (_req, res) => {
  try {
    const rows = await prisma.teamContractPin.findMany({ select: { team: true } });
    res.json({ configured: rows.map((r) => r.team) });
  } catch (error) {
    console.error('[contracts] pin status error:', error.message);
    res.status(500).json({ error: 'Failed to read PIN status' });
  }
});

// ── Files (all require an unlock token) ──────────────────────────────────────

const FILE_SELECT = {
  id: true, docType: true, filename: true, mimeType: true, size: true, note: true, createdAt: true,
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
      res.status(201).json(saved);
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

export default router;
