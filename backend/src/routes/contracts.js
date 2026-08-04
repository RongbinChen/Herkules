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
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const STORAGE_DIR = process.env.CONTRACT_STORAGE_DIR || '/home/ubuntu/contract-files';
const TEAMS = new Set(['WRC', 'HRC']);
// Long enough to work through a customer without re-entering, short enough that
// a forgotten open tab is not a standing key.
const UNLOCK_TTL = '45m';
const MAX_FILE_BYTES = 40 * 1024 * 1024;

// Contracts arrive as documents, not archives or executables.
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp',
]);

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
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
  id: true, filename: true, mimeType: true, size: true, note: true, createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
};

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
        fs.unlink(path.join(STORAGE_DIR, req.file.filename), () => {});
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
          note: (req.body?.note || '').trim() || null,
          uploadedById: req.user.userId,
        },
        select: FILE_SELECT,
      });
      res.status(201).json(saved);
    } catch (error) {
      fs.unlink(path.join(STORAGE_DIR, req.file.filename), () => {});
      console.error('[contracts] upload error:', error.message);
      res.status(500).json({ error: 'Failed to save the file' });
    }
  });
});

router.get('/files/:id/download', authenticateToken, requireUnlock, async (req, res) => {
  try {
    const file = await prisma.contractFile.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!file || file.team !== req.contractTeam) return res.status(404).json({ error: 'Not found' });

    const abs = path.join(STORAGE_DIR, file.storedName);
    // storedName is generated, but check anyway — a path that resolves outside
    // the storage directory must never be streamed.
    if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep) || !fs.existsSync(abs)) {
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
    fs.unlink(path.join(STORAGE_DIR, file.storedName), () => {});
    res.status(204).end();
  } catch (error) {
    console.error('[contracts] delete error:', error.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

export default router;
