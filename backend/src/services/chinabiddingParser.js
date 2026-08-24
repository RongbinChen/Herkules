import * as cheerio from 'cheerio';

// Map the site's tender-type label to our BidType enum.
function tenderTypeToBidType(label) {
  if (!label) return 'NEW';
  return /result|award|win|past|closed/i.test(label) ? 'PAST' : 'NEW';
}

function normalizeDetailUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  return 'https://' + href.replace(/^\/+/, '');
}

/**
 * Parse a Chinabidding search/list page into structured list items.
 * Each item carries enough info (title, url, date, type) that we often
 * don't need to open the detail page just to get a title.
 */
export function parseListPage(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('li.list-item').each((_, el) => {
    const titleEl = $(el).find('a.item-title-text').first();
    const href = titleEl.attr('href');
    if (!href || !href.includes('/detail/')) return;

    const dateText = $(el).find('.item-title-data').first().text();
    const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
    const typeLabel = $(el).find('.item-title-new').first().text().trim() || null;

    items.push({
      projectName: titleEl.text().replace(/\s+/g, ' ').trim(),
      sourceUrl: normalizeDetailUrl(href),
      tenderTypeLabel: typeLabel,
      biddingType: tenderTypeToBidType(typeLabel),
      listDate: dateMatch ? dateMatch[1] : null,
    });
  });

  return items;
}

/**
 * Group 1 is the date; an optional group 2 carries "HH:MM". Chinabidding is a
 * mainland site, so a time-bearing value is anchored to Beijing (+08:00) —
 * without it a 23:59 cutoff would read as expired eight hours early. Date-only
 * values keep the historical UTC-midnight behaviour so that
 * `.toISOString().slice(0, 10)` still prints the date shown on the page.
 */
function matchDate(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const d = new Date(m[2] ? `${m[1]}T${m[2]}:00+08:00` : m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract the announcement's PUBLISH date from detail-page text.
 * Different announcement types carry the publish date under different labels;
 * we try them in priority order. We deliberately do NOT fall back to "first
 * date in body" — that grabs unrelated dates like Open-Time of Bids / deadlines.
 * When no labeled date is found, return null and let the caller fall back to the
 * list-page "Time" column (authoritative).
 */
export function extractPublishDate(body) {
  return (
    // New Tenders
    matchDate(body, /released on www\.chinabidding\.com on\s*(\d{4}-\d{2}-\d{2})/i) ||
    // Tender Awards / 中标结果
    matchDate(body, /Data of Bidding Result[:：]\s*(\d{4}-\d{2}-\d{2})/i) ||
    // Evaluation Results — use the END of the evaluation window (closest to publish)
    matchDate(body, /Data of Evaluation Result[:：][^]*?-\s*(\d{4}-\d{2}-\d{2})/i) ||
    matchDate(body, /Data of Evaluation Result[:：]\s*(\d{4}-\d{2}-\d{2})/i) ||
    null
  );
}

/**
 * Parse a Chinabidding detail page. We extract clean text from the main
 * content node first, then run label-based patterns against that text —
 * far more robust than matching raw HTML.
 */
export function parseDetailPage(html, detailUrl) {
  const $ = cheerio.load(html);

  const project = {
    projectName: null,
    projectCode: null,
    region: null,
    industry: null,
    biddingType: 'NEW',
    publishDate: null,
    deadline: null,
    budget: null,
    status: 'PUBLISHED',
    sourceUrl: detailUrl,
    rawContent: null,
  };

  const title = $('title').text().replace(/^Chinabidding-/i, '').trim();
  if (title) project.projectName = title;

  const body = (
    $('.main-info').text() ||
    $('.detail-info').text() ||
    $('body').text()
  ).replace(/\s+/g, ' ').trim();

  // Values are often glued to the next label (no whitespace once cheerio
  // flattens the DOM), so we stop each capture at the next known label.
  const code = body.match(/Bidding No[:：]\s*(.+?)(?=\s*Project Name|\s*Place of|$)/i) || body.match(/项目编号[：:]\s*(\S+)/);
  if (code) project.projectCode = code[1].trim();

  const region = body.match(/Place of Implementation[:：]\s*(.+?)(?=\s*List of Products|\s*NO\.|$)/i);
  if (region) project.region = region[1].trim().slice(0, 80);

  project.publishDate = extractPublishDate(body);

  // Evaluation Results announce no bid deadline — their live date is the end of
  // the public-notice window, the last moment to file a complaint. That is the
  // one date still worth acting on at that stage, so it lands in `deadline` too;
  // the UI labels it by stage. The value is glued to the next sentence
  // ("...23:59Who proposed the successful bidder"), hence no trailing anchor.
  project.deadline =
    matchDate(body, /Deadline for Submitting Bids[^:：]*[:：]\s*(\d{4}-\d{2}-\d{2})/i) ||
    matchDate(body, /Ending of Selling Bidding Documents[:：]\s*(\d{4}-\d{2}-\d{2})/i) ||
    matchDate(body, /Ending Date of Evaluation Result[:：]\s*(\d{4}-\d{2}-\d{2})(?:\s*(\d{2}:\d{2}))?/i);

  // Price is a currency token (e.g. "￥1500/$250"); match only currency
  // symbols + digits so we stop at any glued label like "Additional".
  // NOTE: the `budget` column actually holds the SALE PRICE of the bidding
  // documents (标书售价), not the project budget — the UI must label it
  // "Price of Bidding Documents".
  const budget = body.match(/Price of Bidding Documents[:：]\s*([￥$][\d,]+(?:\s*\/\s*[￥$][\d,]+)*)/i);
  if (budget && !/free/i.test(budget[1])) project.budget = budget[1].trim();

  project.rawContent = body.slice(0, 5000);
  return project;
}

// ── Manufacturer ─────────────────────────────────────────────────────────────
// Award notices carry the equipment maker in a labelled field of its own:
//   "...Final-Winner:BESTBAY CO., LIMITEDManufacturer:WaldrichsiggenManufacturer Country:Germany"
// The winner is frequently a trading company bidding on the maker's behalf, so
// the maker — not the winner — decides whether a win belongs to us or to a
// competitor. The field is machine-written by the site, so a regex reads it
// exactly; there is nothing here worth spending a model call on.
export function extractManufacturer(rawContent = '') {
  const text = String(rawContent || '');
  const m = text.match(/(?:Manufacturer|制造商|生产厂家)\s*[:：]\s*(.+)/i);
  if (!m) return null;
  // The page has no line breaks, so the value ends where the next label starts.
  const value = m[1].split(/Manufacturer\s*Country|Manufacturer\s*[:：]|制造商国别|制造商\s*[:：]/i)[0].trim();
  if (!value || value === '/' || value === '-' || value.length > 120) return null;
  return value;
}
