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
// The list names as they read in the app. The bare enum ('OPEN') looked like a
// status next to a mail announcing a signed contract, which it never was.
// Fact values are single-language by template contract (only the keys are
// bilingual), so these read the way the tabs in the app do.
const CATEGORY_LABELS = { OPEN: 'Open Projects', POTENTIAL: 'Potential Projects', REVAMP: 'Revamp' };
const OUTCOME_LABELS = { WON: 'Closed \u00b7 Won', LOST: 'Closed \u00b7 Lost' };

const NOTE = {
  en: 'Sent to administrators whenever a hot project is added or updated.',
  zh: '\u5185\u90e8\u9879\u76ee\u65b0\u589e\u6216\u6709\u66f4\u65b0\u65f6\uff0c\u90fd\u4f1a\u53d1\u8fd9\u5c01\u90ae\u4ef6\u7ed9\u7ba1\u7406\u5458\u3002',
};

function baseFacts(project) {
  const facts = [
    { k: { en: 'Customer', zh: '\u5ba2\u6237' }, v: project.customer },
    { k: { en: 'List', zh: '\u5217\u8868' }, v: CATEGORY_LABELS[project.category] || project.category },
  ];
  // Only shown once a project has actually ended — an open project's status is
  // just the list it sits on, and a second row saying "running" adds nothing.
  if (project.closedAt && OUTCOME_LABELS[project.outcome]) {
    facts.push({ k: { en: 'Status', zh: '\u72b6\u6001' }, v: OUTCOME_LABELS[project.outcome] });
  }
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

// A project ending is the one piece of news the update mail could never carry:
// it reads as a status line rather than "one more update on a live project".
export function projectClosedMail({ to, project, content, authorName }) {
  const won = project.outcome === 'WON';
  return send({
    to,
    subject: `[Herkules Hot Projects] ${project.customer} \u2014 ${won ? '\u9879\u76ee\u8d62\u5355' : '\u9879\u76ee\u4e22\u5355'} / project ${won ? 'won' : 'lost'}`,
    title: {
      en: `Hot project closed (${won ? 'won' : 'lost'}) \u2014 ${project.customer}`,
      zh: `\u5185\u90e8\u9879\u76ee\u5df2\u7ed3\u9879\uff08${won ? '\u8d62\u5355' : '\u4e22\u5355'}\uff09 \u2014 ${project.customer}`,
    },
    intro: { en: content, zh: content },
    facts: [...baseFacts(project), { k: { en: 'Closed by', zh: '\u7ed3\u9879\u4eba' }, v: authorName || '\u2014' }],
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
