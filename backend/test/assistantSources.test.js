import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcesFromSteps, suggestionsFromSteps } from '../src/services/assistantSources.js';

test('source cards are built from tool hrefs and ignore invented URLs', () => {
  const cards = sourcesFromSteps([
    {
      tool: 'search_customers',
      result: [
        { id: 12, name: 'COSCO Shipping', href: '/customers/12' },
        { id: 99, name: 'No link' },
      ],
    },
    {
      tool: 'search_projects',
      result: [{ projectName: 'Rotor tender', threadKey: 'TK-1', href: '/chinabidding/tracking?q=TK-1' }],
    },
    {
      tool: 'search_customers',
      result: [{ id: 12, name: 'COSCO Shipping', href: 'https://evil.example/phish' }],
    },
  ]);
  assert.deepEqual(cards.map((c) => c.href), ['/customers/12', '/chinabidding/tracking?q=TK-1']);
  assert.equal(cards[0].title, 'COSCO Shipping');
  assert.equal(cards[0].type, 'customer');
});

test('a locked contract tool result becomes a locked source card', () => {
  const cards = sourcesFromSteps([{
    tool: 'ask_contracts',
    result: { locked: true, href: '/contracts?customerId=12', title: 'Contracts', message: 'PIN required' },
  }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].locked, true);
  assert.equal(cards[0].href, '/contracts?customerId=12');
});

test('suggestion chips follow the tools that were used', () => {
  const zh = suggestionsFromSteps([{ tool: 'get_customer', result: { id: 1, href: '/customers/1', name: 'Demo Co' } }], 'zh', { unlocked: false });
  assert.ok(zh.some((s) => s.key === 'contractsLocked'));
  assert.ok(zh.some((s) => /拜访|跟进|现场/.test(s.prompt)));
  const en = suggestionsFromSteps([{ tool: 'list_due_reminders', result: [] }], 'en', { unlocked: true });
  assert.ok(en.some((s) => s.key === 'reminders'));
});

test('get_customer nested records with hrefs also become source cards', () => {
  const cards = sourcesFromSteps([{
    tool: 'get_customer',
    result: {
      id: 12, name: 'Demo Shipbuilding Co.', href: '/customers/12',
      visitReports: [{ id: 57, title: 'Plant visit', href: '/visit-reports/57' }],
      followUps: [{ id: 8, title: 'Demo order', href: '/followups/8' }],
    },
  }]);
  assert.deepEqual(cards.map((c) => c.href), ['/customers/12', '/visit-reports/57', '/followups/8']);
});
