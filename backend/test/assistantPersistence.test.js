import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stepsForStore,
  sourcesForStore,
  sensitiveTeamFromSteps,
  redactMessage,
  threadTitleFrom,
  LOCKED_REPLY,
} from '../src/services/assistantPersistence.js';

const AMOUNT = 'EUR 12,000,000.00';

test('stored tool traces drop amounts, excerpts, and any token-like args', () => {
  const stored = stepsForStore([{
    tool: 'ask_contracts',
    count: undefined,
    args: { customerId: 12, question: 'What is the value?', token: 'secret-token', pin: '1234' },
    result: { answer: `The value is ${AMOUNT}`, snippet: 'secret page text', href: '/contracts?customerId=12' },
  }]);
  const dumped = JSON.stringify(stored);
  assert.equal(dumped.includes(AMOUNT), false);
  assert.equal(dumped.includes('secret-token'), false);
  assert.equal(dumped.includes('1234'), false);
  assert.equal(dumped.includes('secret page text'), false);
  assert.equal(stored[0].tool, 'ask_contracts');
  assert.equal(stored[0].args.customerId, 12);
});

test('source cards are stored without snippets or amounts', () => {
  const stored = sourcesForStore([{
    type: 'contracts', title: 'Contracts', href: '/contracts?customerId=12',
    snippet: AMOUNT, sensitive: true,
  }]);
  assert.deepEqual(stored, [{ type: 'contracts', title: 'Contracts', href: '/contracts?customerId=12', sensitive: true }]);
  assert.equal(JSON.stringify(stored).includes(AMOUNT), false);
});

test('sensitiveTeam is set only when an unlocked contract or follow-up value was returned', () => {
  assert.equal(sensitiveTeamFromSteps([{ tool: 'ask_contracts', result: { locked: true, href: '/contracts' } }], 'HRC'), null);
  assert.equal(sensitiveTeamFromSteps([{ tool: 'get_followup', result: { title: 'Order', contractValueLocked: true } }], 'HRC'), null);
  assert.equal(sensitiveTeamFromSteps([{ tool: 'get_followup', result: { title: 'Order', contractValue: AMOUNT, sensitive: true } }], 'HRC'), 'HRC');
  assert.equal(sensitiveTeamFromSteps([{ tool: 'ask_contracts', result: { answer: 'Warranty 12 months', sensitive: true } }], 'WRC'), 'WRC');
  assert.equal(sensitiveTeamFromSteps([{ tool: 'ask_contracts', result: { answer: 'x', sensitive: true } }], null), null);
});

test('a sensitive reply is redacted without the matching team unlock, and intact with it', () => {
  const message = {
    id: 7,
    role: 'assistant',
    content: `The contract value is ${AMOUNT}.`,
    steps: [{ tool: 'get_followup', count: 1 }],
    sources: [{ type: 'followup', title: 'Demo order', href: '/followups/8', sensitive: true }],
    suggestions: [],
    sensitiveTeam: 'HRC',
  };
  const locked = redactMessage(message, null, 'en');
  assert.equal(locked.redacted, true);
  assert.equal(locked.content, LOCKED_REPLY.en);
  assert.equal(JSON.stringify(locked).includes(AMOUNT), false);
  assert.equal(locked.sources[0].locked, true);

  const open = redactMessage(message, 'HRC', 'en');
  assert.equal(open.redacted, undefined);
  assert.equal(open.content.includes(AMOUNT), true);

  const wrong = redactMessage(message, 'WRC', 'zh');
  assert.equal(wrong.content, LOCKED_REPLY.zh);
});

test('thread titles are trimmed and never contain a raw leftover prompt dump', () => {
  assert.equal(threadTitleFrom('  What is next for COSCO?  '), 'What is next for COSCO?');
  assert.ok(threadTitleFrom('x'.repeat(200)).endsWith('…'));
  assert.equal(threadTitleFrom(''), 'New conversation');
});

test('visitDate, location and summary are kept on stored report source cards, not content or amounts', () => {
  const stored = sourcesForStore([{
    type: 'report',
    title: 'Plant visit',
    href: '/visit-reports/57',
    visitDate: '2026-10-28',
    location: 'Shanghai yard',
    summary: 'Discussed delivery time.',
    customer: 'COSCO',
    author: 'Anna',
    content: 'Do not persist the body',
    snippet: AMOUNT,
  }, {
    type: 'reminder',
    title: 'Keep contact (WRC)',
    href: '/visit-reports/57?remindDate=2026-11-30#remind-abc',
    start: '2026-11-30T01:00:00.000Z',
    visitReportId: 57,
    reportTitle: 'Plant visit',
  }]);
  assert.equal(stored[0].visitDate, '2026-10-28');
  assert.equal(stored[0].location, 'Shanghai yard');
  assert.equal(stored[0].summary, 'Discussed delivery time.');
  assert.equal(stored[0].customer, 'COSCO');
  assert.equal(stored[0].author, 'Anna');
  assert.equal(stored[0].content, undefined);
  assert.equal(stored[0].snippet, undefined);
  assert.equal(JSON.stringify(stored).includes(AMOUNT), false);
  assert.equal(JSON.stringify(stored).includes('Do not persist the body'), false);
  assert.equal(stored[1].visitReportId, 57);
  assert.equal(stored[1].reportTitle, 'Plant visit');
  assert.equal(stored[1].start, '2026-11-30T01:00:00.000Z');
});
