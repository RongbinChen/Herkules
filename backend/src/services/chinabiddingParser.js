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

function matchDate(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const d = new Date(m[1]);
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

  project.deadline =
    matchDate(body, /Deadline for Submitting Bids[^:：]*[:：]\s*(\d{4}-\d{2}-\d{2})/i) ||
    matchDate(body, /Ending of Selling Bidding Documents[:：]\s*(\d{4}-\d{2}-\d{2})/i);

  // Price is a currency token (e.g. "￥1500/$250"); match only currency
  // symbols + digits so we stop at any glued label like "Additional".
  const budget = body.match(/Price of Bidding Documents[:：]\s*([￥$][\d,]+(?:\s*\/\s*[￥$][\d,]+)*)/i);
  if (budget && !/free/i.test(budget[1])) project.budget = budget[1].trim();

  project.rawContent = body.slice(0, 5000);
  return project;
}
