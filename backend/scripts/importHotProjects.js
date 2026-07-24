// Import the internal WAV "Sales Open Projects" Excel into the HotProject module.
//   node scripts/importHotProjects.js <file.xlsx> [--append]
// Reads the "Enquiry - Open Projects" and "Potential Projects" sheets.
// The Status column's running "Updated on …" log is split into individual
// HotProjectUpdate rows (content kept verbatim; dates left null — ambiguous years).
// Refuses to run on a non-empty table unless --append is given.
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

const FILE = process.argv[2];
const APPEND = process.argv.includes('--append');
if (!FILE) {
  console.error('Usage: node scripts/importHotProjects.js <file.xlsx> [--append]');
  process.exit(1);
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
    for (const content of splitUpdates(status)) {
      await prisma.hotProjectUpdate.create({
        data: { projectId: project.id, content, date: null, authorId: ownerId },
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
