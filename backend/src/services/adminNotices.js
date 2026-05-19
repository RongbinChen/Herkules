import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'admin-notices.json');
const TEMP_DATA_FILE = `${DATA_FILE}.tmp`;

async function readAdminNotices() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeAdminNotices(notices) {
  await fs.writeFile(TEMP_DATA_FILE, `${JSON.stringify(notices, null, 2)}\n`, 'utf8');
  await fs.rename(TEMP_DATA_FILE, DATA_FILE);
}

function sortNotices(notices) {
  return [...notices].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

export async function getVisibleAdminNoticesForUser(userId) {
  const notices = await readAdminNotices();
  return sortNotices(
    notices.filter((notice) => notice.active !== false && !(notice.dismissedByUserIds || []).includes(userId))
  );
}

export async function dismissAdminNoticeForUser(noticeId, userId) {
  const notices = await readAdminNotices();
  const nextNotices = notices.map((notice) => {
    if (notice.id !== noticeId) {
      return notice;
    }

    const dismissedByUserIds = Array.isArray(notice.dismissedByUserIds) ? notice.dismissedByUserIds : [];
    if (dismissedByUserIds.includes(userId)) {
      return notice;
    }

    return {
      ...notice,
      dismissedByUserIds: [...dismissedByUserIds, userId],
    };
  });

  await writeAdminNotices(nextNotices);
  return sortNotices(nextNotices);
}

export async function createHolidayPublishedAdminNotice({ year, sourceUrl = '', publishedAt = '', createdAt = new Date().toISOString() }) {
  const notices = await readAdminNotices();
  const noticeId = `china-holidays-${year}-published`;

  if (notices.some((notice) => notice.id === noticeId)) {
    return false;
  }

  notices.push({
    id: noticeId,
    type: 'holiday-calendar-published',
    title: `China Holidays ${year} published`,
    message: `The official China holiday calendar for ${year} has been published and added to the system.`,
    sourceUrl,
    publishedAt,
    createdAt,
    active: true,
    dismissedByUserIds: [],
  });

  await writeAdminNotices(notices);
  return true;
}
