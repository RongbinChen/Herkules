import express from 'express';
import {
  scrapeProjects, getProjectStats, searchByKeyword, searchAndSave, searchLocalDb,
  startScrapeJob, getScrapeJob, listScrapeJobs,
  listSavedSearches, createSavedSearch, deleteSavedSearch, updateSavedSearch, runSavedSearch,
  runDailyJob, getRecentUpdates,
  getProjectThread, followProject, unfollowProject, listFollows,
  listProjectThreads, upsertBidTracking,
  listNotifications, markNotificationRead, markAllNotificationsRead,
  getTrends, generateTrendReport, backfillStructured,
  listCompetitors, seedCompetitors,
  ingestFromRunner, lastDgxIngest,
} from '../services/chinabidding.js';
import { authenticateToken } from '../middleware/auth.js';
import multer from 'multer';
import { prisma } from '../index.js';
import { xlsxToText, extractBidOpenings, translateBidOpening, parseOpenDate } from '../services/bidOpening.js';
import { extractBidOpeningsFromImage, isGeminiConfigured } from '../services/gemini.js';
import { isEmailConfigured } from '../services/mailer.js';
import { randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';

const router = express.Router();

// In-memory upload for bid-opening Excel files (parsed immediately, not kept on disk).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // room for phone photos
});

const shareToken = () => randomBytes(20).toString('hex');

// ── PUBLIC: shared bid-opening record (no login) ─────────────────────────────
// Defined BEFORE the auth middleware so anyone with the token can view it.
router.get('/bidopen/share/:token', async (req, res) => {
  try {
    const rec = await prisma.bidOpening.findUnique({
      where: { shareToken: req.params.token },
      select: {
        projectName: true, biddingNo: true, openDate: true, purchaser: true,
        bidders: true, fileName: true, createdAt: true,
      },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    res.json(rec);
  } catch (error) {
    console.error('Error loading shared bid opening:', error);
    res.status(500).json({ error: 'Failed to load shared record' });
  }
});

// ── MACHINE: ingest from the DGX scrape runner (token auth, no user session) ──
// Defined BEFORE the auth middleware: the runner is a machine, it has no user
// account and must not need one. A dedicated single-purpose token can be
// rotated without touching anybody's login, and leaking it exposes exactly this
// endpoint rather than somebody's whole account.

const analysisSchema = z.object({
  relevant: z.boolean(),
  reason: z.string().max(1000).default(''),
  summary: z.string().max(4000).default(''),
  purchaser: z.string().max(500).nullable().default(null),
  winner: z.string().max(500).nullable().default(null),
  winningPrice: z.string().max(200).nullable().default(null),
  equipmentType: z.string().max(120).nullable().default(null),
});

// Mirrors what parseDetailPage() produces on the runner side. Unknown keys are
// stripped rather than passed through — this object is spread straight into a
// Prisma create, so an unexpected field would be a 500 at best.
const detailSchema = z.object({
  projectName: z.string().max(1000).nullable().optional(),
  projectCode: z.string().max(300).nullable().optional(),
  region: z.string().max(300).nullable().optional(),
  industry: z.string().max(300).nullable().optional(),
  biddingType: z.enum(['NEW', 'PAST']).nullable().optional(),
  publishDate: z.coerce.date().nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  budget: z.string().max(300).nullable().optional(),
  status: z.enum(['PUBLISHED', 'CLOSED', 'CANCELLED']).nullable().optional(),
  rawContent: z.string().max(40000).nullable().optional(),
}).strip();

const ingestSchema = z.object({
  runId: z.string().max(100).optional(),
  egressIp: z.string().max(60).optional(),
  // How many notices the runner actually judged. `projects` carries only the
  // ones that survived, so without this the job record would report a busy run
  // as a tiny one.
  scanned: z.number().int().min(0).max(1000000).optional(),
  // One-time historical import: store the rows, notify nobody. See upsertProject.
  backfill: z.boolean().optional(),
  // 400 is comfortably above a real day's volume (~100) and far below anything
  // that would tie the event loop up for minutes on a single request.
  projects: z.array(z.object({
    sourceUrl: z.string().url().max(1000),
    projectName: z.string().max(1000).nullable().optional(),
    biddingType: z.enum(['NEW', 'PAST']).nullable().optional(),
    listDate: z.string().max(60).nullable().optional(),
    tenderTypeLabel: z.string().max(200).nullable().optional(),
    detail: detailSchema.nullable().optional(),
    analysis: analysisSchema.nullable().optional(),
  })).max(400),
});

function requireIngestToken(req, res, next) {
  const expected = process.env.INGEST_TOKEN;
  // Absent config must fail closed. An empty expected value compared loosely
  // would otherwise let an empty header through and open the endpoint to anyone.
  if (!expected || expected.length < 16) {
    console.warn('[dgx] ingest attempted but INGEST_TOKEN is not configured');
    return res.status(503).json({ error: 'ingest not configured' });
  }
  const got = String(req.get('X-Ingest-Token') || '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so length is checked first —
  // that leaks only the length, which is not the secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn(`[dgx] ingest rejected: bad token from ${req.ip}`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// The larger body limit for this path is mounted in index.js — it has to run
// before the global express.json, which a router-level parser cannot do.
router.post('/ingest', requireIngestToken, async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid payload', details: parsed.error.issues.slice(0, 5) });
  }
  try {
    // Idempotent by construction: upsertProject keys on the unique sourceUrl, so
    // a runner that retries after a timeout updates rows instead of duplicating.
    const result = await ingestFromRunner(parsed.data);
    res.json(result);
  } catch (error) {
    console.error('[dgx] ingest failed:', error);
    res.status(500).json({ error: 'ingest failed' });
  }
});

// Which of these announcements do we already have? The runner asks before
// classifying, because the DB is the only authority on what has been ingested —
// a cache on the runner's side would drift and silently re-analyse (or worse,
// skip) notices after any reset. Cheap: one indexed lookup on a unique column.
router.post('/ingest/known', requireIngestToken, async (req, res) => {
  const parsed = z.object({ sourceUrls: z.array(z.string().max(1000)).max(5000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  try {
    const rows = await prisma.bidProject.findMany({
      where: { sourceUrl: { in: parsed.data.sourceUrls } },
      select: { sourceUrl: true },
    });
    res.json({ known: rows.map((r) => r.sourceUrl) });
  } catch (error) {
    console.error('[dgx] known lookup failed:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Lets the runner confirm the previous batch landed before starting a new one.
router.get('/ingest/status', requireIngestToken, async (_req, res) => {
  try {
    res.json({ last: await lastDgxIngest() });
  } catch (error) {
    console.error('[dgx] ingest status failed:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// All Chinabidding endpoints below require a logged-in user.
router.use(authenticateToken);

router.get('/projects', async (req, res) => {
  try {
    const { page = 1, limit = 20, biddingType, bidStage, status, region, industry, equipmentType, purchaser, startDate, endDate, recent, keyword } = req.query;
    const result = await scrapeProjects({
      page: parseInt(page),
      limit: parseInt(limit),
      biddingType,
      bidStage,
      status,
      keyword,
      region,
      industry,
      equipmentType,
      purchaser,
      startDate,
      endDate,
      recent
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.get('/statistics', async (req, res) => {
  try {
    const stats = await getProjectStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Start a scrape asynchronously and return the job id immediately.
router.post('/scrape', async (req, res) => {
  try {
    const { type = 'NEW' } = req.body;
    const job = await startScrapeJob({ biddingType: type, userId: req.user?.userId ?? null });
    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (error) {
    console.error('Error starting scrape job:', error);
    res.status(500).json({ error: 'Failed to start scrape job' });
  }
});

// List recent scrape jobs.
router.get('/scrape-jobs', async (req, res) => {
  try {
    const jobs = await listScrapeJobs(parseInt(req.query.limit) || 20);
    res.json(jobs);
  } catch (error) {
    console.error('Error listing scrape jobs:', error);
    res.status(500).json({ error: 'Failed to list scrape jobs' });
  }
});

// Poll a single scrape job's status/result.
router.get('/scrape-jobs/:id', async (req, res) => {
  try {
    const job = await getScrapeJob(parseInt(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'Scrape job not found' });
    }
    res.json(job);
  } catch (error) {
    console.error('Error fetching scrape job:', error);
    res.status(500).json({ error: 'Failed to fetch scrape job' });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { keyword, localOnly = false } = req.body;
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }
    // localOnly=true: instant DB-only search (used for pagination after initial save)
    // localOnly=false (default): fetch from chinabidding.com, save new items to DB, return rich DB records
    const result = localOnly
      ? await searchLocalDb(keyword)
      : await searchAndSave(keyword);
    res.json(result);
  } catch (error) {
    console.error('Error searching projects:', error);
    res.status(500).json({ error: 'Failed to search projects' });
  }
});

// ── Bid Open 子版块 ───────────────────────────────────────────────────────────

// 下载标准开标记录模板（供用户按格式填写后上传）。内存生成，前端带 token 下载。
router.get('/bidopen/template', (req, res) => {
  import('xlsx').then((mod) => {
    const X = mod.default || mod;
    const aoa = [
      ['Bid opening -  (项目名称 Project name)'],
      [
        'Bid opening date', 'End user', 'Bidder', 'Country', 'Price term',
        'Currency', 'Price', 'Delivery time', 'Destination', 'IFB No.', 'Remark',
      ],
      ['2026-07-02', 'Shanghai Electric', 'WALDRICH SIEGEN GmbH & Co.KG', 'Germany', 'CIF', 'Euro', '7,500,000.00', '28 months', 'Shanghai', '0613-264025122902', 'ProfiTurn H 2200'],
      ['', '', 'SMT', 'Czech', 'CIF', 'Euro', '6,699,860.00', '28 months', 'Shanghai', '', ''],
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Bid opening');
    const buf = X.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bid-opening-template.xlsx"');
    res.send(buf);
  }).catch((err) => {
    console.error('template error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  });
});

// 手动录入开标记录（前端表单直接提交结构化数据，跳过 AI 识别）
router.post('/bidopen/manual', async (req, res) => {
  try {
    const { biddingNo, projectName, openDate, purchaser, bidders, summary } = req.body;
    const cleanBidders = (Array.isArray(bidders) ? bidders : [])
      .filter((b) => b && (b.name || '').trim())
      .map((b) => ({
        name: String(b.name).trim(),
        country: b.country?.trim() || null,
        priceTerm: b.priceTerm?.trim() || null,
        currency: b.currency?.trim() || null,
        price: b.price?.trim() || null,
        deliveryTime: b.deliveryTime?.trim() || null,
        destination: b.destination?.trim() || null,
        note: b.note?.trim() || null,
      }));
    if (!projectName && !biddingNo && cleanBidders.length === 0) {
      return res.status(400).json({ error: 'Please fill in at least a project/bidding no or one bidder' });
    }
    const openDateVal = parseOpenDate(openDate);
    const record = await prisma.bidOpening.create({
      data: {
        biddingNo: biddingNo?.trim() || null,
        projectName: projectName?.trim() || null,
        openDate: openDateVal,
        purchaser: purchaser?.trim() || null,
        bidders: cleanBidders,
        summary: summary?.trim() || null,
        fileName: '(manual entry)',
        shareToken: shareToken(),
        uploadedById: req.user.userId,
      },
    });
    res.status(201).json(record);
  } catch (error) {
    console.error('Error creating manual bid opening:', error);
    res.status(500).json({ error: 'Failed to save the record' });
  }
});

// 编辑已有开标记录（识别难免有错，手工订正）
router.put('/bidopen/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.bidOpening.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    // Same rule as delete — hiding the button in the UI is not a permission.
    if (existing.uploadedById !== req.user.userId && req.user.isAdmin !== true) {
      return res.status(403).json({ error: 'Only the uploader or an admin can edit this record' });
    }

    const { biddingNo, projectName, openDate, purchaser, bidders, summary } = req.body;
    const cleanBidders = (Array.isArray(bidders) ? bidders : [])
      .filter((b) => b && (b.name || '').trim())
      .map((b) => ({
        name: String(b.name).trim(),
        country: b.country?.trim() || null,
        priceTerm: b.priceTerm?.trim() || null,
        currency: b.currency?.trim() || null,
        price: b.price?.trim() || null,
        deliveryTime: b.deliveryTime?.trim() || null,
        destination: b.destination?.trim() || null,
        note: b.note?.trim() || null,
      }));
    if (!projectName && !biddingNo && cleanBidders.length === 0) {
      return res.status(400).json({ error: 'Please fill in at least a project/bidding no or one bidder' });
    }

    const record = await prisma.bidOpening.update({
      where: { id },
      data: {
        biddingNo: biddingNo?.trim() || null,
        projectName: projectName?.trim() || null,
        openDate: parseOpenDate(openDate),
        purchaser: purchaser?.trim() || null,
        bidders: cleanBidders,
        summary: summary?.trim() || null,
        // Drop the translation cache: it was produced from the text that just
        // changed, so keeping it would show the old wording under the language
        // switch — a correction that only half-applies is worse than none.
        // It regenerates on demand the next time someone switches language.
        translations: null,
      },
    });
    res.json(record);
  } catch (error) {
    console.error('Error updating bid opening:', error);
    res.status(500).json({ error: 'Failed to update the record' });
  }
});

// 上传开标记录 → Excel 走 DeepSeek 文本识别 / 图片走 Gemini 视觉识别 → 入库
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const EXCEL_RE = /\.(xlsx|xls)$/i;
const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

router.post('/bidopen/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required (.xlsx / image)' });
    const name = req.file.originalname || '';
    const isImage = IMAGE_RE.test(name);
    const isExcel = EXCEL_RE.test(name);
    if (!isImage && !isExcel) {
      return res.status(400).json({ error: 'Supported: Excel (.xlsx/.xls) or image (.jpg/.png/.webp)' });
    }

    let extracted;
    let rawText = null;
    if (isExcel) {
      rawText = xlsxToText(req.file.buffer);
      if (!rawText.trim()) return res.status(400).json({ error: 'The Excel file appears to be empty' });
      extracted = await extractBidOpenings(rawText);
    } else {
      if (!isGeminiConfigured()) {
        return res.status(503).json({ error: 'Image recognition is not configured (GEMINI_API_KEY missing on the server).' });
      }
      const ext = name.split('.').pop().toLowerCase();
      const mime = req.file.mimetype || MIME_BY_EXT[ext] || 'image/jpeg';
      extracted = await extractBidOpeningsFromImage(req.file.buffer, mime);
    }

    if (!extracted || extracted.length === 0) {
      return res.status(422).json({ error: 'Could not recognize a bid-opening record in this file' });
    }
    // A single file may contain several IFB Nos → create one record per No.
    const created = [];
    for (const rec of extracted) {
      created.push(
        await prisma.bidOpening.create({
          data: {
            ...rec,
            rawText: rawText ? rawText.slice(0, 10000) : null,
            fileName: name,
            shareToken: shareToken(),
            uploadedById: req.user.userId,
          },
        }),
      );
    }
    res.status(201).json(created);
  } catch (error) {
    // Surface classified AI-service reasons (quota/key) from DeepSeek or Gemini.
    if (error.isDeepSeek || error.isGemini) return res.status(502).json({ error: error.message });
    console.error('Error uploading bid opening:', error);
    res.status(500).json({ error: 'Failed to process the uploaded file' });
  }
});

// 翻译某条开标记录的文本字段(默认英文)，结果缓存到 translations.<lang>
router.post('/bidopen/:id/translate', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const lang = (req.body?.lang || 'en').toLowerCase();
    const rec = await prisma.bidOpening.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ error: 'Not found' });

    const cache = rec.translations || {};
    if (cache[lang]) return res.json({ lang, translation: cache[lang], cached: true });

    const translation = await translateBidOpening(rec, lang);
    const updated = await prisma.bidOpening.update({
      where: { id },
      data: { translations: { ...cache, [lang]: translation } },
    });
    res.json({ lang, translation, record: updated });
  } catch (error) {
    if (error.isDeepSeek) return res.status(502).json({ error: error.message });
    console.error('Error translating bid opening:', error);
    res.status(500).json({ error: 'Failed to translate the record' });
  }
});

router.get('/bidopen', async (req, res) => {
  try {
    const records = await prisma.bidOpening.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(records);
  } catch (error) {
    console.error('Error listing bid openings:', error);
    res.status(500).json({ error: 'Failed to list bid openings' });
  }
});

router.delete('/bidopen/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rec = await prisma.bidOpening.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (rec.uploadedById !== req.user.userId && req.user.isAdmin !== true) {
      return res.status(403).json({ error: 'Only the uploader or an admin can delete this record' });
    }
    await prisma.bidOpening.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Error deleting bid opening:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// 按招标编号抓取 chinabidding 上的评标/中标公告并入库（异步等待完成后返回结果）
router.post('/bidopen/fetch', async (req, res) => {
  try {
    const { biddingNo } = req.body;
    if (!biddingNo || !biddingNo.trim()) {
      return res.status(400).json({ error: 'biddingNo is required' });
    }
    await searchByKeyword(biddingNo.trim(), { saveToDb: true });
    const projects = await findProjectsByBiddingNo(biddingNo.trim());
    res.json(groupByStage(projects));
  } catch (error) {
    if (error.isDeepSeek) return res.status(502).json({ error: error.message });
    console.error('Error fetching bid results:', error);
    res.status(500).json({ error: 'Failed to fetch results from chinabidding' });
  }
});

// 从本地库按编号查询（不触发抓取）
router.get('/bidopen/results', async (req, res) => {
  try {
    const biddingNo = (req.query.biddingNo || '').trim();
    if (!biddingNo) return res.status(400).json({ error: 'biddingNo is required' });
    const projects = await findProjectsByBiddingNo(biddingNo);
    res.json(groupByStage(projects));
  } catch (error) {
    console.error('Error querying bid results:', error);
    res.status(500).json({ error: 'Failed to query results' });
  }
});

// 邮件配置状态（前端提示用）
router.get('/bidopen/email-status', (req, res) => {
  res.json({ emailConfigured: isEmailConfigured() });
});

async function findProjectsByBiddingNo(biddingNo) {
  return prisma.bidProject.findMany({
    where: {
      OR: [
        { threadKey: { contains: biddingNo, mode: 'insensitive' } },
        { projectCode: { contains: biddingNo, mode: 'insensitive' } },
        { projectName: { contains: biddingNo, mode: 'insensitive' } },
      ],
    },
    orderBy: { publishDate: 'desc' },
    include: { competitor: { select: { name: true, watchType: true } } },
  });
}

function groupByStage(projects) {
  const stage = (p) => {
    if (p.infoClass === 'Evaluation Results') return 'evaluation';
    if (p.infoClass === 'Tender Awards') return 'award';
    // the site labels this category "Tenders Changes" (sic)
    if (p.infoClass === 'Tender Changes' || p.infoClass === 'Tenders Changes') return 'change';
    return 'tender';
  };
  const grouped = { tender: [], change: [], evaluation: [], award: [] };
  projects.forEach((p) => grouped[stage(p)].push(p));
  return { total: projects.length, ...grouped };
}

// ── Saved Searches ────────────────────────────────────────────────────────────

router.get('/saved-searches', async (req, res) => {
  try {
    const searches = await listSavedSearches(req.user.userId);
    res.json(searches);
  } catch (error) {
    console.error('Error listing saved searches:', error);
    res.status(500).json({ error: 'Failed to list saved searches' });
  }
});

router.post('/saved-searches', async (req, res) => {
  try {
    const { name, keyword, tradeClassCode, infoClassCode, autoMonitor, emailNotify } = req.body;
    if (!name || !keyword) {
      return res.status(400).json({ error: 'name and keyword are required' });
    }
    const s = await createSavedSearch(req.user.userId, { name, keyword, tradeClassCode, infoClassCode, autoMonitor, emailNotify });
    res.status(201).json(s);
  } catch (error) {
    console.error('Error creating saved search:', error);
    res.status(500).json({ error: 'Failed to create saved search' });
  }
});

// 更新订阅（切换每日监控 / 邮件提醒）
router.patch('/saved-searches/:id', async (req, res) => {
  try {
    const s = await updateSavedSearch(parseInt(req.params.id), req.user.userId, req.body);
    res.json(s);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('Error updating saved search:', error);
    res.status(500).json({ error: 'Failed to update saved search' });
  }
});

router.delete('/saved-searches/:id', async (req, res) => {
  try {
    await deleteSavedSearch(parseInt(req.params.id), req.user.userId);
    res.status(204).send();
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('Error deleting saved search:', error);
    res.status(500).json({ error: 'Failed to delete saved search' });
  }
});

// Trigger an async scrape for a saved search.
router.post('/saved-searches/:id/run', async (req, res) => {
  try {
    const result = await runSavedSearch(parseInt(req.params.id), req.user.userId);
    res.status(202).json(result);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('Error running saved search:', error);
    res.status(500).json({ error: 'Failed to run saved search' });
  }
});

// Manually trigger the full daily job (all industries + keywords + saved searches)
router.post('/run-daily', async (req, res) => {
  try {
    const job = await runDailyJob(req.user.userId);
    res.status(202).json({ jobId: job.id, status: job.status, message: 'Daily scrape started' });
  } catch (error) {
    console.error('Error starting daily job:', error);
    res.status(500).json({ error: 'Failed to start daily job' });
  }
});

// Get recently added / status-changed projects
router.get('/updates', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const updates = await getRecentUpdates(days);
    res.json(updates);
  } catch (error) {
    console.error('Error fetching updates:', error);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

// ── Project thread (lifecycle timeline) ──────────────────────────────────────
router.get('/projects/:id/thread', async (req, res) => {
  try {
    const result = await getProjectThread(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    console.error('Error fetching thread:', error);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// ── Project lifecycle tracking ────────────────────────────────────────────────
// Aggregated project threads: auto-derived stage + team's manual tracking layer.
router.get('/threads', async (req, res) => {
  try {
    const { ourStatus, stage, q, myCustomers } = req.query;
    const threads = await listProjectThreads(req.user.userId, {
      ourStatus: ourStatus || null,
      stage: stage || null,
      q: q || null,
      myCustomers: myCustomers === '1',
    });
    res.json(threads);
  } catch (error) {
    console.error('Error listing project threads:', error);
    res.status(500).json({ error: 'Failed to list project threads' });
  }
});

// Upsert the team's manual bid tracking for one project thread.
router.put('/threads/:key/tracking', async (req, res) => {
  try {
    const threadKey = decodeURIComponent(req.params.key);
    const tracking = await upsertBidTracking(threadKey, req.body || {}, req.user.userId);
    res.json(tracking);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('Error saving bid tracking:', error);
    res.status(500).json({ error: 'Failed to save bid tracking' });
  }
});

// ── Follows ──────────────────────────────────────────────────────────────────
router.get('/follows', async (req, res) => {
  try {
    res.json(await listFollows(req.user.userId));
  } catch (error) {
    console.error('Error listing follows:', error);
    res.status(500).json({ error: 'Failed to list follows' });
  }
});

router.post('/projects/:id/follow', async (req, res) => {
  try {
    const follow = await followProject(req.user.userId, parseInt(req.params.id), req.body?.note ?? null);
    res.status(201).json(follow);
  } catch (error) {
    console.error('Error following project:', error);
    res.status(500).json({ error: 'Failed to follow project' });
  }
});

router.delete('/projects/:id/follow', async (req, res) => {
  try {
    await unfollowProject(req.user.userId, parseInt(req.params.id));
    res.status(204).end();
  } catch (error) {
    console.error('Error unfollowing project:', error);
    res.status(500).json({ error: 'Failed to unfollow project' });
  }
});

// ── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    res.json(await listNotifications(req.user.userId, { unreadOnly }));
  } catch (error) {
    console.error('Error listing notifications:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    await markNotificationRead(req.user.userId, parseInt(req.params.id));
    res.status(204).end();
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await markAllNotificationsRead(req.user.userId);
    res.status(204).end();
  } catch (error) {
    console.error('Error marking all read:', error);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// ── Trends & market report ───────────────────────────────────────────────────
router.get('/trends', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    res.json(await getTrends({ months }));
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

router.post('/report', async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'zh';
    res.json(await generateTrendReport(lang));
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ── Competitors ──────────────────────────────────────────────────────────────
router.get('/competitors', async (req, res) => {
  try {
    res.json(await listCompetitors());
  } catch (error) {
    console.error('Error listing competitors:', error);
    res.status(500).json({ error: 'Failed to list competitors' });
  }
});

router.post('/competitors/seed', async (req, res) => {
  try {
    res.json(await seedCompetitors());
  } catch (error) {
    console.error('Error seeding competitors:', error);
    res.status(500).json({ error: 'Failed to seed competitors' });
  }
});

// ── Backfill structured fields on existing records ───────────────────────────
router.post('/backfill', async (req, res) => {
  try {
    // Runs in background — may take minutes with DeepSeek calls
    backfillStructured().catch(err => console.error('[backfill] failed:', err.message));
    res.status(202).json({ message: 'Backfill started in background' });
  } catch (error) {
    console.error('Error starting backfill:', error);
    res.status(500).json({ error: 'Failed to start backfill' });
  }
});

export default router;