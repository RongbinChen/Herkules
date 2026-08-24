// Send the "new hot project" mail for a project that was added before the
// routes sent one (or when SMTP was down). Same wording as the automatic mail —
// it calls the very same builder — so a resent notice is indistinguishable from
// one that went out on time.
//
//   node scripts/send-hot-project-mail.mjs <projectId> [--dry-run]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { newProjectMail } from '../src/services/hotProjectMail.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const id = Number(args.find((a) => /^\d+$/.test(a)));

async function main() {
  if (!id) throw new Error('usage: node scripts/send-hot-project-mail.mjs <projectId> [--dry-run]');

  const project = await prisma.hotProject.findUnique({
    where: { id },
    include: { owner: { select: { name: true } } },
  });
  if (!project) throw new Error(`no hot project with id ${id}`);

  const creator = project.createdById
    ? await prisma.user.findUnique({ where: { id: project.createdById }, select: { name: true } })
    : null;
  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { email: true } });
  const to = admins.map((a) => a.email).filter(Boolean).join(',');

  console.log(`project #${project.id}: ${project.customer}`);
  console.log(`created:    ${project.createdAt.toISOString()} by ${creator?.name || '—'}`);
  console.log(`recipients: ${to || '(none)'}`);

  if (dryRun) {
    console.log('\ndry run — nothing was sent');
    return;
  }
  console.log(`sent: ${await newProjectMail({ to, project, creatorName: creator?.name })}`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
