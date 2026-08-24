// Mail for the hot-projects list: a project being added and a project getting a
// status update are both news to the people who run the list.
//
// Deliberately free of any database access — callers pass the recipients and
// the record. That keeps the same wording available to a one-off script (which
// brings its own Prisma client) as to the routes, without the script having to
// import the API server to get at it.
import { sendMail } from './mailer.js';
import { renderEmail } from './emailTemplate.js';

const PRIORITY_LABELS = { 1: '1 \u00b7 High', 2: '2 \u00b7 Mid time', 3: '3 \u00b7 Offer done' };

const NOTE = {
  en: 'Sent to administrators whenever a hot project is added or updated.',
  zh: '\u5185\u90e8\u9879\u76ee\u65b0\u589e\u6216\u6709\u66f4\u65b0\u65f6\uff0c\u90fd\u4f1a\u53d1\u8fd9\u5c01\u90ae\u4ef6\u7ed9\u7ba1\u7406\u5458\u3002',
};

function baseFacts(project) {
  const facts = [
    { k: { en: 'Customer', zh: '\u5ba2\u6237' }, v: project.customer },
    { k: { en: 'List', zh: '\u5217\u8868' }, v: project.category },
  ];
  if (project.machineType) facts.push({ k: { en: 'Machine', zh: '\u673a\u578b' }, v: project.machineType });
  if (project.priority) facts.push({ k: { en: 'Priority', zh: '\u4f18\u5148\u7ea7' }, v: PRIORITY_LABELS[project.priority] || String(project.priority) });
  if (project.owner?.name) facts.push({ k: { en: 'Owner', zh: '\u8d1f\u8d23\u4eba' }, v: project.owner.name });
  return facts;
}

// Best-effort: a mail failure must never fail the write that already succeeded.
async function send({ to, subject, title, intro, facts }) {
  if (!to) return false;
  try {
    const mail = renderEmail({
      title,
      intro,
      facts,
      action: {
        label: { en: 'Open in Herkules CRM', zh: '\u5728\u7cfb\u7edf\u4e2d\u67e5\u770b' },
        url: 'https://www.herkulesgroup-china.com/hotprojects',
      },
      note: NOTE,
    });
    return await sendMail({ to, subject, text: mail.text, html: mail.html });
  } catch (err) {
    console.error(`[hotProjects] mail failed: ${err.message}`);
    return false;
  }
}

export function newProjectMail({ to, project, creatorName }) {
  const what = project.requirements?.trim() || 'No requirements recorded yet.';
  const facts = [...baseFacts(project), { k: { en: 'Created by', zh: '\u521b\u5efa\u4eba' }, v: creatorName || '\u2014' }];
  if (project.deadline) {
    facts.push({ k: { en: 'Deadline', zh: '\u622a\u6b62' }, v: new Date(project.deadline).toISOString().slice(0, 10) });
  }
  return send({
    to,
    subject: `[Herkules Hot Projects] ${project.customer} \u2014 \u65b0\u589e\u9879\u76ee / new project`,
    title: { en: `New hot project \u2014 ${project.customer}`, zh: `\u65b0\u589e\u5185\u90e8\u9879\u76ee \u2014 ${project.customer}` },
    intro: { en: what, zh: what },
    facts,
  });
}

export function projectUpdateMail({ to, project, content, authorName }) {
  return send({
    to,
    subject: `[Herkules Hot Projects] ${project.customer} \u2014 \u9879\u76ee\u66f4\u65b0 / new update`,
    title: { en: `Hot project updated \u2014 ${project.customer}`, zh: `\u5185\u90e8\u9879\u76ee\u6709\u66f4\u65b0 \u2014 ${project.customer}` },
    intro: { en: content, zh: content },
    facts: [...baseFacts(project), { k: { en: 'Written by', zh: '\u586b\u5199\u4eba' }, v: authorName || '\u2014' }],
  });
}
