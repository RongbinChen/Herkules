import express from 'express';
import {
  scrapeProjects, getProjectStats, searchByKeyword,
  startScrapeJob, getScrapeJob, listScrapeJobs,
  listSavedSearches, createSavedSearch, deleteSavedSearch, runSavedSearch
} from '../services/chinabidding.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All Chinabidding endpoints require a logged-in user.
router.use(authenticateToken);

router.get('/projects', async (req, res) => {
  try {
    const { page = 1, limit = 20, biddingType, status, region, industry, startDate, endDate } = req.query;
    const result = await scrapeProjects({
      page: parseInt(page),
      limit: parseInt(limit),
      biddingType,
      status,
      region,
      industry,
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
    const { keyword } = req.body;
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword is required' });
    }
    const results = await searchByKeyword(keyword);
    res.json({ data: results, count: results.length });
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

export default router;