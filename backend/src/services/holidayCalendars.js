import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'holiday-calendars.json');
const TEMP_DATA_FILE = `${DATA_FILE}.tmp`;
const OFFICIAL_SEARCH_API = 'https://sousuo.www.gov.cn/search-gov/data';
const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24 * 60;
let updateInFlight = null;

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
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return formatDate(year, month, day);
}

function parseHolidayEventsFromNotice(text, year) {
  const holidayNames = Object.keys(HOLIDAY_NAME_MAP);
  const events = [];

  for (const chineseName of holidayNames) {
    const pattern = new RegExp(`${chineseName}：\\s*(\\d{1,2})月(\\d{1,2})日[\\s\\S]*?至(?:(\\d{1,2})月)?(\\d{1,2})日`, 'm');
    const match = text.match(pattern);

    if (!match) {
      continue;
    }

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

async function readHolidayCalendars() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeHolidayCalendars(calendars) {
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

  const response = await fetch(`${OFFICIAL_SEARCH_API}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Holiday search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const items = payload?.searchVO?.listVO || [];

  return items.find((item) => item.title?.includes(query)) || null;
}

async function fetchNoticeText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      Referer: 'https://www.gov.cn/',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Holiday notice fetch failed with status ${response.status}`);
  }

  return stripHtml(await response.text());
}

export async function getHolidayCalendars() {
  return sortCalendars(await readHolidayCalendars());
}

export async function checkAndUpdateHolidayCalendars() {
  if (updateInFlight) {
    return updateInFlight;
  }

  updateInFlight = (async () => {
    const nowIso = new Date().toISOString();
    const calendars = await readHolidayCalendars();
    const currentYear = new Date().getUTCFullYear();
    const targetYear = currentYear + 1;

    if (!calendars.some((calendar) => calendar.year === targetYear)) {
      calendars.push(createPlaceholderCalendar(targetYear));
    }

    const targetCalendar = calendars.find((calendar) => calendar.year === targetYear);

    if (targetCalendar?.published) {
      targetCalendar.lastCheckedAt = nowIso;
      await writeHolidayCalendars(sortCalendars(calendars));
      return;
    }

    try {
      const notice = await findOfficialNotice(targetYear);

      if (!notice?.url) {
        targetCalendar.lastCheckedAt = nowIso;
        await writeHolidayCalendars(sortCalendars(calendars));
        return;
      }

      const noticeText = await fetchNoticeText(notice.url);
      const events = parseHolidayEventsFromNotice(noticeText, targetYear);

      targetCalendar.label = `China Holidays ${targetYear}`;
      targetCalendar.description = events.length >= 7
        ? 'Official State Council holiday schedule'
        : 'Official notice found, awaiting full holiday parse';
      targetCalendar.enabled = events.length > 0;
      targetCalendar.published = events.length > 0;
      targetCalendar.sourceUrl = notice.url;
      targetCalendar.publishedAt = notice.pubtimeStr || '';
      targetCalendar.lastCheckedAt = nowIso;
      targetCalendar.events = events;

      await writeHolidayCalendars(sortCalendars(calendars));
    } catch (error) {
      console.error('Holiday calendar auto-update failed:', error);
      targetCalendar.lastCheckedAt = nowIso;
      await writeHolidayCalendars(sortCalendars(calendars));
    }
  })();

  try {
    await updateInFlight;
  } finally {
    updateInFlight = null;
  }
}

export function startHolidayCalendarUpdater() {
  checkAndUpdateHolidayCalendars().catch((error) => {
    console.error('Initial holiday calendar update failed:', error);
  });

  return setInterval(() => {
    checkAndUpdateHolidayCalendars().catch((error) => {
      console.error('Scheduled holiday calendar update failed:', error);
    });
  }, CHECK_INTERVAL_MS);
}
