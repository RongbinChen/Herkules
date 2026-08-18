import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import holidaysRoutes from './routes/holidays.js';
import usersRoutes from './routes/users.js';
import chinabiddingRoutes from './routes/chinabidding.js';
import customersRoutes from './routes/customers.js';
import contractsRoutes from './routes/contracts.js';
import agentsRoutes from './routes/agents.js';
import tripsRoutes from './routes/trips.js';
import visitReportsRoutes from './routes/visitReports.js';
import searchRoutes from './routes/search.js';
import assistantRoutes from './routes/assistant.js';
import hotProjectsRoutes from './routes/hotProjects.js';
import shareMetaRoutes from './routes/shareMeta.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors());
// The DGX ingest posts a batch of announcements running to a few MB. Its roomier
// parser must be mounted BEFORE the global one, not inside the router: body-parser
// runs in mount order and the 100 kB default would reject the body long before the
// route is reached. Once this one has parsed, it sets req._body and the global
// parser below no-ops — so only this path gets the larger limit.
app.use('/api/chinabidding/ingest', express.json({ limit: '12mb' }));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Scrape jobs don't survive a process restart — but only reap rows that are
// clearly stale (>4h): utility scripts import this module too, and an
// unconditional sweep would mark the main server's live job as failed.
prisma.scrapeJob
  .updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 4 * 3600 * 1000) } },
    data: { status: 'FAILED', error: 'interrupted by server restart', finishedAt: new Date() },
  })
  .then((r) => { if (r.count) console.log(`[chinabidding] closed ${r.count} zombie RUNNING job(s) on boot`); })
  .catch(() => {});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/chinabidding', chinabiddingRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/visit-reports', visitReportsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/hotprojects', hotProjectsRoutes);
// Public share pages (SPA shell + per-record OG meta for WeChat link cards)
app.use(shareMetaRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  // An oversized body is the client's problem, and reporting it as 500 sends
  // whoever is debugging a batch upload looking for a server fault that isn't there.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload too large' });
  }
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ── Daily chinabidding scrape — runs at 06:00 China time every day ──
// A full run takes ~3h, so results are in before the workday starts. Deploys
// are blocked while it runs (scripts/deploy-vps.sh), and 06:00-09:00 keeps that
// window clear of working hours. Note 06:00 China = 22:00 UTC the day before,
// so a run shows up under the previous date when reading timestamps in UTC.
// runDailyJob guards against overlapping runs internally.
//
// Since the DGX runner took over (2026-08-18) this is switched OFF in
// production via SCRAPE_ON_VPS=0. It is an env flag rather than deleted code
// on purpose: the failure mode we are guarding against is the DGX going dark,
// and the recovery for that has to be one line in .env plus a pm2 restart —
// not a code change, a PR and a deploy at the moment the pipeline is already
// broken. Default stays ON so nothing changes for a fresh checkout.
cron.schedule('0 6 * * *', async () => {
  if (process.env.SCRAPE_ON_VPS === '0') return;
  console.log('[cron] Starting daily chinabidding scrape...');
  try {
    const { runDailyJob } = await import('./services/chinabidding.js');
    await runDailyJob(null);
  } catch (err) {
    console.error('[cron] Daily scrape error:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

// ── Daily reminders — 08:00 China time, before people start their day ──
// Deliberately its own schedule rather than a step inside runDailyJob.
// checkDeadlines() used to live only there, which quietly tied tender deadline
// alerts to the VPS scrape: switching that scrape off for the DGX would have
// stopped the reminders too, with nothing to show for it. checkDeadlines
// dedupes per user+project, so running it here as well as there is harmless.
cron.schedule('0 8 * * *', async () => {
  try {
    const { checkDeadlines } = await import('./services/chinabidding.js');
    const { checkTripsTomorrow } = await import('./services/reminders.js');
    await checkDeadlines().catch((e) => console.error('[reminders] deadlines failed:', e.message));
    await checkTripsTomorrow().catch((e) => console.error('[reminders] trips failed:', e.message));
  } catch (err) {
    console.error('[reminders] daily run failed:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

// ── DGX runner absence alarm — 12:00 China time, after the run should have landed ──
// Gated on DGX_EXPECTED so it stays silent until the runner is actually in
// service; an alarm that fires before the thing exists trains people to ignore it.
cron.schedule('0 12 * * *', async () => {
  if (process.env.DGX_EXPECTED !== '1') return;
  try {
    const { checkDgxAbsence } = await import('./services/chinabidding.js');
    await checkDgxAbsence();
  } catch (err) {
    console.error('[dgx] absence check failed:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

export { prisma };
