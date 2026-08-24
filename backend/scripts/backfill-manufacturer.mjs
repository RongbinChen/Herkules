// Fill in BidProject.manufacturer for announcements stored before the scraper
// read that field, and attribute the win to the company that built the machine
// when the winner was a trading company bidding on its behalf.
//
// Reads only text already in the database — no model calls, no network, no
// deletes. It fills blanks and never overwrites a manufacturer or a competitor
// link that is already set, so hand-corrected rows survive a re-run.
//
//   node scripts/backfill-manufacturer.mjs --dry-run   # report, write nothing
//   node scripts/backfill-manufacturer.mjs             # apply
//
// Deliberately standalone (its own PrismaClient): importing the scraper service
// would boot the API server, whose port is already taken by the running one.
import { PrismaClient } from '@prisma/client';
import { extractManufacturer } from '../src/services/chinabiddingParser.js';
import { matchCompanyProfile } from '../src/services/companyName.js';
import { withProfileExclusions } from '../src/data/competitors.js';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const competitors = withProfileExclusions(await prisma.competitor.findMany({
    select: { id: true, name: true, aliases: true, watchType: true },
  }));
  console.log(`profiles: ${competitors.length} tracked companies`);

  const rows = await prisma.bidProject.findMany({
    where: { rawContent: { not: null }, manufacturer: null },
    select: { id: true, projectName: true, rawContent: true, winner: true, competitorId: true },
    orderBy: { id: 'asc' },
  });
  console.log(`scanning: ${rows.length} rows without a manufacturer\n`);

  let filled = 0;
  const reattributed = [];

  for (const row of rows) {
    const manufacturer = extractManufacturer(row.rawContent);
    if (!manufacturer) continue;
    filled++;

    // Only rows with no owner yet are up for attribution: a link made from the
    // winner is the more direct evidence and stays untouched.
    let competitorId = row.competitorId;
    if (competitorId == null) {
      const match = matchCompanyProfile(manufacturer, competitors);
      if (match) {
        competitorId = match.id;
        reattributed.push({ id: row.id, name: row.projectName, winner: row.winner, manufacturer, to: match.name, watchType: match.watchType });
      }
    }

    if (!dryRun) {
      await prisma.bidProject.update({
        where: { id: row.id },
        data: { manufacturer, ...(competitorId !== row.competitorId ? { competitorId } : {}) },
      });
    }
  }

  console.log(`${dryRun ? 'would fill' : 'filled'}: ${filled} manufacturers`);
  console.log(`${dryRun ? 'would attribute' : 'attributed'}: ${reattributed.length} wins\n`);
  for (const r of reattributed) {
    console.log(`  #${r.id} → ${r.to} (${r.watchType})`);
    console.log(`      ${r.name.slice(0, 80)}`);
    console.log(`      winner: ${r.winner || '—'} | manufacturer: ${r.manufacturer}`);
  }
  if (dryRun) console.log('\ndry run — nothing was written');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
