// Import the internal WAV "Sales Open Projects" Excel into the HotProject module.
//   node scripts/importHotProjects.js <file.xlsx> [--append] [--asof YYYY-MM-DD]
// Reads the "Enquiry - Open Projects" and "Potential Projects" sheets.
// The Status column's running "Updated on …" log is split into individual
// HotProjectUpdate rows (content kept verbatim). The sheet's dates carry no
// year, so years are inferred: logs are chronological, anchor at --asof (the
// snapshot date, default today) and walk backwards, decrementing the year
// whenever a date would exceed the entry that follows it.
// Refuses to run on a non-empty table unless --append is given.
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

const FILE = process.argv[2];
const APPEND = process.argv.includes('--append');
const asofIdx = process.argv.indexOf('--asof');
const ASOF = asofIdx > -1 ? new Date(`${process.argv[asofIdx + 1]}T12:00:00+08:00`) : new Date();
if (!FILE || isNaN(ASOF)) {
  console.error('Usage: node scripts/importHotProjects.js <file.xlsx> [--append] [--asof YYYY-MM-DD]');
  process.exit(1);
}

// "Updated on March 11(st|th)?(, 2023)?" → {m, d, y|null}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function parseUpdateHead(content) {
  const m = content.match(/^Updated\s+on\s+([A-Za-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?/i);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase().replace(/\.$/, '')];
  if (!mon) return null;
  return { m: mon, d: parseInt(m[2]), y: m[3] ? parseInt(m[3]) : null };
}
const mkDate = (y, m, d) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+08:00`);

// Assign a date to each log entry (chronological array), inferring years backwards from ASOF.
function dateEntries(entries) {
  const dates = new Array(entries.length).fill(null);
  let upper = ASOF;
  for (let i = entries.length - 1; i >= 0; i--) {
    const h = parseUpdateHead(entries[i]);
    if (!h) continue;
    let date;
    if (h.y) date = mkDate(h.y, h.m, h.d);
    else {
      let y = upper.getFullYear();
      date = mkDate(y, h.m, h.d);
      while (date > upper) { y--; date = mkDate(y, h.m, h.d); }
    }
    dates[i] = date;
    upper = date;
  }
  return dates;
}

// Map the sheet's Processor names to system user ids (record owners).
const OWNER_MAP = { chen: 5, bao: 8 };

const parseDate = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // dd.mm.yyyy
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00+08:00`);
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/); // yyyy.mm.dd
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+08:00`);
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

// Split a running status log into individual entries on "Updated on …" markers.
const splitUpdates = (status) => {
  const text = String(status || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const parts = text.split(/\n(?=Updated on )/i);
  return parts.map((p) => p.trim()).filter(Boolean);
};

function rowsOf(sheet, headerRowIdx) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows.slice(headerRowIdx + 1).filter((r) => String(r[1] || '').trim()); //需要 Customer 列非空
}

async function importSheet(rows, category, createdById) {
  let projects = 0, updates = 0;
  for (const r of rows) {
    const [no, customer, dateOfReceipt, processor, forwardedOn, requirements, deadline, priority, status] = r;
    const proc = String(processor || '').trim();
    const ownerId = OWNER_MAP[proc.toLowerCase()] || null;
    const project = await prisma.hotProject.create({
      data: {
        category,
        customer: String(customer).trim(),
        dateOfReceipt: parseDate(dateOfReceipt),
        processor: proc || null,
        ownerId,
        forwardedOn: String(forwardedOn || '').trim() || null,
        requirements: String(requirements || '').replace(/\r\n/g, '\n').trim() || null,
        deadline: parseDate(deadline),
        priority: parseInt(priority) || null,
        visibility: 'TEAM',
        sortNo: parseInt(no) || null,
        createdById,
      },
    });
    projects++;
    const entries = splitUpdates(status);
    const dates = dateEntries(entries);
    for (let i = 0; i < entries.length; i++) {
      await prisma.hotProjectUpdate.create({
        data: { projectId: project.id, content: entries[i], date: dates[i], authorId: ownerId },
      });
      updates++;
    }
  }
  return { projects, updates };
}

async function main() {
  const existing = await prisma.hotProject.count();
  if (existing > 0 && !APPEND) {
    console.error(`HotProject already has ${existing} rows — pass --append to add anyway.`);
    process.exit(1);
  }
  const wb = XLSX.readFile(FILE);
  const admin = await prisma.user.findFirst({ where: { isAdmin: true }, orderBy: { id: 'asc' } });
  const createdById = admin?.id ?? null;

  const open = wb.Sheets['Enquiry - Open Projects'];
  const potential = wb.Sheets['Potential Projects'];
  if (open) {
    const res = await importSheet(rowsOf(open, 3), 'OPEN', createdById);
    console.log(`OPEN: ${res.projects} projects, ${res.updates} updates`);
  }
  if (potential) {
    const res = await importSheet(rowsOf(potential, 0), 'POTENTIAL', createdById);
    console.log(`POTENTIAL: ${res.projects} projects, ${res.updates} updates`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
