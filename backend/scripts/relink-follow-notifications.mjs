// Repoint "关注项目有新公告" alerts at the announcement they are actually about.
//
// They used to be linked back to the row the user follows — usually the
// original tender, months old. The bell dates and sorts its list by the linked
// announcement's publishDate, so those alerts sank to the bottom of the list
// and their "Source" link opened the wrong page. New alerts link correctly
// (notifyThreadFollowers); this fixes the ones already sent.
//
// Which announcement each alert was about is not in its text, but the alert is
// written milliseconds after the announcement row it reports, so the pairing is
// recoverable: same thread, created within a few seconds, exactly one candidate.
// Anything ambiguous is left alone and reported.
//
//   node scripts/relink-follow-notifications.mjs --dry-run
//   node scripts/relink-follow-notifications.mjs
//
// Rewrites nothing else: read state, type and recipient stay as they are. An
// award alert additionally gets the winner written into its text, which is what
// the current code would have produced.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');
const WINDOW_MS = 10_000;

async function main() {
  const alerts = await prisma.notification.findMany({
    where: { type: 'STATUS_CHANGE', message: { startsWith: '关注项目有新公告' } },
    select: { id: true, userId: true, projectId: true, message: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  console.log(`scanning: ${alerts.length} follow alerts\n`);

  let relinked = 0;
  let ambiguous = 0;
  let unchanged = 0;

  for (const alert of alerts) {
    const followed = alert.projectId
      ? await prisma.bidProject.findUnique({ where: { id: alert.projectId }, select: { threadKey: true } })
      : null;
    if (!followed?.threadKey) { unchanged++; continue; }

    const candidates = await prisma.bidProject.findMany({
      where: {
        threadKey: followed.threadKey,
        id: { not: alert.projectId },
        createdAt: { gte: new Date(alert.createdAt.getTime() - WINDOW_MS), lte: new Date(alert.createdAt.getTime() + WINDOW_MS) },
      },
      select: { id: true, projectName: true, infoClass: true, bidStage: true, winner: true, winningPrice: true, publishDate: true },
    });

    if (candidates.length === 0) { unchanged++; continue; }
    if (candidates.length > 1) {
      ambiguous++;
      console.log(`? #${alert.id}: ${candidates.length} candidates (${candidates.map(c => c.id).join(', ')}) — left alone`);
      continue;
    }

    const target = candidates[0];
    // An award alert predates the winner being written into the text; give it
    // the wording the current code produces for the same event.
    const message = target.bidStage === 'AWARD'
      ? `关注项目中标结果：${target.winner || '中标人未公布'} — ${target.projectName.slice(0, 80)}${target.winningPrice ? `（${target.winningPrice}）` : ''}`
      : alert.message;

    relinked++;
    const date = target.publishDate ? target.publishDate.toISOString().slice(0, 10) : '—';
    console.log(`→ #${alert.id}: project ${alert.projectId} → ${target.id} (${target.infoClass || target.bidStage}, ${date})`);
    if (message !== alert.message) console.log(`    text: ${message.slice(0, 90)}`);

    if (!dryRun) {
      await prisma.notification.update({ where: { id: alert.id }, data: { projectId: target.id, message } });
    }
  }

  console.log(`\n${dryRun ? 'would relink' : 'relinked'}: ${relinked}   ambiguous: ${ambiguous}   already fine: ${unchanged}`);
  if (dryRun) console.log('dry run — nothing was written');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
