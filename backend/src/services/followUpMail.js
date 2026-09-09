// Mail for project follow-up milestones.
//
// Same shape as hotProjectMail.js: no database access, the caller passes the
// recipients and the record. One mail per milestone per day — the sweep in
// followUps.js decides when; this file only decides what it says.
import { sendMail } from './mailer.js';
import { renderEmail } from './emailTemplate.js';

const NOTE = {
  en: 'Sent to whoever is following this project up, as its dates come due.',
  zh: '项目执行到期提醒，发给该项目的跟进人。',
};

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

// The subject carries the urgency, because that is the part read on a phone
// lock screen — and for an overdue letter of credit that is the whole message.
function subjectLine({ followUp, name, due }) {
  const tag = due.urgency === 'overdue'
    ? `逾期 ${-due.delta} 天 / ${-due.delta}d overdue`
    : due.urgency === 'today'
      ? '今天到期 / due today'
      : `还有 ${due.delta} 天 / in ${due.delta}d`;
  return `[Herkules 项目跟进] ${followUp.title} — ${name}（${tag}）`;
}

export async function milestoneReminderMail({ to, cc, bcc, milestone, followUp, meta, due }) {
  if (!to) return false;
  const nameZh = milestone.label || meta?.zh || milestone.kind;
  const nameEn = milestone.label || meta?.en || milestone.kind;

  const facts = [
    { k: { en: 'Project', zh: '项目' }, v: followUp.title },
    { k: { en: 'Milestone', zh: '节点' }, v: nameEn === nameZh ? nameEn : `${nameEn} / ${nameZh}` },
    { k: { en: 'Due', zh: '到期' }, v: fmt(milestone.dueDate) },
  ];
  if (followUp.orderNo) facts.push({ k: { en: 'Order no.', zh: '合同号' }, v: followUp.orderNo });
  if (followUp.customer?.name) facts.push({ k: { en: 'Customer', zh: '客户' }, v: followUp.customer.name });
  if (milestone.notes) facts.push({ k: { en: 'Note', zh: '备注' }, v: milestone.notes });

  const intro = due.urgency === 'overdue'
    ? {
      en: `This milestone was due on ${fmt(milestone.dueDate)} and is now ${-due.delta} day(s) overdue.`,
      zh: `该节点原定 ${fmt(milestone.dueDate)}，已逾期 ${-due.delta} 天。`,
    }
    : due.urgency === 'today'
      ? { en: `This milestone is due today.`, zh: '该节点今天到期。' }
      : {
        en: `This milestone is due in ${due.delta} day(s), on ${fmt(milestone.dueDate)}.`,
        zh: `该节点还有 ${due.delta} 天到期（${fmt(milestone.dueDate)}）。`,
      };

  try {
    const mail = renderEmail({
      // An overdue date is the one case where the mail should look different
      // from every other notification in the inbox.
      tone: due.urgency === 'overdue' ? 'alert' : 'info',
      title: {
        en: `${nameEn} — ${followUp.title}`,
        zh: `${nameZh} — ${followUp.title}`,
      },
      intro,
      facts,
      action: {
        label: { en: 'Open in Herkules CRM', zh: '在系统中查看' },
        url: `https://www.herkulesgroup-china.com/followups/${followUp.id}`,
      },
      note: NOTE,
    });
    return await sendMail({
      to, cc, bcc,
      subject: subjectLine({ followUp, name: nameZh, due }),
      text: mail.text,
      html: mail.html,
    });
  } catch (err) {
    console.error(`[followups] mail failed: ${err.message}`);
    return false;
  }
}
