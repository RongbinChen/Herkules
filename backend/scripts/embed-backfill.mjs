#!/usr/bin/env node
// One-off (and re-runnable) backfill: embed every readable contract page that
// lacks a current embedding, by pushing its text to the DGX worker's /embed and
// storing the vector. Safe to run repeatedly — it only touches pages still
// missing a vector, so a second run after new uploads just tops them up.
//
// Runs on the VPS (needs DATABASE_URL and OCR_TOKEN, and the DGX tunnel up).
//   node backend/scripts/embed-backfill.mjs
//   node backend/scripts/embed-backfill.mjs --limit 200   # cap this run
import { PrismaClient } from '@prisma/client';
import { backfillEmbeddings, EMBED_MODEL } from '../src/services/contractEmbeddings.js';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const limit = Number(argOf('--limit') || 0) || Infinity;

const prisma = new PrismaClient();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

try {
  log(`embedding backfill start (model ${EMBED_MODEL})`);
  const t0 = Date.now();
  const { embedded, remaining } = await backfillEmbeddings(prisma, {
    limit,
    onProgress: (n) => process.stdout.write(`  embedded ${n}\r`),
  });
  process.stdout.write('\n');
  log(`done: ${embedded} pages embedded in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${remaining} still missing`);
} catch (e) {
  console.error('backfill failed:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
