import { prisma } from '../index.js';

const CHINABIDDING_BASE_URL = 'https://www.chinabidding.com/en';
const CAS_LOGIN_URL = 'https://cas.ebnew.com/cas/login';
const USERNAME = 'p3290';
const PASSWORD = '1041343676p!';

async function loginAndGetCookies() {
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

async function fetchWithAuth(url, retryCount = 0) {
  const cookies = await loginAndGetCookies();

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Cookie': cookies
    }
  });

  const text = await response.text();
  if (text.includes('403 Forbidden') && retryCount < 3) {
    await new Promise(r => setTimeout(r, 3000));
    return fetchWithAuth(url, retryCount + 1);
  }

  return text;
}

function parseProjectFromDetailPage(html, detailUrl) {
  const project = {
    projectName: null,
    projectCode: null,
    region: null,
    industry: null,
    biddingType: 'NEW',
    publishDate: null,
    deadline: null,
    budget: null,
    status: 'PUBLISHED',
    sourceUrl: detailUrl,
    rawContent: null
  };

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    project.projectName = titleMatch[1].replace('Chinabidding-', '').trim();
  }

  const codeMatch = html.match(/Bidding No[:\s]*([A-Z0-9\-]+)/i) || html.match(/项目编号[：:]\s*([A-Z0-9\-]+)/i);
  if (codeMatch) project.projectCode = codeMatch[1].trim();

  const regionMatch = html.match(/Place of Implementation[:\s]*([^\n<]+)/i);
  if (regionMatch) {
    const region = regionMatch[1].trim();
    const provinceMatch = region.match(/([A-Za-z]+\s*Province)|([^\s]+市)|([^\s]+区)/);
    project.region = provinceMatch ? provinceMatch[0] : region.substring(0, 50);
  }

  const publishDateMatch = html.match(/tender notice was released on www\.chinabidding\.com on(\d{4}-\d{2}-\d{2})/i);
  if (publishDateMatch) project.publishDate = new Date(publishDateMatch[1]);

  const deadlineMatch = html.match(/Deadline for Submitting Bids.*?(\d{4}-\d{2}-\d{2})/i) || html.match(/Ending of Selling Bidding Documents[:\s]*(\d{4}-\d{2}-\d{2})/i);
  if (deadlineMatch) project.deadline = new Date(deadlineMatch[1]);

  const budgetMatch = html.match(/Price of Bidding Documents[:\s]*([^<\n]+)/i);
  if (budgetMatch && !budgetMatch[1].includes('Free') && !budgetMatch[1].includes('free')) {
    project.budget = budgetMatch[1].trim();
  }

  return project;
}

async function scrapeProjectList(biddingType = 'NEW') {
  const infoClassCode = biddingType === 'PAST' ? 'e0906' : 'e0905';
  const searchUrl = `${CHINABIDDING_BASE_URL}/info/search.htm?infoClassCodes=${infoClassCode}`;

  const html = await fetchWithAuth(searchUrl);
  const projectUrls = [];

  const detailPattern = /www\.chinabidding\.com\/en\/detail\/[^\s"']+/gi;
  const detailUrls = html.match(detailPattern) || [];
  for (const detailUrl of detailUrls) {
    if (!detailUrl.includes('必联网') && !detailUrl.includes('京ICP备')) {
      projectUrls.push({
        url: 'https://' + detailUrl,
        title: detailUrl.split('/').pop()
      });
    }
  }

  return projectUrls;
}

export async function scrapeProjects(filters = {}) {
  const { page = 1, limit = 20, biddingType = 'NEW', scrapeOnly = false } = filters;

  if (scrapeOnly) {
    await new Promise(r => setTimeout(r, 2000));

    const projectUrls = await scrapeProjectList(biddingType);
    let successCount = 0;

    for (const { url, title } of projectUrls) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const html = await fetchWithAuth(url);
        const project = parseProjectFromDetailPage(html, url);
        project.projectName = title;
        project.biddingType = biddingType;

        await prisma.bidProject.upsert({
          where: { projectCode: project.projectCode || title },
          update: {
            projectName: project.projectName,
            region: project.region,
            publishDate: project.publishDate,
            deadline: project.deadline,
            budget: project.budget,
            status: project.status,
            rawContent: html.substring(0, 5000)
          },
          create: project
        });
        successCount++;
      } catch (err) {
        console.error(`Error scraping ${url}:`, err.message);
      }
    }

    return { success: true, count: successCount };
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
  const cookies = await loginAndGetCookies();
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
  const projects = [];

  const detailPattern = /www\.chinabidding\.com\/en\/detail\/[^\s"']+/gi;
  const detailUrls = html.match(detailPattern) || [];

  for (const detailUrl of detailUrls) {
    if (!detailUrl.includes('必联网') && !detailUrl.includes('京ICP备')) {
      const fullUrl = 'https://' + detailUrl;
      const titleMatch = html.match(new RegExp(detailUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*title="([^"]+)"'));
      projects.push({
        projectName: titleMatch?.[1] || detailUrl.split('/').pop().replace('.html', ''),
        projectCode: null,
        region: null,
        industry: null,
        biddingType: 'NEW',
        publishDate: null,
        deadline: null,
        budget: null,
        status: 'PUBLISHED',
        sourceUrl: fullUrl
      });
    }
  }

  return projects;
}