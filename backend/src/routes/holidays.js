import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getHolidayCalendars } from '../services/holidayCalendars.js';

const router = express.Router();

router.get('/calendars', authenticateToken, async (req, res) => {
  try {
    const calendars = await getHolidayCalendars();
    res.json(calendars);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch holiday calendars' });
  }
});

export default router;
