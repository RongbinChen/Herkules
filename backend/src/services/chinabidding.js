import { prisma } from '../index.js';
import { parseListPage, parseDetailPage } from './chinabiddingParser.js';

const CHINABIDDING_BASE_URL = process.env.CHINABIDDING_BASE_URL || 'https://www.chinabidding.com/en';
const CAS_LOGIN_URL = process.env.CHINABIDDING_CAS_LOGIN_URL || 'https://cas.ebnew.com/cas/login';
const USERNAME = process.env.CHINABIDDING_USERNAME;
const PASSWORD = process.env.CHINABIDDING_PASSWORD;

async function loginAndGetCookies() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Chinabidding credentials are not configured. Set CHINABIDDING_USERNAME and CHINABIDDING_PASSWORD environment variables.');
  }

  const serviceUrl = encodeURIComponent('https://www.chinabidding.com/en/login/loginEn.htm');

  const r1 = await fetch(CAS_LOGIN_URL + '?service=' + serviceUrl, { redirect: 'manual' });
  const cookies1 = r1.headers.getSetCookie?.() || [];
  let cookieStr = cookies1.map(c => c.split(';')[0]).join('; ');
  const html1 = await r1.text();
  const lt = html1.match(/name="lt" value="([^"]+)"/)?.[1];

  const r2 = await fetch(CAS_LOGIN_URL + '?service=' + serviceUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    },
    body: new URLSearchParams({
      username: USERNAME,
      password: PASSWORD,
      lt: lt,
      _eventId: 'submit',
      authorize: 'true'
    }).toString()
  });
  const cookies2 = r2.headers.getSetCookie?.() || [];
  const location2 = r2.headers.get('Location');

  if (location2) {
    const r3 = await fetch(location2, { redirect: 'manual', headers: { 'Cookie': cookies2.map(c => c.split(';')[0]).join('; ') } });
    const cookies3 = r3.headers.getSetCookie?.() || [];
    const location3 = r3.headers.get('Location');

    if (location3) {
      const r4 = await fetch(location3, { redirect: 'manual', headers: { 'Cookie': cookies3.map(c => c.split(';')[0]).join('; ') } });
      const cookies4 = r4.headers.getSetCookie?.() || [];
      return [...cookies4, ...cookies3, ...cookies2].map(c => c.split(';')[0]).join('; ');
    }
  }
  return '';
}

// Cached CAS session so we don't re-login on every request.
// Phase 0 uses a single shared account (env credentials); per-user sessions come later.
const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes
let sessionCache = { cookies: null, expiresAt: 0 };

function invalidateSession() {
  sessionCache = { cookies: null, expiresAt: 0 };
}

async function getCookies(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && sessionCache.cookies && now < sessionCache.expiresAt) {
    return sessionCache.cookies;
  }

  const cookies = await loginAndGetCookies();
  if (cookies) {
    sessionCache = { cookies, expiresAt: now + SESSION_TTL_MS };
  }
  return cookies;
}

async function fetchWithAuth(url, retryCount = 0) {
  // Force a fresh login on retries; otherwise reuse the cached session.
  const cookies = await getCookies(retryCount > 0);

  const response = await fetch(url, {
    // The site's anti-bot blocks (403) the full browser header set on GET
    // search pages but allows this minimal one. Also: don't set
    // Accept-Encoding manually or undici won't auto-decompress the body.
    headers: {
      'User-Agent': 'Mozilla/5.0 Chrome/120',
      'Accept': 'text/html',
      'Cookie': cookies
    }
  });

  const text = await response.text();
  // Session likely expired/blocked: drop the cached cookies and retry with a fresh login.
  if ((response.status === 403 || text.includes('403 Forbidden')) && retryCount < 3) {
    invalidateSession();
    await new Promise(r => setTimeout(r, 3000));
    return fetchWithAuth(url, retryCount + 1);
  }

  return text;
}

function fallbackCodeFromUrl(url) {
  return url.split('/').pop().replace(/\.html?$/i, '');
}

async function scrapeProjectList(biddingType = 'NEW') {
  const infoClassCode = biddingType === 'PAST' ? 'e0906' : 'e0905';
  const searchUrl = `${CHINABIDDING_BASE_URL}/info/search.htm?infoClassCodes=${infoClassCode}`;

  const html = await fetchWithAuth(searchUrl);
  return parseListPage(html);
}

export async function scrapeProjects(filters = {}) {
  const { page = 1, limit = 20, biddingType = 'NEW', scrapeOnly = false } = filters;

  if (scrapeOnly) {
    await new Promise(r => setTimeout(r, 2000));

    const listItems = await scrapeProjectList(biddingType);
    let successCount = 0;

    for (const item of listItems) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const html = await fetchWithAuth(item.sourceUrl);
        const project = parseDetailPage(html, item.sourceUrl);

        // Prefer the clean list title; fall back to the list date and a
        // URL-derived code so re-scrapes update instead of duplicating.
        project.projectName = item.projectName || project.projectName;
        project.biddingType = item.biddingType || biddingType;
        if (!project.publishDate && item.listDate) project.publishDate = new Date(item.listDate);
        project.projectCode = project.projectCode || fallbackCodeFromUrl(item.sourceUrl);

        await prisma.bidProject.upsert({
          where: { projectCode: project.projectCode },
          update: {
            projectName: project.projectName,
            region: project.region,
            publishDate: project.publishDate,
            deadline: project.deadline,
            budget: project.budget,
            status: project.status,
            rawContent: project.rawContent
          },
          create: project
        });
        successCount++;
      } catch (err) {
        console.error(`Error scraping ${item.sourceUrl}:`, err.message);
      }
    }

    return { success: true, count: successCount, found: listItems.length };
  }

  const where = {};
  if (biddingType) where.biddingType = biddingType;
  if (filters.status) where.status = filters.status;
  if (filters.region) where.region = { contains: filters.region };
  if (filters.industry) where.industry = { contains: filters.industry };
  if (filters.startDate || filters.endDate) {
    where.publishDate = {};
    if (filters.startDate) where.publishDate.gte = new Date(filters.startDate);
    if (filters.endDate) where.publishDate.lte = new Date(filters.endDate);
  }

  const [data, total] = await Promise.all([
    prisma.bidProject.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { publishDate: 'desc' }
    }),
    prisma.bidProject.count({ where })
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// Run a scrape in the background and record progress on the ScrapeJob row.
async function runScrapeJob(jobId, biddingType) {
  try {
    const result = await scrapeProjects({ biddingType, scrapeOnly: true });
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        itemsFound: result.found ?? 0,
        itemsSaved: result.count ?? 0,
        finishedAt: new Date()
      }
    });
  } catch (err) {
    console.error(`Scrape job ${jobId} failed:`, err);
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: String(err?.message || err).slice(0, 2000),
        finishedAt: new Date()
      }
    });
  }
}

// Create a ScrapeJob and kick off scraping asynchronously (does not block).
export async function startScrapeJob({ biddingType = 'NEW', userId = null } = {}) {
  const job = await prisma.scrapeJob.create({
    data: { type: biddingType, status: 'RUNNING', triggeredBy: userId }
  });

  // Fire-and-forget: the HTTP request returns immediately with the job id.
  runScrapeJob(job.id, biddingType);

  return job;
}

export async function getScrapeJob(id) {
  return prisma.scrapeJob.findUnique({ where: { id } });
}

export async function listScrapeJobs(limit = 20) {
  return prisma.scrapeJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit
  });
}

export async function getProjectStats() {
  const [total, byType, byStatus, recentCount, byRegion] = await Promise.all([
    prisma.bidProject.count(),
    prisma.bidProject.groupBy({ by: ['biddingType'], _count: true }),
    prisma.bidProject.groupBy({ by: ['status'], _count: true }),
    prisma.bidProject.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
    }),
    prisma.bidProject.groupBy({ by: ['region'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 })
  ]);

  return {
    total,
    newProjects: byType.find(t => t.biddingType === 'NEW')?._count?.id || 0,
    pastProjects: byType.find(t => t.biddingType === 'PAST')?._count?.id || 0,
    publishedCount: byStatus.find(s => s.status === 'PUBLISHED')?._count?.id || 0,
    closedCount: byStatus.find(s => s.status === 'CLOSED')?._count?.id || 0,
    recentCount,
    topRegions: byRegion.map(r => ({ region: r.region || 'Unknown', count: r._count.id }))
  };
}

export async function searchByKeyword(keyword) {
  const cookies = await getCookies();
  const searchUrl = `${CHINABIDDING_BASE_URL}/info/search.htm`;

  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': searchUrl
    },
    body: new URLSearchParams({
      fullText: keyword,
      infoClassCodes: 'e0905'
    }).toString()
  });

  const html = await response.text();

  return parseListPage(html).map((item) => ({
    projectName: item.projectName,
    projectCode: null,
    region: null,
    industry: null,
    biddingType: item.biddingType,
    publishDate: item.listDate ? new Date(item.listDate) : null,
    deadline: null,
    budget: null,
    status: 'PUBLISHED',
    sourceUrl: item.sourceUrl
  }));
}