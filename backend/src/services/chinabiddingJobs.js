// What the daily scrape looks for. Deliberately a standalone module with no
// imports: the DGX runner needs these lists, and pulling them out of
// chinabidding.js would drag in `prisma` from index.js — which boots the whole
// Express server as a side effect of reading a constant.
// chinabidding.js re-exports everything here, so this move is invisible to callers.

// Industries to always monitor. Only Machining (01) is relevant to CNC machine
// tools — other industries (Medical, etc.) just scan hundreds of irrelevant
// announcements that get skipped, wasting scrape time and API calls.
// Cross-industry machine-tool projects are still caught by KEYWORD_JOBS.
export const INDUSTRY_JOBS = [
  { tradeClassCode: '01', label: 'Machining' },
];

// Keywords to always monitor (separate searches). English terms — the /en site's
// fullText search matches announcement bodies in English; Chinese terms (机床/磨床)
// return nothing here. Each keyword scrape is relevance-filtered.
//
// 2026-08-08, measured against the live site (page 1, 10 results each, classified
// by the local model): 'grinding machine', 'milling machine', 'boring machine',
// 'machining center' and 'machine tool' are NOT five searches — they are one.
// Pairwise they returned 90-100% the same notices, each overlapped the *empty*
// search 6/10, and each scored ~10% precision. The word "machine" is common
// enough that the site's ranking hands back the global latest feed no matter what
// it is paired with. Quoting the phrase changes nothing (tested).
// So we keep ONE of them as the deliberate broad sweep and drop the four
// duplicates — coverage is unchanged, they were returning the same rows.
// The rest earn their own request (measured precision):
//   lathe 100% · gantry milling 90% · crankshaft lathe 90% · portal milling 70%
//   roll grinder 60% · horizontal lathe 50%
export const KEYWORD_JOBS = [
  'roll grinder',
  'portal milling', 'gantry milling',
  'lathe', 'horizontal lathe', 'crankshaft lathe',
  'machine tool', // the broad sweep; see above
];

// Competitor names to monitor daily (scraped without relevance filter — exact keyword hits)
export const COMPETITOR_KEYWORDS = ['georg', 'pomini', 'INNSE', 'DANIELI', 'waldrich'];
