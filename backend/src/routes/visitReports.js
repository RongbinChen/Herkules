import express from 'express';
import multer from 'multer';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { structureVisitReport } from '../services/visitReport.js';
import { ocrImage, isGeminiConfigured } from '../services/gemini.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authenticateToken);

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;
const canEdit = (report, user) => report.authorId === user.userId || user.isAdmin;

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
    res.json(reports);
  } catch (error) {
    console.error('Error listing visit reports:', error);
    res.status(500).json({ error: 'Failed to list visit reports' });
  }
});

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
    res.json({ ...report, canEdit: canEdit(report, req.user) });
  } catch (error) {
    console.error('Error fetching visit report:', error);
    res.status(500).json({ error: 'Failed to fetch visit report' });
  }
});

// ── AI generate (does NOT save) ────────────────────────────────────────────────
// multipart: images[] (optional photos) + rawNotes + customerId? + threadKey? + visitDate?
router.post('/generate', upload.array('images', 10), async (req, res) => {
  try {
    const { rawNotes = '', customerId, threadKey, visitDate } = req.body;
    const files = (req.files || []).filter((f) => IMAGE_RE.test(f.originalname || '') || (f.mimetype || '').startsWith('image/'));

    // OCR each photo → fold into the notes fed to the model.
    let ocrText = '';
    if (files.length > 0) {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ error: '图片识别未配置（服务器缺少 GEMINI_API_KEY）。可先只用文字随手记。' });
      }
      const parts = [];
      for (const f of files) {
        try {
          const t = await ocrImage(f.buffer, f.mimetype || 'image/jpeg');
          if (t) parts.push(`【照片：${f.originalname || 'image'}】\n${t}`);
        } catch (err) {
          console.error('[visit-report] OCR error:', err.message);
        }
      }
      ocrText = parts.join('\n\n');
    }

    const combined = [rawNotes.trim(), ocrText].filter(Boolean).join('\n\n');
    if (!combined) return res.status(400).json({ error: '请至少提供文字随手记或一张照片' });

    const { customerName, projectName } = await contextFor(
      customerId ? parseInt(customerId) : null, threadKey || null);
    const draft = await structureVisitReport(combined, { customerName, projectName, visitDate });
    res.json({ ...draft, rawNotes: combined });
  } catch (error) {
    if (error.isDeepSeek || error.isGemini) return res.status(502).json({ error: error.message });
    console.error('Error generating visit report:', error);
    res.status(500).json({ error: 'Failed to generate visit report' });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, visitDate, customerId, threadKey, summary, content, rawNotes, attachments, status, aiModel } = req.body;
    if (!title || !visitDate) return res.status(400).json({ error: 'title 与 visitDate 必填' });
    const report = await prisma.visitReport.create({
      data: {
        title,
        visitDate: new Date(visitDate),
        customerId: customerId ? parseInt(customerId) : null,
        threadKey: threadKey || null,
        authorId: req.user.userId,
        summary: summary || null,
        content: content ?? null,
        rawNotes: rawNotes || null,
        attachments: attachments ?? null,
        status: status === 'FINAL' ? 'FINAL' : 'DRAFT',
        aiModel: aiModel || null,
      },
    });
    res.status(201).json(report);
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
    const { title, visitDate, customerId, threadKey, summary, content, rawNotes, status } = req.body;
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
      },
    });
    res.json(report);
  } catch (error) {
    console.error('Error updating visit report:', error);
    res.status(500).json({ error: 'Failed to update visit report' });
  }
});

// ── Delete (author or admin) ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.visitReport.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(existing, req.user)) return res.status(403).json({ error: '只有创建人或管理员可删除' });
    await prisma.visitReport.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting visit report:', error);
    res.status(500).json({ error: 'Failed to delete visit report' });
  }
});

export default router;
