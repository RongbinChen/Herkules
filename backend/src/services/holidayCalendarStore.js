// Where the holiday calendars live on disk.
//
// There are two files, and the split is the point. The one in src/data is the
// seed: it ships with the code, it is what a fresh checkout starts from, and
// nothing ever writes to it. The other is runtime state, written by the
// two-monthly updater as it checks whether the State Council has published
// next year's schedule.
//
// They used to be the same file, which meant a scheduled job wrote into the
// working tree of a git checkout. Every run left `lastCheckedAt` modified, and
// the deploy script — which refuses to deploy a dirty working tree, on the
// reasonable theory that someone might be editing on the server — aborted the
// next deployment. Deploys were being blocked by a timestamp.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEED_FILE = path.join(__dirname, '..', 'data', 'holiday-calendars.json');
// Outside src/, and gitignored, so the updater never touches a tracked file.
// HOLIDAY_DATA_FILE moves it off the checkout entirely if that is ever wanted.
export const STATE_FILE = process.env.HOLIDAY_DATA_FILE
  || path.join(__dirname, '..', '..', 'data', 'holiday-calendars.json');

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// State wins per year, seed fills the years it does not have — so a release
// that adds a year reaches a server that has been running for months, while a
// year the updater has already resolved is not reverted to its placeholder.
// To force a hand-edited year onto a running server, drop that year from the
// state file and let the seed take over.
export async function readHolidayCalendars() {
  const seed = (await readJson(SEED_FILE)) || [];
  const state = await readJson(STATE_FILE);
  if (!state) return seed;

  const byYear = new Map(seed.map((calendar) => [calendar.year, calendar]));
  for (const calendar of state) byYear.set(calendar.year, calendar);
  return [...byYear.values()];
}

export async function writeHolidayCalendars(calendars) {
  const temp = `${STATE_FILE}.tmp`;
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(calendars, null, 2)}\n`, 'utf8');
  // Rename over the old file: a crash mid-write leaves the previous state
  // intact rather than a truncated JSON the app cannot parse on boot.
  await fs.rename(temp, STATE_FILE);
}
