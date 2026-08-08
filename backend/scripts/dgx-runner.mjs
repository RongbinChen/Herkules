#!/usr/bin/env node
// DGX-side chinabidding scraper.
//
// Runs on the workstation in Beijing, scrapes over the domestic line, classifies
// with a local model, and POSTs finished notices to the VPS. The VPS never
// connects back: everything here is outbound HTTPS, so the home network needs no
// port forwarding, no dynamic DNS and no inbound hole.
//
// Usage:
//   node backend/scripts/dgx-runner.mjs            # full run, posts to the VPS
//   node backend/scripts/dgx-runner.mjs --dry-run  # scrape + classify, post nothing
//   node backend/scripts/dgx-runner.mjs --limit 20 # cap notices analysed (smoke test)
//   node backend/scripts/dgx-runner.mjs --backfill # historical import, notify nobody
//
// Environment (backend/.env):
//   CHINABIDDING_USERNAME / _PASSWORD   site credentials
//   INGEST_URL                          e.g. https://www.herkulesgroup-china.com/api/chinabidding
//   INGEST_TOKEN                        must match the VPS value
//   OLLAMA_URL / LOCAL_MODEL            defaults localhost:11434 / qwen3:latest
//   ALLOW_FOREIGN_EGRESS=1              bypass the domestic-egress check (don't)
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.DGX_ENV_FILE || path.join(HERE, '..', '.env');

// Load .env BEFORE importing anything that reads process.env at module scope.
// browserSolver.js captures the credentials in top-level consts, and a static
// import would be hoisted above this loop — it would always see them empty.
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { solveSession } = await import('../src/services/browserSolver.js');
const { parseListPage, parseDetailPage } = await import('../src/services/chinabiddingParser.js');
const { analyzeProjectLocal } = await import('../src/services/localModel.js');
// From chinabiddingJobs.js, NOT chinabidding.js — the latter imports prisma from
// index.js, so reading a constant out of it would boot the Express server here.
const { INDUSTRY_JOBS, KEYWORD_JOBS, COMPETITOR_KEYWORDS } = await import('../src/services/chinabiddingJobs.js');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// One-time historical import: the server stores the rows but sends no
// notifications. Announcements up to 90 days old are not news, and telling every
// user "a competitor won this bid" about a two-month-old award reads as if it
// just happened. Never use this for the daily run.
const BACKFILL = args.includes('--backfill');
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || Infinity;

const BASE_URL = process.env.CHINABIDDING_BASE_URL || 'https://www.chinabidding.com/en';
const SEARCH_URL = `${BASE_URL}/info/search.htm`;
const INGEST_URL = process.env.INGEST_URL;
const INGEST_TOKEN = process.env.INGEST_TOKEN;
const MAX_PAGES = Number(process.env.DGX_MAX_PAGES || 50);
const DATE_CUTOFF_DAYS = 90;
const BATCH = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── Egress guard ─────────────────────────────────────────────────────────────
// This box reaches the internet through a rule-based proxy: domestic traffic
// goes out on the local line, foreign traffic through a Tokyo exit. The entire
// reason for moving the scrape here is that domestic path — if the rules change,
// or the proxy is off, we would silently be scraping from Tokyo again, which is
// exactly the flaky cross-border link this migration exists to escape.
// Fail loudly instead: a run that did not happen is easy to see, a run that
// quietly got slow and lossy is not.
async function assertDomesticEgress() {
  if (process.env.ALLOW_FOREIGN_EGRESS === '1') {
    log('⚠️  ALLOW_FOREIGN_EGRESS=1 — skipping the egress check');
    return null;
  }
  let text;
  try {
    text = await fetch('https://myip.ipip.net', { signal: AbortSignal.timeout(10000) }).then((r) => r.text());
  } catch (err) {
    throw new Error(`egress check failed (${err.message}) — refusing to scrape blind`);
  }
  const ip = text.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? 'unknown';
  if (!text.includes('中国')) {
    throw new Error(`egress is NOT domestic (${ip}: ${text.trim()}). `
      + 'Check the proxy rules — scraping over the foreign path is what we are trying to avoid. '
      + 'Set ALLOW_FOREIGN_EGRESS=1 only if you know why.');
  }
  log(`出口: ${text.trim()}`);
  return ip;
}

// ── Session + fetch ──────────────────────────────────────────────────────────
let session = null;
async function getSession(force = false) {
  if (!session || force) {
    log(force ? '重新解反爬挑战…' : '解反爬挑战 + 登录…');
    session = await solveSession();
  }
  return session;
}

const isChallenge = (status, text) => status === 521 || /window\.onload=setTimeout\("[a-z]+\(\d+\)/i.test(text || '');

async function fetchWithAuth(url, body = null, solveRetry = 0, netRetry = 0) {
  const s = await getSession(solveRetry > 0);
  const opts = { headers: { 'User-Agent': s.userAgent, Accept: 'text/html', Cookie: s.cookies } };
  if (body) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = body;
  }
  let res, text;
  try {
    res = await fetch(url, opts);
    text = await res.text();
  } catch (err) {
    if (netRetry < 3) {
      await sleep([2000, 5000, 12000][netRetry]);
      return fetchWithAuth(url, body, solveRetry, netRetry + 1);
    }
    throw err;
  }
  if ((isChallenge(res.status, text) || res.status === 403) && solveRetry < 2) {
    await sleep(2000);
    return fetchWithAuth(url, body, solveRetry + 1);
  }
  if (isChallenge(res.status, text)) throw new Error('anti-bot challenge could not be cleared');
  return text;
}

// `currentPage`, not `pageNo` — see the note in services/chinabidding.js.
const listPage = async (keyword, tradeClassCode, page) =>
  parseListPage(await fetchWithAuth(SEARCH_URL, new URLSearchParams({
    fullText: keyword, infoClassCodes: '', currentPage: String(page),
    ...(tradeClassCode ? { tradeClassCodes: tradeClassCode } : {}),
  }).toString()));

// ── VPS calls ────────────────────────────────────────────────────────────────
async function vps(pathname, body, method = 'POST') {
  const res = await fetch(`${INGEST_URL}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': INGEST_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text || '{}');
}

// ── Rejected-notice cache ────────────────────────────────────────────────────
// Notices judged irrelevant are not stored anywhere, so without this every run
// re-fetches and re-classifies the same rejects for as long as they stay inside
// the 90-day window — that is what fills the production log with tens of
// thousands of "skipped (irrelevant)" lines.
//
// A local file is the right home for this even though the DB is authority for
// what was *kept*: losing this file costs only repeated work, never data. The
// stored PROMPT_VERSION guards the one real hazard — after the classifier
// changes, yesterday's rejects deserve a fresh opinion, so bumping it retires
// the whole cache.
const PROMPT_VERSION = 'v3-category-2026-08';
const REJECT_FILE = process.env.DGX_REJECT_CACHE || path.join(HERE, '.dgx-rejects.json');
const REJECT_TTL_DAYS = 120;

function loadRejects() {
  try {
    const raw = JSON.parse(readFileSync(REJECT_FILE, 'utf8'));
    if (raw.version !== PROMPT_VERSION) {
      log(`否决缓存版本不符（${raw.version} → ${PROMPT_VERSION}），全部重判`);
      return new Map();
    }
    const cutoff = Date.now() - REJECT_TTL_DAYS * 86400000;
    return new Map(Object.entries(raw.urls || {}).filter(([, t]) => t > cutoff));
  } catch {
    return new Map(); // absent or corrupt → start over, it is only a cache
  }
}

function saveRejects(map) {
  try {
    writeFileSync(REJECT_FILE, JSON.stringify({ version: PROMPT_VERSION, urls: Object.fromEntries(map) }));
  } catch (err) {
    log(`否决缓存写入失败（不影响本次结果）: ${err.message}`);
  }
}

// The DB is the authority on what has been ingested. Asking beats keeping a
// local cache of *kept* notices, which would drift after any reset and silently
// skip notices we never actually stored.
async function filterUnknown(items, rejects) {
  const fresh = items.filter((x) => !rejects.has(x.sourceUrl));
  if (DRY_RUN) return fresh;
  const known = new Set();
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500).map((x) => x.sourceUrl);
    const r = await vps('/ingest/known', { sourceUrls: chunk });
    for (const u of r.known || []) known.add(u);
  }
  return fresh.filter((x) => !known.has(x.sourceUrl));
}

// ── Collect ──────────────────────────────────────────────────────────────────
async function collect() {
  const cutoff = new Date(Date.now() - DATE_CUTOFF_DAYS * 86400000);
  const found = new Map();
  const jobs = [
    ...INDUSTRY_JOBS.map((j) => ({ label: `行业 ${j.label}`, keyword: '', tradeClassCode: j.tradeClassCode })),
    ...KEYWORD_JOBS.map((k) => ({ label: `关键词 ${k}`, keyword: k, tradeClassCode: null })),
    ...COMPETITOR_KEYWORDS.map((k) => ({ label: `竞品 ${k}`, keyword: k, tradeClassCode: null })),
  ];

  for (const job of jobs) {
    let added = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let items;
      try {
        items = await listPage(job.keyword, job.tradeClassCode, page);
      } catch (err) {
        log(`  ${job.label} p${page} 失败: ${err.message}`);
        break; // one job's bad page must not abort the whole run
      }
      if (items.length === 0) break;
      const recent = items.filter((i) => !i.listDate || new Date(i.listDate) >= cutoff);
      for (const i of recent) if (i.sourceUrl && !found.has(i.sourceUrl)) { found.set(i.sourceUrl, i); added++; }
      // Every item on the page predates the cutoff — deeper pages are older still.
      if (recent.length === 0) break;
      await sleep(700);
    }
    log(`  ${job.label}: 累计新增 ${added} 条`);
  }
  return [...found.values()];
}

// ── Main ─────────────────────────────────────────────────────────────────────
const runId = randomUUID();
const t0 = Date.now();
log(`run ${runId}${DRY_RUN ? ' (dry-run)' : ''}`);

if (!DRY_RUN && (!INGEST_URL || !INGEST_TOKEN)) {
  console.error('INGEST_URL / INGEST_TOKEN 未配置 —— 无处回传，先配好再跑（或加 --dry-run）');
  process.exit(2);
}

const egressIp = await assertDomesticEgress();
await getSession();

log('抓列表…');
const all = await collect();
log(`列表合计 ${all.length} 条`);

const rejects = loadRejects();
const unknown = (await filterUnknown(all, rejects)).slice(0, LIMIT);
log(`其中未入库且未被否决过 ${unknown.length} 条（否决缓存 ${rejects.size} 条），开始抓详情 + 本地分类`);

const payload = [];
let analysed = 0, kept = 0, failed = 0;
for (const item of unknown) {
  try {
    const detail = parseDetailPage(await fetchWithAuth(item.sourceUrl), item.sourceUrl);
    const analysis = await analyzeProjectLocal(item.projectName || detail.projectName || '', detail.rawContent || '');
    analysed++;
    if (!analysis.relevant) {
      // Remember the rejection so tomorrow's run does not pay for it again, and
      // do not ship it: the server would only log and discard it. Note that
      // analyzeProjectLocal returns relevant=true when the model itself failed,
      // so a rejection cached here is always a real verdict, never an error.
      rejects.set(item.sourceUrl, Date.now());
      continue;
    }
    kept++;
    payload.push({
      sourceUrl: item.sourceUrl,
      projectName: item.projectName ?? null,
      biddingType: item.biddingType ?? null,
      listDate: item.listDate ?? null,
      tenderTypeLabel: item.tenderTypeLabel ?? null,
      detail: {
        projectName: detail.projectName, projectCode: detail.projectCode,
        region: detail.region, industry: detail.industry, biddingType: detail.biddingType,
        publishDate: detail.publishDate, deadline: detail.deadline, budget: detail.budget,
        status: detail.status, rawContent: detail.rawContent,
      },
      // `category` is ours, not the server's — strip it so the payload matches
      // the schema the ingest endpoint validates.
      analysis: { relevant: analysis.relevant, reason: analysis.reason, summary: analysis.summary,
                  purchaser: analysis.purchaser, winner: analysis.winner,
                  winningPrice: analysis.winningPrice, equipmentType: analysis.equipmentType },
    });
    if (analysed % 25 === 0) log(`  …已分析 ${analysed}/${unknown.length}（保留 ${kept}）`);
  } catch (err) {
    failed++;
    log(`  跳过 ${item.sourceUrl}: ${err.message}`);
  }
  await sleep(500);
}

log(`分析完成: 判读 ${analysed} 条，保留 ${kept}，失败 ${failed}`);
saveRejects(rejects);

if (DRY_RUN) {
  log('dry-run，不回传。保留的项目：');
  for (const p of payload) {
    // reason carries the category; equipmentType alone is ambiguous here —
    // both 「其他金属切削机床」(kept) and 「其他」(dropped) map to '其他'.
    log(`  · ${p.analysis.reason} — ${String(p.projectName).slice(0, 60)}`);
  }
} else {
  // Batched so one oversized POST cannot cost the whole run, and resendable: the
  // server keys on sourceUrl, so a retried batch updates rather than duplicates.
  //
  // `batches` always has at least one entry, even when nothing was relevant. A
  // genuinely quiet day and a runner that never woke up look identical from the
  // VPS, and the absence alarm would cry wolf every slow week — so an empty run
  // still reports in.
  const batches = [];
  for (let i = 0; i < payload.length; i += BATCH) batches.push(payload.slice(i, i + BATCH));
  if (batches.length === 0) batches.push([]);

  const totals = {};
  for (const [n, slice] of batches.entries()) {
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        // `scanned` is what we actually judged; `projects` is only what survived.
        const r = await vps('/ingest', { runId, egressIp, scanned: analysed, backfill: BACKFILL, projects: slice });
        for (const [k, v] of Object.entries(r)) if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
        done = true;
      } catch (err) {
        log(`  回传第 ${n + 1}/${batches.length} 批失败 (${attempt}/3): ${err.message}`);
        if (attempt < 3) await sleep(attempt * 5000);
      }
    }
    if (!done) process.exitCode = 1; // surfaced to cron/systemd, not swallowed
  }
  log(`回传结果: ${JSON.stringify(totals)}`);
}

log(`用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
