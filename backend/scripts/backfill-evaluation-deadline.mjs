#!/usr/bin/env node
/**
 * Backfill `BidProject.deadline` for EVALUATION announcements.
 *
 * Evaluation notices carry no bid deadline; their live date is
 * "Ending Date of Evaluation Result" — the end of the public-notice window,
 * i.e. the last moment to file a complaint. The parser ignored that label
 * until 2026-08-17, so every evaluation row landed with `deadline = NULL` and
 * the Watching panel showed those projects with no date at all.
 *
 * Reads the stored `rawContent` (the label always falls inside the 5000-char
 * slice) and writes the parsed value. Only ever fills NULLs — an existing
 * deadline is left alone, and nothing is deleted.
 *
 *   node scripts/backfill-evaluation-deadline.mjs            # dry run
 *   node scripts/backfill-evaluation-deadline.mjs --apply    # write
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Same pattern and timezone anchoring as chinabiddingParser.matchDate.
const RE = /Ending Date of Evaluation Result[:：]\s*(\d{4}-\d{2}-\d{2})(?:\s*(\d{2}:\d{2}))?/i;

function parseDeadline(raw) {
  const m = raw?.match(RE);
  if (!m) return null;
  const d = new Date(m[2] ? `${m[1]}T${m[2]}:00+08:00` : m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

const rows = await prisma.bidProject.findMany({
  where: { deadline: null, rawContent: { contains: 'Ending Date of Evaluation Result' } },
  select: { id: true, projectName: true, bidStage: true, rawContent: true },
  orderBy: { id: 'asc' },
});

let filled = 0;
let unparsed = 0;

for (const r of rows) {
  const deadline = parseDeadline(r.rawContent);
  if (!deadline) {
    unparsed++;
    console.log(`  ?  ${r.id}  could not parse  ${r.projectName.slice(0, 60)}`);
    continue;
  }
  filled++;
  console.log(`  ✓  ${r.id}  ${deadline.toISOString().slice(0, 10)}  ${r.projectName.slice(0, 60)}`);
  if (APPLY) await prisma.bidProject.update({ where: { id: r.id }, data: { deadline } });
}

console.log(`\n${rows.length} candidates · ${filled} ${APPLY ? 'updated' : 'would be filled'} · ${unparsed} unparsed`);
if (!APPLY && filled) console.log('Dry run — re-run with --apply to write.');

await prisma.$disconnect();
