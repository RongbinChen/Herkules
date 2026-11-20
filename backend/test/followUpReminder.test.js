import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEmail } from '../src/services/emailTemplate.js';
import { milestoneReminderParts } from '../src/services/followUpMail.js';
import {
  bccSpec,
  chinaDay,
  milestoneStanding,
  optionalCcSpec,
  reminderDue,
  resolveReminderRecipients,
} from '../src/services/followUpReminder.js';

// The reported mail. Due date 2026-11-15 is right; on 2026-11-10 in Shanghai
// this letter of credit is five days out, and 5 is not an L/C lead day
// (30, 14, 7, 1), so the morning sweep stays quiet.
const TODAY = '2026-11-10';
const DUE = '2026-11-15';
const TITLE = 'Shenyang Fortune Precision Equipment Co., Ltd. — GRG-FCJM-202608A';
const LC = { en: 'L/C to be opened by', zh: '信用证开证截止' };

function lcLead() {
  const src = readFileSync(new URL('../src/services/followUps.js', import.meta.url), 'utf8');
  const found = src.match(/kind: 'LC_OPEN_DEADLINE'[\s\S]*?lead: (\[[^\]]+\])/);
  assert.ok(found, 'L/C open lead missing from the catalogue');
  return JSON.parse(found[1]);
}

function milestone(dueDate, extra = {}) {
  return {
    kind: 'LC_OPEN_DEADLINE',
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    remindDaysBefore: lcLead(),
    ...extra,
  };
}

function project() {
  return {
    id: 42,
    title: TITLE,
    orderNo: 'GRG-FCJM-202608A',
    customer: { name: 'Shenyang Fortune Precision Equipment Co., Ltd.' },
  };
}

function wording(dueDate, today, extra) {
  const row = milestone(dueDate, extra);
  const due = milestoneStanding(row, today);
  assert.ok(due, `expected a standing for ${dueDate} on ${today}`);
  const parts = milestoneReminderParts({
    milestone: row, followUp: project(), meta: LC, due,
  });
  const mail = renderEmail(parts);
  return { due, parts, mail, scheduled: reminderDue(row, today) };
}

test('L/C open still reminds on 30, 14, 7 and 1 days, not on day 5', () => {
  assert.deepEqual(lcLead(), [30, 14, 7, 1]);
});

test('a manual L/C reminder five Shanghai days out says 5, and the sweep stays quiet', () => {
  const row = milestone(DUE);
  assert.equal(chinaDay(row.dueDate), DUE);
  assert.deepEqual(milestoneStanding(row, TODAY), { urgency: 'upcoming', delta: 5 });
  assert.equal(reminderDue(row, TODAY), null);

  const { parts, mail } = wording(DUE, TODAY);
  assert.equal(parts.intro.en, 'This milestone is due in 5 day(s), on 2026-11-15.');
  assert.equal(parts.intro.zh, '该节点还有 5 天到期（2026-11-15）。');
  assert.equal(parts.title.en, `L/C to be opened by — ${TITLE}`);
  assert.equal(parts.title.zh, `信用证开证截止 — ${TITLE}`);
  assert.equal(
    parts.subject,
    `[Herkules 项目跟进] ${TITLE} — 信用证开证截止（还有 5 天 / in 5d）`,
  );
  assert.equal(parts.tone, 'info');
  assert.match(mail.text, /This milestone is due in 5 day\(s\), on 2026-11-15\./);
  assert.match(mail.text, /该节点还有 5 天到期（2026-11-15）。/);
  assert.match(mail.html, /This milestone is due in 5 day\(s\), on 2026-11-15\./);
  assert.match(mail.text, /Sent to whoever is following this project up, as its dates come due\./);
  assert.doesNotMatch(`${parts.subject}\n${mail.text}`, /due in 0 day|还有 0 天|in 0d|0 day\(s\)/);
});

test('a date-only due string stands on the same China day as UTC midnight', () => {
  const asDate = milestoneStanding({ dueDate: new Date('2026-11-15T00:00:00.000Z') }, TODAY);
  const asDay = milestoneStanding({ dueDate: '2026-11-15' }, TODAY);
  assert.deepEqual(asDate, { urgency: 'upcoming', delta: 5 });
  assert.deepEqual(asDay, asDate);
});

test('standing follows Asia/Shanghai when UTC is still the previous day', () => {
  // 16:30 UTC on the 10th is 00:30 on the 11th in Shanghai.
  const today = chinaDay(new Date('2026-11-10T16:30:00Z'));
  assert.equal(today, '2026-11-11');
  assert.equal(chinaDay(new Date('2026-11-10T15:59:00Z')), '2026-11-10');
  assert.deepEqual(
    milestoneStanding({ dueDate: new Date('2026-11-15T00:00:00.000Z') }, today),
    { urgency: 'upcoming', delta: 4 },
  );
});

test('due today is said as today, not as zero days, and the sweep does send', () => {
  const { due, scheduled, parts, mail } = wording(TODAY, TODAY);
  assert.deepEqual(due, { urgency: 'today', delta: 0 });
  assert.deepEqual(scheduled, due);
  assert.equal(parts.intro.en, 'This milestone is due today.');
  assert.equal(parts.intro.zh, '该节点今天到期。');
  assert.match(parts.subject, /今天到期 \/ due today/);
  assert.equal(parts.tone, 'info');
  assert.match(mail.text, /This milestone is due today\./);
  assert.match(mail.text, /该节点今天到期。/);
  assert.doesNotMatch(`${parts.subject}\n${parts.intro.en}\n${parts.intro.zh}`, /0 day|还有 0|in 0d/);
});

test('two days overdue is said as overdue, even though the sweep skips that day', () => {
  const dueOn = '2026-11-08';
  const row = milestone(dueOn);
  assert.equal(reminderDue(row, TODAY), null);
  const { due, parts, mail } = wording(dueOn, TODAY);
  assert.deepEqual(due, { urgency: 'overdue', delta: -2 });
  assert.equal(
    parts.intro.en,
    'This milestone was due on 2026-11-08 and is now 2 day(s) overdue.',
  );
  assert.equal(parts.intro.zh, '该节点原定 2026-11-08，已逾期 2 天。');
  assert.match(parts.subject, /逾期 2 天 \/ 2d overdue/);
  assert.equal(parts.tone, 'alert');
  assert.match(mail.text, /now 2 day\(s\) overdue/);
  assert.match(mail.text, /已逾期 2 天/);
  assert.doesNotMatch(`${parts.subject}\n${mail.text}`, /due in 0 day|还有 0 天/);
});

test('the sweep still mails on a lead day, on the first overdue day, and every third overdue day', () => {
  const lead = lcLead();
  for (const days of lead) {
    const today = chinaDay(new Date(Date.parse(`${DUE}T00:00:00Z`) - days * 86400000));
    const standing = milestoneStanding(milestone(DUE), today);
    assert.deepEqual(standing, { urgency: 'upcoming', delta: days });
    assert.deepEqual(reminderDue(milestone(DUE), today), standing);
    const parts = milestoneReminderParts({
      milestone: milestone(DUE), followUp: project(), meta: LC, due: standing,
    });
    assert.match(parts.intro.en, new RegExp(`due in ${days} day\\(s\\), on ${DUE}`));
    assert.match(parts.subject, new RegExp(`还有 ${days} 天 / in ${days}d`));
  }

  const overdue = (n) => {
    const today = chinaDay(new Date(Date.parse(`${DUE}T00:00:00Z`) + n * 86400000));
    const row = milestone(DUE);
    return { today, standing: milestoneStanding(row, today), scheduled: reminderDue(row, today) };
  };
  const day1 = overdue(1);
  assert.deepEqual(day1.standing, { urgency: 'overdue', delta: -1 });
  assert.deepEqual(day1.scheduled, day1.standing);
  const day2 = overdue(2);
  assert.deepEqual(day2.standing, { urgency: 'overdue', delta: -2 });
  assert.equal(day2.scheduled, null);
  const day3 = overdue(3);
  assert.deepEqual(day3.standing, { urgency: 'overdue', delta: -3 });
  assert.deepEqual(day3.scheduled, day3.standing);

  const parts = milestoneReminderParts({
    milestone: milestone(DUE), followUp: project(), meta: LC, due: day1.standing,
  });
  assert.match(parts.intro.en, /1 day\(s\) overdue/);
  assert.match(parts.subject, /逾期 1 天 \/ 1d overdue/);
});

test('a finished milestone or one already mailed today stays off the sweep, and still has a real standing', () => {
  const open = milestone(DUE);
  const reminded = milestone(DUE, { lastRemindedOn: '2026-11-08' });
  assert.deepEqual(milestoneStanding(reminded, '2026-11-08'), { urgency: 'upcoming', delta: 7 });
  assert.equal(reminderDue(reminded, '2026-11-08'), null);
  assert.deepEqual(reminderDue(open, '2026-11-08'), { urgency: 'upcoming', delta: 7 });

  const done = milestone(DUE, { doneAt: new Date('2026-11-01T00:00:00Z') });
  assert.equal(reminderDue(done, TODAY), null);
  assert.deepEqual(milestoneStanding(done, TODAY), { urgency: 'upcoming', delta: 5 });
});

test('manual notify uses the standing helper and does not invent a zero-day fallback', () => {
  const route = readFileSync(new URL('../src/routes/followUps.js', import.meta.url), 'utf8');
  const notify = route.slice(
    route.indexOf("router.post('/:id/milestones/:kind/notify'"),
    route.indexOf("router.get('/:id/contracts'"),
  );
  assert.match(notify, /const due = milestoneStanding\(m\)/);
  assert.match(notify, /milestoneReminderMail\([\s\S]*due,/);
  assert.doesNotMatch(notify, /delta:\s*0/);
  assert.doesNotMatch(notify, /urgency:\s*'upcoming'/);

  const sweep = readFileSync(new URL('../src/services/followUps.js', import.meta.url), 'utf8');
  assert.match(sweep, /const due = reminderDue\(m, today\)/);
  assert.doesNotMatch(sweep, /delta:\s*0/);
  assert.doesNotMatch(sweep, /Stefan Elze/);
});

test('default reminder copy is the assignee plus Rongbin on bcc, and nobody on cc', async () => {
  assert.deepEqual(optionalCcSpec({}), { email: null, name: null });
  assert.deepEqual(
    optionalCcSpec({ FOLLOWUP_CC_EMAIL: '  ', FOLLOWUP_CC_NAME: '' }),
    { email: null, name: null },
  );
  assert.deepEqual(bccSpec({}), { email: null, name: 'Rongbin Chen' });

  const looked = [];
  const got = await resolveReminderRecipients('assignee@example.com', {}, async (name) => {
    looked.push(name);
    assert.equal(name, 'Rongbin Chen');
    return 'rongbin@example.com';
  });
  assert.deepEqual(looked, ['Rongbin Chen']);
  assert.deepEqual(got, { cc: null, bcc: 'rongbin@example.com' });
});

test('an optional CC is used only when configured, and anyone already on To is dropped', async () => {
  assert.deepEqual(
    optionalCcSpec({ FOLLOWUP_CC_EMAIL: 'desk@example.com', FOLLOWUP_CC_NAME: 'Someone' }),
    { email: 'desk@example.com', name: null },
  );
  assert.deepEqual(
    optionalCcSpec({ FOLLOWUP_CC_NAME: 'Finance Desk' }),
    { email: null, name: 'Finance Desk' },
  );

  const kept = await resolveReminderRecipients('assignee@example.com', {
    FOLLOWUP_CC_EMAIL: 'desk@example.com',
    FOLLOWUP_BCC_EMAIL: 'rongbin@example.com',
  }, async () => {
    throw new Error('an explicit address does not need a name lookup');
  });
  assert.deepEqual(kept, { cc: 'desk@example.com', bcc: 'rongbin@example.com' });

  const ccIsAssignee = await resolveReminderRecipients('Desk@example.com', {
    FOLLOWUP_CC_EMAIL: 'desk@example.com',
    FOLLOWUP_BCC_EMAIL: 'rongbin@example.com',
  }, async () => {
    throw new Error('an explicit address does not need a name lookup');
  });
  assert.deepEqual(ccIsAssignee, { cc: null, bcc: 'rongbin@example.com' });

  const bccIsAssignee = await resolveReminderRecipients('rongbin@example.com', {
    FOLLOWUP_BCC_EMAIL: 'Rongbin@example.com',
  }, async () => {
    throw new Error('an explicit address does not need a name lookup');
  });
  assert.deepEqual(bccIsAssignee, { cc: null, bcc: null });

  const looked = [];
  const named = await resolveReminderRecipients('assignee@example.com', {
    FOLLOWUP_CC_NAME: 'Finance Desk',
  }, async (name) => {
    looked.push(name);
    if (name === 'Finance Desk') return 'finance@example.com';
    if (name === 'Rongbin Chen') return 'rongbin@example.com';
    return null;
  });
  assert.deepEqual(looked, ['Finance Desk', 'Rongbin Chen']);
  assert.deepEqual(named, { cc: 'finance@example.com', bcc: 'rongbin@example.com' });
});

test('the follow-up UI no longer says reminders are copied to Stefan Elze', () => {
  const ui = readFileSync(new URL('../../frontend/src/components/ProjectFollowUps.jsx', import.meta.url), 'utf8');
  assert.match(ui, /to the owner\s+and blind copied to Rongbin Chen/);
  assert.doesNotMatch(ui, /Stefan Elze/);
  assert.doesNotMatch(ui, /copied to Stefan/);

  const reminder = readFileSync(new URL('../src/services/followUpReminder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(reminder, /Stefan/);
  assert.match(reminder, /Rongbin Chen/);
  const mail = readFileSync(new URL('../src/services/followUpMail.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mail, /Stefan/);

  const bidding = readFileSync(new URL('../src/services/chinabidding.js', import.meta.url), 'utf8');
  assert.match(bidding, /BID_AWARD_EMAIL_TO/);
});
