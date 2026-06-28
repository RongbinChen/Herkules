import express from 'express';
import {
  scrapeProjects, getProjectStats, searchByKeyword, searchAndSave, searchLocalDb,
  startScrapeJob, getScrapeJob, listScrapeJobs,
  listSavedSearches, createSavedSearch, deleteSavedSearch, runSavedSearch,
  runDailyJob, getRecentUpdates,
  getProjectThread, followProject, unfollowProject, listFollows,
  listNotifications, markNotificationRead, markAllNotificationsRead,
  getTrends, generateTrendReport, backfillStructured,
  listCompetitors, seedCompetitors,
} from '../services/chinabidding.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All Chinabidding endpoints require a logged-in user.
router.use(authenticateToken);

router.get('/projects', async (req, res) => {
  try {
    const { page = 1, limit = 20, biddingType, status, region, industry, equipmentType, purchaser, startDate, endDate } = req.query;
    const result = await scrapeProjects({
      page: parseInt(page),
      limit: parseInt(limit),
      biddingType,
      status,
      region,
      industry,
      equipmentType,
      purchaser,
      startDate,
      endDate
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
    const { name, keyword, tradeClassCode, infoClassCode, autoMonitor } = req.body;
    if (!name || !keyword) {
      return res.status(400).json({ error: 'name and keyword are required' });
    }
    const s = await createSavedSearch(req.user.userId, { name, keyword, tradeClassCode, infoClassCode, autoMonitor });
    res.status(201).json(s);
  } catch (error) {
    console.error('Error creating saved search:', error);
    res.status(500).json({ error: 'Failed to create saved search' });
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
    res.json(await generateTrendReport());
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