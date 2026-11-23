import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcesFromSteps, suggestionsFromSteps, locationFromReportContent, inferSourceType } from '../src/services/assistantSources.js';

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

test('nested get_customer visit reports and reminders get the right type and overview fields', () => {
  const cards = sourcesFromSteps([{
    tool: 'get_customer',
    result: {
      id: 12, name: 'COSCO Shipping Heavy Industry (Shanghai)', title: 'COSCO Shipping Heavy Industry (Shanghai)', href: '/customers/12',
      visitReports: [{
        id: 57,
        title: 'Shanghai Hongguang Boiler Reference Visit for COSCO machining',
        href: '/visit-reports/57',
        visitDate: '2026-10-30T00:00:00.000Z',
        location: 'Shanghai Hongguang',
        summary: 'Reference visit to compare machining capacity.',
        customer: 'COSCO Shipping Heavy Industry (Shanghai)',
      }],
      recentEvents: [{
        id: 504,
        title: '⏰ Keep contact (WRC)',
        category: 'REMINDER',
        visitReportId: 57,
        reportTitle: 'Shanghai Hongguang Boiler Reference Visit for COSCO machining',
        start: '2026-11-30T01:00:00.000Z',
        href: '/visit-reports/57?remindDate=2026-11-30#remind-abc',
      }],
    },
  }]);
  assert.deepEqual(cards.map((c) => c.type), ['customer', 'report', 'reminder']);
  const report = cards[1];
  assert.equal(report.location, 'Shanghai Hongguang');
  assert.equal(report.summary, 'Reference visit to compare machining capacity.');
  assert.equal(report.visitDate, '2026-10-30T00:00:00.000Z');
  assert.equal(report.customer, 'COSCO Shipping Heavy Industry (Shanghai)');
  const reminder = cards[2];
  assert.equal(reminder.type, 'reminder');
  assert.equal(reminder.visitReportId, 57);
  assert.equal(reminder.reportTitle, 'Shanghai Hongguang Boiler Reference Visit for COSCO machining');
  assert.equal(reminder.href, '/visit-reports/57?remindDate=2026-11-30#remind-abc');
});

test('href inference relabels nested reports even when the tool type is customer', () => {
  const cards = sourcesFromSteps([{
    tool: 'get_customer',
    result: {
      id: 12, name: 'Demo Co', href: '/customers/12',
      visitReports: [{ id: 57, title: 'Plant visit', href: '/visit-reports/57', visitDate: '2026-10-28', summary: 'Talked about delivery.' }],
    },
  }]);
  assert.equal(cards[0].type, 'customer');
  assert.equal(cards[1].type, 'report');
  assert.equal(cards[1].summary, 'Talked about delivery.');
  assert.equal(inferSourceType({ href: '/visit-reports/57' }, 'customer'), 'report');
  assert.equal(inferSourceType({ href: '/visit-reports/57?remindDate=2026-11-30#remind-abc' }, 'customer'), 'reminder');
});

test('location is read from stored report content.meta and not invented', () => {
  assert.equal(locationFromReportContent({ meta: { location: 'Baoji' } }), 'Baoji');
  assert.equal(locationFromReportContent({ meta: { location: '  ' } }), null);
  assert.equal(locationFromReportContent({ originalBody: 'Location: somewhere' }), null);
  assert.equal(locationFromReportContent(null), null);
});
