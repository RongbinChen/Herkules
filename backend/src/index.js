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
import agentsRoutes from './routes/agents.js';
import tripsRoutes from './routes/trips.js';
import visitReportsRoutes from './routes/visitReports.js';
import searchRoutes from './routes/search.js';
import shareMetaRoutes from './routes/shareMeta.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/chinabidding', chinabiddingRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/visit-reports', visitReportsRoutes);
app.use('/api/search', searchRoutes);
// Public share pages (SPA shell + per-record OG meta for WeChat link cards)
app.use(shareMetaRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ── Daily chinabidding scrape — runs at 08:00 China time every day ──
// runDailyJob guards against overlapping runs internally.
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Starting daily chinabidding scrape...');
  try {
    const { runDailyJob } = await import('./services/chinabidding.js');
    await runDailyJob(null);
  } catch (err) {
    console.error('[cron] Daily scrape error:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

export { prisma };
