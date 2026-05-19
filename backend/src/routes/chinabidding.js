import express from 'express';
import { scrapeProjects, getProjectStats, searchByKeyword } from '../services/chinabidding.js';

const router = express.Router();

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

router.post('/scrape', async (req, res) => {
  try {
    const { type = 'NEW' } = req.body;
    const result = await scrapeProjects({ biddingType: type, scrapeOnly: true });
    res.json(result);
  } catch (error) {
    console.error('Error scraping projects:', error);
    res.status(500).json({ error: 'Failed to scrape projects' });
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