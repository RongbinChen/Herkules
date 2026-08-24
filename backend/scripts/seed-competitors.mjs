// Push src/data/competitors.js into the Competitor table (names, aliases,
// country, watchType). Same upsert as the POST /api/chinabidding/competitors/seed
// route, runnable from the shell so an alias fix can go live right after a
// deploy without minting a token. Idempotent, insert/update only.
//
//   node scripts/seed-competitors.mjs
import { PrismaClient } from '@prisma/client';
import { COMPETITOR_SEED } from '../src/data/competitors.js';

const prisma = new PrismaClient();

async function main() {
  for (const c of COMPETITOR_SEED) {
    const data = {
      name: c.name,
      aliases: c.aliases,
      country: c.country ?? null,
      notes: c.notes ?? null,
      watchType: c.watchType ?? 'COMPETITOR',
    };
    const before = await prisma.competitor.findUnique({ where: { name: c.name }, select: { aliases: true } });
    await prisma.competitor.upsert({ where: { name: c.name }, create: data, update: data });
    const added = before ? data.aliases.filter((a) => !before.aliases.includes(a)) : data.aliases;
    if (!before) console.log(`+ ${c.name} (new)`);
    else if (added.length) console.log(`~ ${c.name}: +${added.join(', +')}`);
  }
  console.log(`\nseeded ${COMPETITOR_SEED.length} profiles`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
