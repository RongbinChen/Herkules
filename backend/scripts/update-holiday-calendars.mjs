#!/home/ubuntu/.nvm/versions/node/v24.14.1/bin/node

import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { createHolidayPublishedAdminNotice } from '../src/services/adminNotices.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'src', 'data', 'holiday-calendars.json');
const TEMP_DATA_FILE = `${DATA_FILE}.tmp`;
const SEARCH_API = 'https://sousuo.www.gov.cn/search-gov/data';

const HOLIDAY_NAME_MAP = {
  '元旦': 'New Year',
  '春节': 'Spring Festival',
  '清明节': 'Qingming Festival',
  '劳动节': 'Labor Day',
  '端午节': 'Dragon Boat Festival',
  '中秋节': 'Mid-Autumn Festival',
  '国庆节': 'National Day',
};

function createPlaceholderCalendar(year) {
  return {
    id: `china-holidays-${year}`,
    label: `China Holidays ${year}`,
    description: 'Awaiting official State Council announcement',
    enabled: false,
    published: false,
    year,
    sourceUrl: '',
    publishedAt: '',
    lastCheckedAt: '',
    events: [],
  };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseHolidayEventsFromNotice(text, year) {
  const events = [];

  for (const chineseName of Object.keys(HOLIDAY_NAME_MAP)) {
    const pattern = new RegExp(`${chineseName}：\\s*(\\d{1,2})月(\\d{1,2})日[\\s\\S]*?至(?:(\\d{1,2})月)?(\\d{1,2})日`, 'm');
    const match = text.match(pattern);

    if (!match) continue;

    const startMonth = Number.parseInt(match[1], 10);
    const startDay = Number.parseInt(match[2], 10);
    const endMonth = match[3] ? Number.parseInt(match[3], 10) : startMonth;
    const endDay = Number.parseInt(match[4], 10);
    const start = formatDate(year, startMonth, startDay);
    const inclusiveEnd = formatDate(year, endMonth, endDay);

    events.push({
      id: `cn-holiday-${year}-${chineseName}`,
      title: `China Holiday: ${HOLIDAY_NAME_MAP[chineseName]}`,
      start,
      endExclusive: addDays(inclusiveEnd, 1),
    });
  }

  return events;
}

async function curlGet(url) {
  const { stdout } = await execFileAsync('curl', ['-ks', url], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function readCalendars() {
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

async function writeCalendars(calendars) {
  await fs.writeFile(TEMP_DATA_FILE, `${JSON.stringify(calendars, null, 2)}\n`, 'utf8');
  await fs.rename(TEMP_DATA_FILE, DATA_FILE);
}

function sortCalendars(calendars) {
  return [...calendars].sort((left, right) => left.year - right.year);
}

async function findOfficialNotice(year) {
  const query = `国务院办公厅关于${year}年部分节假日安排的通知`;
  const params = new URLSearchParams({
    q: query,
    t: 'zhengcelibrary_gw',
    p: '1',
    n: '5',
    sort: 'score',
    sortType: '1',
    searchfield: 'title:content:summary',
  });

  const payload = JSON.parse(await curlGet(`${SEARCH_API}?${params.toString()}`));
  const items = payload?.searchVO?.listVO || [];
  return items.find((item) => item.title?.includes(query)) || null;
}

async function main() {
  const nowIso = new Date().toISOString();
  const currentYear = new Date().getUTCFullYear();
  const targetYear = currentYear + 1;
  const calendars = await readCalendars();

  if (!calendars.some((calendar) => calendar.year === targetYear)) {
    calendars.push(createPlaceholderCalendar(targetYear));
  }

  const targetCalendar = calendars.find((calendar) => calendar.year === targetYear);
  const wasPublished = targetCalendar.published === true;
  const notice = await findOfficialNotice(targetYear);

  targetCalendar.lastCheckedAt = nowIso;

  if (!notice?.url) {
    await writeCalendars(sortCalendars(calendars));
    console.log(`No official holiday notice found yet for ${targetYear}.`);
    return;
  }

  const articleText = stripHtml(await curlGet(notice.url));
  const events = parseHolidayEventsFromNotice(articleText, targetYear);

  targetCalendar.label = `China Holidays ${targetYear}`;
  targetCalendar.description = events.length >= 7
    ? 'Official State Council holiday schedule'
    : 'Official notice found, awaiting full holiday parse';
  targetCalendar.enabled = events.length > 0;
  targetCalendar.published = events.length > 0;
  targetCalendar.sourceUrl = notice.url;
  targetCalendar.publishedAt = notice.pubtimeStr || '';
  targetCalendar.events = events;

  await writeCalendars(sortCalendars(calendars));

  if (!wasPublished && targetCalendar.published) {
    await createHolidayPublishedAdminNotice({
      year: targetYear,
      sourceUrl: targetCalendar.sourceUrl,
      publishedAt: targetCalendar.publishedAt,
      createdAt: nowIso,
    });
  }

  console.log(`Holiday calendars updated for ${targetYear}: ${events.length} events.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
