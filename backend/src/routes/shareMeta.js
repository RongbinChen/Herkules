// Server-rendered meta tags for public share pages.
//
// WeChat (and other messengers) build the rich link-card from the page's
// <title> / Open Graph tags. The SPA's static index.html has none, so every
// share used to render as a bare link. Nginx routes /bidopen/share/* and
// /trip/share/* page requests here; we inject per-record title, description
// and a thumbnail into the SPA shell, then the browser hydrates as usual.
import express from 'express';
import { readFileSync } from 'fs';
import { prisma } from '../index.js';

const router = express.Router();

const INDEX_PATH = process.env.WEBROOT_INDEX || '/var/www/herkulesgroup/index.html';
const SITE_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://www.herkulesgroup-china.com';
const SHARE_IMAGE = `${SITE_ORIGIN}/brand/hrc.png`;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function loadShell() {
  // Read per request so a frontend deploy is picked up without a backend restart.
  return readFileSync(INDEX_PATH, 'utf-8');
}

function withMeta(html, { title, description, url }) {
  const tags = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Herkules CRM">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:image" content="${SHARE_IMAGE}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="summary">`,
  ].join('\n    ');
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('</head>', `    ${tags}\n  </head>`);
}

function fmtDate(v) {
  return v ? new Date(v).toISOString().slice(0, 10) : '';
}

router.get('/bidopen/share/:token', async (req, res) => {
  let html;
  try {
    html = loadShell();
  } catch (err) {
    console.error('[shareMeta] cannot read SPA shell:', err.message);
    return res.status(500).send('Server error');
  }
  try {
    const rec = await prisma.bidOpening.findUnique({
      where: { shareToken: req.params.token },
      select: { projectName: true, biddingNo: true, openDate: true, purchaser: true, bidders: true },
    });
    if (rec) {
      const n = Array.isArray(rec.bidders) ? rec.bidders.length : 0;
      const title = `Bid Opening: ${rec.projectName || rec.biddingNo || 'record'}`;
      const description = [
        rec.biddingNo ? `No. ${rec.biddingNo}` : null,
        rec.openDate ? `Opened ${fmtDate(rec.openDate)}` : null,
        n ? `${n} bidder(s)` : null,
        rec.purchaser || null,
      ].filter(Boolean).join(' · ');
      html = withMeta(html, { title, description, url: `${SITE_ORIGIN}${req.originalUrl}` });
    }
  } catch (err) {
    console.error('[shareMeta] bidopen lookup failed:', err.message);
  }
  res.type('html').send(html);
});

router.get('/trip/share/:token', async (req, res) => {
  let html;
  try {
    html = loadShell();
  } catch (err) {
    console.error('[shareMeta] cannot read SPA shell:', err.message);
    return res.status(500).send('Server error');
  }
  try {
    const trip = await prisma.trip.findUnique({
      where: { shareToken: req.params.token },
      select: {
        title: true, startTime: true, endTime: true,
        assignee: { select: { name: true } },
        _count: { select: { stops: true } },
      },
    });
    if (trip) {
      const title = `Trip: ${trip.title}`;
      const description = [
        `${fmtDate(trip.startTime)} → ${fmtDate(trip.endTime)}`,
        `${trip._count.stops} stop(s)`,
        trip.assignee?.name ? `Assignee ${trip.assignee.name}` : null,
      ].filter(Boolean).join(' · ');
      html = withMeta(html, { title, description, url: `${SITE_ORIGIN}${req.originalUrl}` });
    }
  } catch (err) {
    console.error('[shareMeta] trip lookup failed:', err.message);
  }
  res.type('html').send(html);
});

export default router;
