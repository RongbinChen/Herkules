import { prisma } from '../index.js';
import { parseListPage, parseDetailPage } from './chinabiddingParser.js';
import { analyzeProject, generateMarketReport } from './deepseek.js';
import { COMPETITOR_SEED } from '../data/competitors.js';
import { sendMail } from './mailer.js';
import { solveSession, SCRAPER_UA } from './browserSolver.js';

const BASE_URL = process.env.CHINABIDDING_BASE_URL || 'https://www.chinabidding.com/en';
const CAS_LOGIN_URL = process.env.CHINABIDDING_CAS_LOGIN_URL || 'https://cas.ebnew.com/cas/login';
const USERNAME = process.env.CHINABIDDING_USERNAME;
const PASSWORD = process.env.CHINABIDDING_PASSWORD;

// ── Scrape targets ───────────────────────────────────────────────────────────
// Industries to always monitor. Only Machining (01) is relevant to CNC machine
// tools — other industries (Medical, etc.) just scan hundreds of irrelevant
// announcements that DeepSeek then skips, wasting scrape time and API calls.
// Cross-industry machine-tool projects are still caught by KEYWORD_JOBS.
export const INDUSTRY_JOBS = [
  { tradeClassCode: '01', label: 'Machining' },
];
// Keywords to always monitor (separate searches). English terms — the /en site's
// fullText search matches announcement bodies in English; Chinese terms (机床/磨床)
// return nothing here. Each keyword scrape is relevance-filtered by DeepSeek.
export const KEYWORD_JOBS = [
  'grinding machine', 'roll grinder',
  'milling machine', 'portal milling', 'gantry milling',
  'boring machine',
  'lathe', 'horizontal lathe', 'crankshaft lathe',
  'machining center', 'machine tool',
];
// Competitor names to monitor daily (scraped without relevance filter — exact keyword hits)
export const COMPETITOR_KEYWORDS = ['georg', 'pomini', 'INNSE', 'DANIELI', 'waldrich'];

// All tender types: New Tenders + Tender Changes + Evaluation Results + Tender Awards
const ALL_TENDER_CODES = 'e0905 e0906 e0907 e0908';

const SEARCH_URL = `${BASE_URL}/info/search.htm`;

// ── Session cache (headless-solved cookies + bound UA) ───────────────────────
// The anti-bot challenge (HTTP 521) is solved by a real headless browser via
// browserSolver; the resulting cookies are reused by fetch until they expire.
const SESSION_TTL_MS = 20 * 60 * 1000;
let sessionCache = { cookies: null, userAgent: SCRAPER_UA, expiresAt: 0 };
let solving = null; // in-flight solve promise, so concurrent scrapers share one browser launch

function invalidateSession() {
  sessionCache = { cookies: null, userAgent: SCRAPER_UA, expiresAt: 0 };
}

// True when a response is the anti-bot JS challenge instead of real content.
function isAntiBotChallenge(status, text) {
  return status === 521 || /window\.onload=setTimeout\("[a-z]+\(\d+\)/i.test(text || '');
}

async function getSession(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && sessionCache.cookies && now < sessionCache.expiresAt) {
    return sessionCache;
  }
  // Collapse concurrent refreshes into a single browser launch.
  if (!solving) {
    solving = solveSession()
      .then((s) => {
        sessionCache = { ...s, expiresAt: Date.now() + SESSION_TTL_MS };
        return sessionCache;
      })
      .finally(() => { solving = null; });
  }
  return solving;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function fetchWithAuth(url, postBody = null, retryCount = 0) {
  const session = await getSession(retryCount > 0);
  const opts = {
    headers: { 'User-Agent': session.userAgent, Accept: 'text/html', Cookie: session.cookies },
  };
  if (postBody) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = postBody;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  // Re-solve on anti-bot challenge or 403 (expired/blocked clearance).
  if ((isAntiBotChallenge(res.status, text) || res.status === 403 || text.includes('403 Forbidden')) && retryCount < 2) {
    invalidateSession();
    await sleep(2000);
    return fetchWithAuth(url, postBody, retryCount + 1);
  }
  if (isAntiBotChallenge(res.status, text)) {
    throw Object.assign(new Error('chinabidding anti-bot challenge could not be cleared'), { isAntiBot: true });
  }
  return text;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fallbackCodeFromUrl(url) {
  return url.split('/').pop().replace(/\.html?$/i, '');
}

// ── Thread key: Bidding NO extracted from the project name ───────────────────
// "Procurement of 0747-2540SCCSC306/02 CNC gantry machining center(1)"
//   → threadKey "0747-2540SCCSC306" (the /02 lot suffix and (1) seq are stripped)
// All announcements (tender / change / evaluation / award) of one project share it.
export function extractThreadKey(projectName = '') {
  const m = projectName.match(/\b(\d{4}-[A-Za-z0-9]{6,})\b/);
  return m ? m[1] : null;
}

// Map chinabidding.com's announcement type (infoClass) to a lifecycle stage.
// Tolerant of the two spellings seen in the wild ("Tenders Changes" / "Tender Changes").
export function infoClassToStage(infoClass = '') {
  const s = String(infoClass || '').toLowerCase();
  if (s.includes('award')) return 'AWARD';
  if (s.includes('evaluation')) return 'EVALUATION';
  if (s.includes('change')) return 'CHANGE';
  if (s.includes('tender')) return 'TENDER'; // "New Tenders"
  return null;
}

// Furthest stage reached, for aggregating a project thread's current stage.
export const STAGE_ORDER = { TENDER: 0, CHANGE: 1, EVALUATION: 2, AWARD: 3 };

// ── Competitor matching ──────────────────────────────────────────────────────
let competitorCache = { list: null, loadedAt: 0 };

async function getCompetitors() {
  if (competitorCache.list && Date.now() - competitorCache.loadedAt < 10 * 60 * 1000) {
    return competitorCache.list;
  }
  const list = await prisma.competitor.findMany();
  competitorCache = { list, loadedAt: Date.now() };
  return list;
}

export function invalidateCompetitorCache() {
  competitorCache = { list: null, loadedAt: 0 };
}

// Match a winner string against competitor names + aliases.
// Short aliases (≤4 chars, e.g. "SMS", "VAI") require word boundaries to avoid
// false positives inside longer words.
async function matchCompetitor(winnerText) {
  if (!winnerText) return null;
  const competitors = await getCompetitors();

  // Find the most SPECIFIC match: among all alias hits, keep the longest alias.
  // This prevents a short/broad alias on one company from shadowing a precise
  // alias on another (e.g. "WALDRICH" must not match "Waldrich Coburg").
  let best = null;
  let bestLen = 0;
  for (const c of competitors) {
    for (const alias of [c.name, ...(c.aliases || [])]) {
      if (!alias) continue;
      let hit = false;
      if (alias.length <= 4) {
        const re = new RegExp(`(?:^|[^A-Za-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z]|$)`, 'i');
        hit = re.test(winnerText);
      } else {
        hit = winnerText.toLowerCase().includes(alias.toLowerCase());
      }
      if (hit && alias.length > bestLen) {
        best = c;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

// Map a watched company's type to its win-notification type + message prefix.
function winNotification(watchType) {
  switch (watchType) {
    case 'OWN':      return { type: 'OWN_WIN',      prefix: '我们中标' };
    case 'INTEREST': return { type: 'INTEREST_WIN', prefix: '关注公司中标' };
    default:         return { type: 'COMPETITOR_WIN', prefix: '竞争对手中标' };
  }
}

// ── Notifications ────────────────────────────────────────────────────────────
async function notifyFollowers(projectId, type, message) {
  const follows = await prisma.projectFollow.findMany({ where: { projectId } });
  if (follows.length === 0) return;
  await prisma.notification.createMany({
    data: follows.map(f => ({ userId: f.userId, type, projectId, message })),
  });
}

async function notifyAllUsers(type, projectId, message) {
  const users = await prisma.user.findMany({ select: { id: true } });
  if (users.length === 0) return;
  await prisma.notification.createMany({
    data: users.map(u => ({ userId: u.id, type, projectId, message })),
  });
}

// ── List-page fetcher (supports POST with filters + pagination) ───────────────
async function fetchListPage({ tradeClassCode = null, keyword = '', infoClassCodes = ALL_TENDER_CODES, pageNo = 1 }) {
  const params = { fullText: keyword, infoClassCodes, pageNo: String(pageNo) };
  if (tradeClassCode) params.tradeClassCodes = tradeClassCode;
  const html = await fetchWithAuth(SEARCH_URL, new URLSearchParams(params).toString());
  return parseListPage(html);
}

// ── Upsert a single project, detecting status changes ────────────────────────
// skipRelevanceCheck=true: skip DeepSeek filter (used for user-initiated keyword searches)
async function upsertProject(item, detailHtml = null, { skipRelevanceCheck = false } = {}) {
  let project;

  if (detailHtml) {
    project = parseDetailPage(detailHtml, item.sourceUrl);
    project.projectName = item.projectName || project.projectName;
    project.biddingType = item.biddingType || project.biddingType;
    // The list-page "Time" column is chinabidding.com's authoritative publish
    // date per announcement type — prefer it over the detail-page guess.
    if (item.listDate) project.publishDate = new Date(item.listDate);
    project.projectCode = project.projectCode || fallbackCodeFromUrl(item.sourceUrl);
  } else {
    project = {
      projectName: item.projectName,
      projectCode: fallbackCodeFromUrl(item.sourceUrl),
      biddingType: item.biddingType || 'NEW',
      publishDate: item.listDate ? new Date(item.listDate) : null,
      sourceUrl: item.sourceUrl,
      status: 'PUBLISHED',
    };
  }

  project.infoClass = item.tenderTypeLabel || null;
  project.bidStage = infoClassToStage(project.infoClass);
  project.threadKey = extractThreadKey(project.projectName) || project.projectCode || null;
  // Derive status from the announcement type so status changes are detectable,
  // instead of hard-coding PUBLISHED for every announcement.
  project.status = project.biddingType === 'PAST' ? 'CLOSED' : 'PUBLISHED';

  // sourceUrl is now @unique — a single findUnique is race-safe for the read.
  const existing = await prisma.bidProject.findUnique({ where: { sourceUrl: project.sourceUrl } });

  if (existing) {
    const statusChanged = project.status && existing.status !== project.status;
    await prisma.bidProject.update({
      where: { id: existing.id },
      data: {
        projectName: project.projectName || existing.projectName,
        region: project.region ?? existing.region,
        publishDate: project.publishDate ?? existing.publishDate,
        deadline: project.deadline ?? existing.deadline,
        budget: project.budget ?? existing.budget,
        rawContent: project.rawContent ?? existing.rawContent,
        infoClass: project.infoClass ?? existing.infoClass,
        bidStage: project.bidStage ?? existing.bidStage,
        threadKey: existing.threadKey ?? project.threadKey,
        ...(project.status ? { status: project.status } : {}),
        ...(statusChanged ? { lastStatusChange: new Date() } : {}),
      },
    });
    if (statusChanged) {
      await notifyFollowers(existing.id, 'STATUS_CHANGE',
        `项目状态变更：${(project.projectName || existing.projectName).slice(0, 80)} → ${project.status}`);
    }
    return { isNew: false, isUpdated: statusChanged };
  }

  // ── New project: single DeepSeek call for relevance + summary + extraction ──
  const name    = project.projectName || '';
  const content = project.rawContent  || '';

  const analysis = await analyzeProject(name, content);

  if (!skipRelevanceCheck && !analysis.relevant) {
    console.log(`[deepseek] skipped (irrelevant): ${name.slice(0, 60)} — ${analysis.reason}`);
    return { isNew: false, isUpdated: false, skipped: true };
  }

  // Match winner against competitor profiles
  const competitor = await matchCompetitor(analysis.winner);

  const createData = {
    ...project,
    summary: analysis.summary,
    purchaser: analysis.purchaser,
    winner: analysis.winner,
    winningPrice: analysis.winningPrice,
    equipmentType: analysis.equipmentType,
    competitorId: competitor?.id ?? null,
  };

  let created;
  try {
    // upsert on the unique sourceUrl: if a concurrent scrape created this row
    // between our findUnique above and here, update it with our analyzed data
    // instead of throwing — race-safe dedup.
    created = await prisma.bidProject.upsert({
      where: { sourceUrl: project.sourceUrl },
      create: createData,
      update: createData,
    });
  } catch (err) {
    // projectCode is @unique; a different sourceUrl can derive a colliding code
    // (or an old projectCode-keyed row predates the sourceUrl dedup). Update that
    // row instead of dropping the item to a swallowed P2002.
    if (err.code === 'P2002' && project.projectCode) {
      await prisma.bidProject.update({
        where: { projectCode: project.projectCode },
        data: createData,
      });
      return { isNew: false, isUpdated: true };
    }
    throw err;
  }

  // A tracked company won a bid — alert everyone (own group / competitor / interest)
  if (competitor) {
    const { type, prefix } = winNotification(competitor.watchType);
    const priceSuffix = analysis.winningPrice ? `（${analysis.winningPrice}）` : '';
    await notifyAllUsers(type, created.id,
      `${prefix}：${competitor.name} — ${name.slice(0, 80)}${priceSuffix}`);
  }

  // If announcements of the same thread exist, notify their followers about the new stage
  if (project.threadKey) {
    const siblings = await prisma.bidProject.findMany({
      where: { threadKey: project.threadKey, id: { not: created.id } },
      select: { id: true },
    });
    for (const s of siblings) {
      await notifyFollowers(s.id, 'STATUS_CHANGE',
        `关注项目有新公告：${name.slice(0, 80)}${project.infoClass ? `（${project.infoClass}）` : ''}`);
    }
  }

  return { isNew: true, isUpdated: false };
}

// ── Core: scrape all pages for one job until no new items ─────────────────────
// DATE_CUTOFF_DAYS: stop paginating when all items on a page are older than this
const DATE_CUTOFF_DAYS = 90;

async function scrapeAllPages({ tradeClassCode = null, keyword = '', infoClassCodes = ALL_TENDER_CODES, jobId = null } = {}) {
  const MAX_PAGES = 50;
  const cutoffDate = new Date(Date.now() - DATE_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  let page = 1;
  let totalNew = 0;
  let totalFound = 0;

  while (page <= MAX_PAGES) {
    const items = await fetchListPage({ tradeClassCode, keyword, infoClassCodes, pageNo: page });
    if (items.length === 0) break;

    totalFound += items.length;

    // Filter out items older than cutoff date
    const recentItems = items.filter(item => {
      if (!item.listDate) return true; // keep if no date info
      return new Date(item.listDate) >= cutoffDate;
    });

    // If all items on this page are older than cutoff, stop paginating
    if (recentItems.length === 0) {
      console.log(`[chinabidding] reached date cutoff (${DATE_CUTOFF_DAYS} days) at page ${page}, stopping`);
      break;
    }

    // Check which sourceUrls are already in DB
    const urls = recentItems.map(i => i.sourceUrl).filter(Boolean);
    const existing = await prisma.bidProject.findMany({
      where: { sourceUrl: { in: urls } },
      select: { sourceUrl: true },
    });
    const existingSet = new Set(existing.map(e => e.sourceUrl));
    const newItems = recentItems.filter(i => i.sourceUrl && !existingSet.has(i.sourceUrl));

    if (newItems.length === 0 && recentItems.length === items.length) {
      // All recent items on this page already known — stop paginating
      break;
    }

    // Fetch detail pages only for new items
    for (const item of newItems) {
      await sleep(800);
      try {
        const detailHtml = await fetchWithAuth(item.sourceUrl);
        await upsertProject(item, detailHtml);
        totalNew++;
      } catch (err) {
        console.error(`[chinabidding] detail error ${item.sourceUrl}: ${err.message}`);
      }
    }

    page++;
    await sleep(2000);
  }

  return { totalNew, totalFound, pages: page - 1 };
}

// ── Daily job: run all configured scrape sources ──────────────────────────────
// The actual work runs detached, so guard against overlapping runs (cron tick
// landing on a still-running manual trigger) which would double-create
// win/STATUS_CHANGE notifications.
let dailyJobRunning = false;
export async function runDailyJob(triggeredBy = null) {
  if (dailyJobRunning) {
    const running = await prisma.scrapeJob.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    });
    if (running) return running;
  }
  dailyJobRunning = true;
  const job = await prisma.scrapeJob.create({
    data: { type: 'NEW', status: 'RUNNING', triggeredBy },
  });

  (async () => {
    try {
      let totalNew = 0;

      // Health probe: verify the scraper can reach real content before the run.
      // If the anti-bot challenge can't be cleared, alert the team and bail —
      // don't silently "succeed" with 0 results like the pre-2026-07 pipeline did.
      try {
        await fetchWithAuth(SEARCH_URL, new URLSearchParams({ fullText: 'grinding', infoClassCodes: ALL_TENDER_CODES, pageNo: '1' }).toString());
      } catch (probeErr) {
        if (probeErr.isAntiBot) {
          console.error('[chinabidding] daily job aborted: anti-bot challenge not cleared');
          await notifyAllUsers('STATUS_CHANGE', null,
            '⚠️ 系统告警：ChinaBidding 抓取被反爬拦截，今日任务未执行。请检查 headless 解算/凭据（详见 docs/ARCHITECTURE_REVIEW.md 与抓取运维说明）。');
          await prisma.scrapeJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', error: 'anti-bot challenge not cleared', finishedAt: new Date() },
          });
          dailyJobRunning = false;
          return;
        }
        throw probeErr;
      }

      // Industry-based scrapes
      for (const { tradeClassCode, label } of INDUSTRY_JOBS) {
        console.log(`[chinabidding] scraping industry: ${label}`);
        const r = await scrapeAllPages({ tradeClassCode });
        console.log(`[chinabidding] ${label}: ${r.totalNew} new, ${r.pages} pages scanned`);
        totalNew += r.totalNew;
        await sleep(3000);
      }

      // Keyword-based scrapes
      for (const keyword of KEYWORD_JOBS) {
        console.log(`[chinabidding] scraping keyword: ${keyword}`);
        const r = await scrapeAllPages({ keyword });
        console.log(`[chinabidding] "${keyword}": ${r.totalNew} new, ${r.pages} pages scanned`);
        totalNew += r.totalNew;
        await sleep(3000);
      }

      // Competitor keyword scrapes (no relevance filter — competitor names are precise)
      for (const keyword of COMPETITOR_KEYWORDS) {
        console.log(`[chinabidding] scraping competitor keyword: ${keyword}`);
        try {
          await searchAndSave(keyword);
        } catch (err) {
          console.error(`[chinabidding] competitor scrape "${keyword}" failed: ${err.message}`);
        }
        await sleep(3000);
      }

      // Check deadlines of followed projects (notify if within 3 days)
      await checkDeadlines();

      // Also run all active SavedSearches
      const savedSearches = await prisma.savedSearch.findMany({ where: { autoMonitor: true } });
      for (const s of savedSearches) {
        console.log(`[chinabidding] saved search: ${s.name} (${s.keyword})`);
        const runStart = new Date();
        const r = await scrapeAllPages({
          keyword: s.keyword,
          infoClassCodes: s.infoClassCode || ALL_TENDER_CODES,
          ...(s.tradeClassCode ? { tradeClassCode: s.tradeClassCode } : {}),
        });
        await prisma.savedSearch.update({ where: { id: s.id }, data: { lastRunAt: new Date() } });
        if (r.totalNew > 0) await notifySearchOwner(s, runStart);
        totalNew += r.totalNew;
        await sleep(3000);
      }

      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: 'DONE', itemsSaved: totalNew, finishedAt: new Date() },
      });
      console.log(`[chinabidding] daily job done: ${totalNew} new projects total`);
    } catch (err) {
      console.error('[chinabidding] daily job failed:', err.message);
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: String(err.message).slice(0, 2000), finishedAt: new Date() },
      });
    } finally {
      dailyJobRunning = false;
    }
  })();

  return job;
}

// ── Legacy / existing exports (kept for backward compat) ─────────────────────

export async function startScrapeJob({ biddingType = 'NEW', userId = null } = {}) {
  return runDailyJob(userId);
}

export async function getScrapeJob(id) {
  return prisma.scrapeJob.findUnique({ where: { id } });
}

export async function listScrapeJobs(limit = 20) {
  return prisma.scrapeJob.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
}

export async function scrapeProjects(filters = {}) {
  const { page = 1, limit = 20, biddingType, bidStage, status, region, industry, equipmentType, purchaser, startDate, endDate, recent, keyword } = filters;

  const where = {};
  if (biddingType) where.biddingType = biddingType;
  if (bidStage) where.bidStage = bidStage; // 公告阶段：TENDER/CHANGE/EVALUATION/AWARD
  if (status) where.status = status;
  // Full-phrase keyword match — combines with the stage/status/etc. filters (AND).
  if (keyword && keyword.trim()) {
    const k = keyword.trim();
    where.OR = [
      { projectName: { contains: k, mode: 'insensitive' } },
      { summary:     { contains: k, mode: 'insensitive' } },
      { rawContent:  { contains: k, mode: 'insensitive' } },
      { winner:      { contains: k, mode: 'insensitive' } },
      { purchaser:   { contains: k, mode: 'insensitive' } },
    ];
  }
  const recentDays = parseInt(recent, 10);
  if (recentDays > 0) where.createdAt = { gte: new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000) };
  if (region) where.region = { contains: region, mode: 'insensitive' };
  if (industry) where.industry = { contains: industry, mode: 'insensitive' };
  if (equipmentType) where.equipmentType = equipmentType;
  if (purchaser) where.purchaser = { contains: purchaser, mode: 'insensitive' };
  if (startDate || endDate) {
    where.publishDate = {};
    if (startDate) where.publishDate.gte = new Date(startDate);
    if (endDate) where.publishDate.lte = new Date(endDate);
  }

  const [data, total] = await Promise.all([
    prisma.bidProject.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { publishDate: 'desc' } }),
    prisma.bidProject.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getProjectStats() {
  const [total, byType, byStatus, recentCount, byRegion] = await Promise.all([
    prisma.bidProject.count(),
    prisma.bidProject.groupBy({ by: ['biddingType'], _count: true }),
    prisma.bidProject.groupBy({ by: ['status'], _count: true }),
    prisma.bidProject.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.bidProject.groupBy({ by: ['region'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),
  ]);
  return {
    total,
    newProjects: byType.find(t => t.biddingType === 'NEW')?._count ?? 0,
    pastProjects: byType.find(t => t.biddingType === 'PAST')?._count ?? 0,
    publishedCount: byStatus.find(s => s.status === 'PUBLISHED')?._count ?? 0,
    closedCount: byStatus.find(s => s.status === 'CLOSED')?._count ?? 0,
    recentCount,
    topRegions: byRegion.map(r => ({ region: r.region || 'Unknown', count: r._count.id })),
  };
}

export async function searchByKeyword(keyword, { saveToDb = false, tradeClassCode = null, infoClassCode = ALL_TENDER_CODES } = {}) {
  const params = { fullText: keyword, infoClassCodes: infoClassCode };
  if (tradeClassCode) params.tradeClassCodes = tradeClassCode;
  const html = await fetchWithAuth(SEARCH_URL, new URLSearchParams(params).toString());
  const listItems = parseListPage(html);

  if (saveToDb && listItems.length > 0) {
    for (const item of listItems) {
      await sleep(800);
      try {
        const detailHtml = await fetchWithAuth(item.sourceUrl);
        // skipRelevanceCheck=true: user chose this keyword — save everything chinabidding.com returns
        await upsertProject(item, detailHtml, { skipRelevanceCheck: true });
      } catch (err) {
        console.error(`[chinabidding] save search detail error: ${err.message}`);
      }
    }
  }

  // Return light list items (sourceUrls + basic info)
  return listItems.map(item => ({
    projectName: item.projectName,
    projectCode: null,
    region: item.region || null,
    industry: item.industry || null,
    biddingType: item.biddingType,
    publishDate: item.listDate ? new Date(item.listDate) : null,
    status: 'PUBLISHED',
    sourceUrl: item.sourceUrl,
  }));
}

/**
 * Search chinabidding.com for a keyword across ALL pages (with 2-year date cutoff),
 * save new results to DB (detail pages + summary, no DeepSeek relevance filter),
 * then return rich DB records matched by the sourceUrls chinabidding.com found.
 *
 * Pagination: fetches list pages until no items / date cutoff / MAX_SEARCH_PAGES.
 * Only NEW items (not already in DB) trigger detail-page fetches.
 * DeepSeek relevance filter is SKIPPED — user chose this keyword intentionally.
 */
export async function searchAndSave(keyword) {
  // No date cutoff for user-initiated searches — user chose the keyword intentionally.
  // Volume is controlled by MAX_SEARCH_PAGES only.
  const MAX_SEARCH_PAGES = 10;
  const allSourceUrls = [];
  let page = 1;

  while (page <= MAX_SEARCH_PAGES) {
    const params = { fullText: keyword, infoClassCodes: ALL_TENDER_CODES, pageNo: String(page) };
    const html = await fetchWithAuth(SEARCH_URL, new URLSearchParams(params).toString());
    const items = parseListPage(html);

    if (items.length === 0) break;

    // Collect all sourceUrls found on this page (for final DB query)
    items.forEach(i => i.sourceUrl && allSourceUrls.push(i.sourceUrl));

    // Determine which are new (not already in DB)
    const urls = items.map(i => i.sourceUrl).filter(Boolean);
    if (urls.length > 0) {
      const existing = await prisma.bidProject.findMany({
        where: { sourceUrl: { in: urls } },
        select: { sourceUrl: true },
      });
      const existingSet = new Set(existing.map(e => e.sourceUrl));
      const newItems = items.filter(i => i.sourceUrl && !existingSet.has(i.sourceUrl));

      // Save new items: fetch detail pages + generate summary (no relevance filter)
      for (const item of newItems) {
        await sleep(800);
        try {
          const detailHtml = await fetchWithAuth(item.sourceUrl);
          await upsertProject(item, detailHtml, { skipRelevanceCheck: true });
        } catch (err) {
          console.error(`[chinabidding] search detail error ${item.sourceUrl}: ${err.message}`);
        }
      }

      // If all items on this page were already in DB, stop paginating (nothing new to find)
      if (newItems.length === 0) {
        console.log(`[chinabidding] search "${keyword}" all items on page ${page} already in DB, stopping`);
        break;
      }
    }

    page++;
    await sleep(2000);
  }

  if (allSourceUrls.length === 0) {
    return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } };
  }

  // Return rich DB records matching the sourceUrls chinabidding.com returned
  const rows = await prisma.bidProject.findMany({
    where: { sourceUrl: { in: allSourceUrls } },
    orderBy: { publishDate: 'desc' },
  });

  // chinabidding's fullText search matches loosely — e.g. "Waldrich Coburg" also
  // returns "Waldrich Siegen" via the shared word "Waldrich". Keep only records
  // whose text actually contains the full searched phrase.
  const needle = keyword.trim().toLowerCase();
  const data = rows.filter((p) => {
    const hay = `${p.projectName || ''} ${p.summary || ''} ${p.rawContent || ''} ${p.winner || ''} ${p.purchaser || ''}`.toLowerCase();
    return hay.includes(needle);
  });

  return { data, pagination: { page: 1, limit: data.length, total: data.length, totalPages: 1 } };
}

/**
 * Full-text search on local DB only (no chinabidding.com call).
 * Useful for quick re-searches on already-saved data.
 */
export async function searchLocalDb(keyword, { page = 1, limit = 20 } = {}) {
  const where = {
    OR: [
      { projectName: { contains: keyword, mode: 'insensitive' } },
      { summary:     { contains: keyword, mode: 'insensitive' } },
      { rawContent:  { contains: keyword, mode: 'insensitive' } },
    ],
  };
  const [data, total] = await Promise.all([
    prisma.bidProject.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { publishDate: 'desc' },
    }),
    prisma.bidProject.count({ where }),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ── Recent updates (new + status-changed projects) ───────────────────────────
export async function getRecentUpdates(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [newProjects, statusChanged] = await Promise.all([
    // "New" = published within the last `days` days (based on the tender's own publish date)
    prisma.bidProject.findMany({
      where: { publishDate: { gte: since } },
      orderBy: { publishDate: 'desc' },
      take: 50,
    }),
    // "Updated" = status changed within last 7 days
    prisma.bidProject.findMany({
      where: { lastStatusChange: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { lastStatusChange: 'desc' },
      take: 50,
    }),
  ]);
  return { newProjects, statusChanged };
}

// After a saved search runs, notify its owner about announcements saved since
// `since` that match the keyword: in-app Notification always, email when the
// subscription opted in (search.emailNotify) and SMTP is configured.
async function notifySearchOwner(search, since) {
  try {
    const fresh = await prisma.bidProject.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          { projectName: { contains: search.keyword, mode: 'insensitive' } },
          { threadKey: { contains: search.keyword, mode: 'insensitive' } },
          { projectCode: { contains: search.keyword, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, projectName: true, infoClass: true, sourceUrl: true },
    });
    if (fresh.length === 0) return;

    await prisma.notification.create({
      data: {
        userId: search.userId,
        type: 'NEW_RELEVANT',
        projectId: fresh[0].id,
        message: `订阅「${search.name}」有 ${fresh.length} 条新公告：${fresh[0].projectName.slice(0, 60)}${fresh.length > 1 ? ' 等' : ''}`,
      },
    });

    if (search.emailNotify) {
      const user = await prisma.user.findUnique({
        where: { id: search.userId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        const lines = fresh.map(
          (p) => `• [${p.infoClass || 'Announcement'}] ${p.projectName}\n  ${p.sourceUrl}`,
        );
        await sendMail({
          to: user.email,
          subject: `[Herkules Bid Watch] ${search.name}: ${fresh.length} new announcement(s)`,
          text:
            `Hi ${user.name},\n\n` +
            `Your subscription "${search.name}" (keyword: ${search.keyword}) matched ${fresh.length} new announcement(s):\n\n` +
            `${lines.join('\n\n')}\n\n` +
            `View in the app: https://www.herkulesgroup-china.com/chinabidding\n`,
        });
      }
    }
  } catch (err) {
    // Notification failures must never break the scrape pipeline.
    console.error(`[chinabidding] notifySearchOwner "${search.name}" failed: ${err.message}`);
  }
}

// ── SavedSearch CRUD ─────────────────────────────────────────────────────────
export async function listSavedSearches(userId) {
  return prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
}

export async function createSavedSearch(userId, data) {
  return prisma.savedSearch.create({
    data: {
      userId,
      name: data.name,
      keyword: data.keyword,
      tradeClassCode: data.tradeClassCode ?? null,
      infoClassCode: data.infoClassCode ?? ALL_TENDER_CODES,
      autoMonitor: data.autoMonitor ?? false,
      emailNotify: data.emailNotify ?? false,
    },
  });
}

export async function deleteSavedSearch(id, userId) {
  const s = await prisma.savedSearch.findUnique({ where: { id } });
  if (!s || s.userId !== userId) throw Object.assign(new Error('Not found'), { status: 404 });
  await prisma.savedSearch.delete({ where: { id } });
}

export async function updateSavedSearch(id, userId, data) {
  const s = await prisma.savedSearch.findUnique({ where: { id } });
  if (!s || s.userId !== userId) throw Object.assign(new Error('Not found'), { status: 404 });
  return prisma.savedSearch.update({
    where: { id },
    data: {
      ...(data.autoMonitor !== undefined ? { autoMonitor: !!data.autoMonitor } : {}),
      ...(data.emailNotify !== undefined ? { emailNotify: !!data.emailNotify } : {}),
      ...(data.name ? { name: data.name } : {}),
    },
  });
}

export async function runSavedSearch(id, userId) {
  const s = await prisma.savedSearch.findUnique({ where: { id } });
  if (!s || s.userId !== userId) throw Object.assign(new Error('Not found'), { status: 404 });

  const job = await prisma.scrapeJob.create({
    data: { type: 'NEW', status: 'RUNNING', triggeredBy: userId, savedSearchId: id },
  });

  (async () => {
    try {
      const runStart = new Date();
      const r = await scrapeAllPages({
        keyword: s.keyword,
        infoClassCodes: s.infoClassCode || ALL_TENDER_CODES,
        ...(s.tradeClassCode ? { tradeClassCode: s.tradeClassCode } : {}),
      });
      await prisma.savedSearch.update({ where: { id }, data: { lastRunAt: new Date() } });
      if (r.totalNew > 0) await notifySearchOwner(s, runStart);
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: 'DONE', itemsFound: r.totalFound, itemsSaved: r.totalNew, finishedAt: new Date() },
      });
    } catch (err) {
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: String(err.message).slice(0, 2000), finishedAt: new Date() },
      });
    }
  })();

  return { jobId: job.id, status: 'RUNNING' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1-4 additions: thread, follows, notifications, deadlines, trends,
// market report, backfill, competitor seed
// ═══════════════════════════════════════════════════════════════════════════

// ── Project thread (all announcements of the same Bidding NO) ────────────────
export async function getProjectThread(projectId) {
  const project = await prisma.bidProject.findUnique({ where: { id: projectId } });
  if (!project) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!project.threadKey) return { project, thread: [project] };

  const thread = await prisma.bidProject.findMany({
    where: { threadKey: project.threadKey },
    orderBy: { publishDate: 'asc' },
  });
  return { project, thread };
}

// ── Project threads: lifecycle tracking (aggregate a real project's stages) ────
// Groups every announcement by threadKey into one "project thread" and derives
// the current lifecycle stage (furthest reached), winner, and timeline. Attaches
// the team's manual BidTracking record and whether the user follows the thread.
const OUR_BID_STATUSES = ['WATCHING', 'PREPARING', 'SUBMITTED', 'SHORTLISTED', 'WON', 'LOST', 'ABANDONED'];

export async function listProjectThreads(userId, { ourStatus = null, stage = null, q = null } = {}) {
  const projects = await prisma.bidProject.findMany({
    orderBy: { publishDate: 'asc' },
    select: {
      id: true, projectName: true, projectCode: true, region: true, equipmentType: true,
      purchaser: true, winner: true, winningPrice: true, budget: true, deadline: true,
      infoClass: true, bidStage: true, status: true, sourceUrl: true, publishDate: true,
      threadKey: true, updatedAt: true,
    },
  });

  const groups = new Map();
  for (const p of projects) {
    const key = p.threadKey || `p:${p.id}`; // ungrouped announcements stand alone
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const keys = [...groups.keys()];
  const [trackings, follows] = await Promise.all([
    prisma.bidTracking.findMany({ where: { threadKey: { in: keys } } }),
    prisma.projectFollow.findMany({ where: { userId }, select: { projectId: true } }),
  ]);
  const trackingByKey = new Map(trackings.map((t) => [t.threadKey, t]));
  const followedIds = new Set(follows.map((f) => f.projectId));

  const ms = (d) => (d ? new Date(d).getTime() : 0);

  let threads = keys.map((key) => {
    const anns = groups.get(key);
    let currentStage = null;
    let currentOrder = -1;
    for (const a of anns) {
      const ord = a.bidStage ? (STAGE_ORDER[a.bidStage] ?? -1) : -1;
      if (ord > currentOrder) { currentOrder = ord; currentStage = a.bidStage; }
    }
    const rep = anns[anns.length - 1]; // latest announcement is representative
    const winnerAnn = anns.find((a) => a.winner);
    return {
      threadKey: key,
      projectName: rep.projectName,
      projectCode: rep.projectCode,
      region: rep.region,
      equipmentType: rep.equipmentType,
      purchaser: rep.purchaser || anns.find((a) => a.purchaser)?.purchaser || null,
      budget: rep.budget || anns.find((a) => a.budget)?.budget || null,
      deadline: rep.deadline,
      currentStage,
      winner: winnerAnn?.winner || null,
      winningPrice: winnerAnn?.winningPrice || null,
      firstPublish: anns[0].publishDate,
      lastUpdate: anns.reduce((m, a) => (ms(a.updatedAt) > ms(m) ? a.updatedAt : m), anns[0].updatedAt),
      following: anns.some((a) => followedIds.has(a.id)),
      tracking: trackingByKey.get(key) || null,
      announcements: anns.map((a) => ({
        id: a.id, infoClass: a.infoClass, bidStage: a.bidStage, status: a.status,
        publishDate: a.publishDate, sourceUrl: a.sourceUrl,
        winner: a.winner, winningPrice: a.winningPrice,
      })),
    };
  });

  threads.sort((a, b) => ms(b.lastUpdate) - ms(a.lastUpdate));

  if (stage) threads = threads.filter((t) => t.currentStage === stage);
  if (ourStatus) threads = threads.filter((t) => (t.tracking?.ourStatus || null) === ourStatus);
  if (q) {
    const needle = String(q).toLowerCase();
    threads = threads.filter((t) =>
      [t.projectName, t.purchaser, t.winner, t.threadKey, t.equipmentType]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(needle)));
  }
  return threads;
}

export async function upsertBidTracking(threadKey, data = {}, userId = null) {
  if (data.ourStatus && !OUR_BID_STATUSES.includes(data.ourStatus)) {
    throw Object.assign(new Error('Invalid ourStatus'), { status: 400 });
  }
  const allowed = ['ourStatus', 'ourPrice', 'competitors', 'outcome', 'note'];
  const clean = {};
  for (const k of allowed) if (data[k] !== undefined) clean[k] = data[k] === '' ? null : data[k];
  return prisma.bidTracking.upsert({
    where: { threadKey },
    create: { threadKey, ...clean, updatedById: userId },
    update: { ...clean, updatedById: userId },
  });
}

// ── Project follows ──────────────────────────────────────────────────────────
export async function followProject(userId, projectId, note = null) {
  return prisma.projectFollow.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId, note },
    update: { note },
  });
}

export async function unfollowProject(userId, projectId) {
  await prisma.projectFollow.deleteMany({ where: { userId, projectId } });
}

export async function listFollows(userId) {
  return prisma.projectFollow.findMany({
    where: { userId },
    include: { project: true },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────
export async function listNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { project: { select: { id: true, projectName: true, sourceUrl: true, publishDate: true } } },
      orderBy: { createdAt: 'desc' }, // most recently fired alerts form the working set
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  // A notification bell is about the ALERT's recency, not the linked bid's
  // publish date. Sort UNREAD first (so the "N new" badge always points at
  // something visible at the top), then most-recently-fired first. rows is
  // already createdAt-desc, and Array.sort is stable, so this preserves that.
  const items = rows.slice().sort((a, b) => (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0));

  return { items, unreadCount };
}

export async function markNotificationRead(userId, notificationId) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

// ── Deadline check: followed projects with deadline within 3 days ────────────
export async function checkDeadlines() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const follows = await prisma.projectFollow.findMany({
    include: { project: { select: { id: true, projectName: true, deadline: true } } },
  });

  for (const f of follows) {
    const p = f.project;
    if (!p?.deadline || p.deadline < now || p.deadline > soon) continue;

    // Dedupe: skip if we already sent a DEADLINE_SOON for this user+project
    const already = await prisma.notification.findFirst({
      where: { userId: f.userId, projectId: p.id, type: 'DEADLINE_SOON' },
    });
    if (already) continue;

    await prisma.notification.create({
      data: {
        userId: f.userId,
        type: 'DEADLINE_SOON',
        projectId: p.id,
        message: `投标截止临近（${p.deadline.toISOString().slice(0, 10)}）：${p.projectName.slice(0, 80)}`,
      },
    });
  }
}

// ── Market trends aggregation ─────────────────────────────────────────────────
export async function getTrends({ months = 12 } = {}) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const projects = await prisma.bidProject.findMany({
    where: { publishDate: { gte: since } },
    select: {
      publishDate: true, equipmentType: true, region: true, industry: true,
      purchaser: true, winner: true, winningPrice: true, infoClass: true,
      competitorId: true, projectName: true, status: true, deadline: true, id: true,
      sourceUrl: true,
    },
    orderBy: { publishDate: 'asc' },
  });

  // Scope competitor wins to the SAME time window as the rest of the trends —
  // otherwise a "近6个月" report leaks all-time wins (e.g. 2023 projects).
  const competitors = await prisma.competitor.findMany({
    include: {
      projects: {
        where: { publishDate: { gte: since } },
        select: { id: true, projectName: true, publishDate: true, winningPrice: true, sourceUrl: true },
      },
    },
  });

  // Monthly counts by equipmentType
  const monthly = {};
  for (const p of projects) {
    const ym = p.publishDate.toISOString().slice(0, 7);
    monthly[ym] ??= { total: 0, byType: {} };
    monthly[ym].total++;
    const t = p.equipmentType || '未分类';
    monthly[ym].byType[t] = (monthly[ym].byType[t] || 0) + 1;
  }

  // Region distribution (normalize: first 12 chars to merge long location strings)
  const regions = {};
  for (const p of projects) {
    if (!p.region) continue;
    const r = p.region.slice(0, 12).trim();
    regions[r] = (regions[r] || 0) + 1;
  }

  // Active purchasers
  const purchasers = {};
  for (const p of projects) {
    if (!p.purchaser) continue;
    purchasers[p.purchaser] = (purchasers[p.purchaser] || 0) + 1;
  }

  // Equipment type distribution
  const equipmentTypes = {};
  for (const p of projects) {
    const t = p.equipmentType || '未分类';
    equipmentTypes[t] = (equipmentTypes[t] || 0) + 1;
  }

  // Competitor win stats
  const competitorStats = competitors
    .map(c => ({
      id: c.id,
      name: c.name,
      country: c.country,
      watchType: c.watchType,
      winCount: c.projects.length,
      // Return all wins (capped) so the UI's count matches the expandable list.
      recentWins: c.projects
        .slice()
        .sort((a, b) => (b.publishDate ?? 0) - (a.publishDate ?? 0))
        .slice(0, 50),
    }))
    .sort((a, b) => b.winCount - a.winCount);

  // Upcoming deadlines (open opportunities)
  const now = new Date();
  const upcoming = projects
    .filter(p => p.deadline && new Date(p.deadline) > now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 10);

  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, count]) => ({ name, count }));

  return {
    months,
    totalProjects: projects.length,
    monthly: Object.entries(monthly).map(([month, v]) => ({ month, ...v })),
    topRegions: top(regions, 10),
    topPurchasers: top(purchasers, 10),
    equipmentTypes: top(equipmentTypes, 15),
    competitorStats,
    upcomingDeadlines: upcoming,
  };
}

// ── AI market report ──────────────────────────────────────────────────────────
export async function generateTrendReport(lang = 'zh') {
  const trends = await getTrends({ months: 6 });
  const context = JSON.stringify({
    统计周期: '近6个月',
    项目总数: trends.totalProjects,
    月度趋势: trends.monthly,
    设备类型分布: trends.equipmentTypes,
    活跃采购单位: trends.topPurchasers,
    地区分布: trends.topRegions,
    竞争对手中标: trends.competitorStats.map(c => ({ 名称: c.name, 中标数: c.winCount, 近期中标: c.recentWins.slice(0, 3).map(w => w.projectName) })),
    即将截止的招标: trends.upcomingDeadlines.map(p => ({ 项目: p.projectName, 截止: p.deadline })),
  }, null, 1);

  const report = await generateMarketReport(context, lang);
  return { report, lang, generatedAt: new Date(), basedOn: { months: 6, projects: trends.totalProjects } };
}

// ── Backfill: run structured extraction on existing records ──────────────────
export async function backfillStructured() {
  const pending = await prisma.bidProject.findMany({
    where: { equipmentType: null, rawContent: { not: null } },
  });
  console.log(`[backfill] ${pending.length} records to process`);

  let done = 0;
  for (const p of pending) {
    const analysis = await analyzeProject(p.projectName, p.rawContent);
    const competitor = await matchCompetitor(analysis.winner);
    await prisma.bidProject.update({
      where: { id: p.id },
      data: {
        summary: p.summary || analysis.summary,
        purchaser: analysis.purchaser,
        winner: analysis.winner,
        winningPrice: analysis.winningPrice,
        equipmentType: analysis.equipmentType,
        threadKey: p.threadKey || extractThreadKey(p.projectName) || p.projectCode,
        competitorId: competitor?.id ?? null,
      },
    });
    done++;
    console.log(`[backfill] ${done}/${pending.length}: ${p.projectName.slice(0, 60)}`);
    await sleep(500);
  }
  return { processed: done };
}

// ── Competitor CRUD + seed ────────────────────────────────────────────────────
export async function listCompetitors() {
  return prisma.competitor.findMany({
    include: { _count: { select: { projects: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function seedCompetitors() {
  for (const c of COMPETITOR_SEED) {
    const data = { name: c.name, aliases: c.aliases, country: c.country ?? null, notes: c.notes ?? null, watchType: c.watchType ?? 'COMPETITOR' };
    await prisma.competitor.upsert({
      where: { name: c.name },
      create: data,
      update: { aliases: data.aliases, country: data.country, notes: data.notes, watchType: data.watchType },
    });
  }
  invalidateCompetitorCache();
  return { seeded: COMPETITOR_SEED.length };
}
