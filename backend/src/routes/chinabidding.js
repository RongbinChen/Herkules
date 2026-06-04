import express from 'express';
import { scrapeProjects, getProjectStats, searchByKeyword, startScrapeJob, getScrapeJob, listScrapeJobs } from '../services/chinabidding.js';
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

export default router;