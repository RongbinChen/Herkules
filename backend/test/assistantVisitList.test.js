import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVisitDate,
  formatVisitReportList,
  ensureVisitReportList,
  reportsFromSources,
  isVisitReportTableHeader,
} from '../src/services/assistantVisitList.js';
import { sourcesFromSteps } from '../src/services/assistantSources.js';
import { ensureVisitReportList as ensureList } from '../src/services/assistantVisitList.js';

test('the visit-report list uses stored title, date, summary and href — and does not invent an overview', () => {
  const md = formatVisitReportList([
    {
      type: 'report',
      title: 'Reference visit at the boiler plant',
      href: '/visit-reports/58',
      visitDate: '2026-10-30T00:00:00.000Z',
      summary: 'Compared milling capacity ahead of the contract target.',
    },
    {
      type: 'report',
      title: 'Pre-tender meeting',
      href: '/visit-reports/43',
      visitDate: '2026-10-28',
    },
  ], 'en');
  assert.match(md, /\*\*Recent visits\*\* \(2\)/);
  assert.match(md, /1\. \*\*Reference visit at the boiler plant\*\*/);
  assert.match(md, /Date: October 30, 2026/);
  assert.match(md, /Overview: Compared milling capacity ahead of the contract target\./);
  assert.match(md, /Report link: \[View report\]\(\/visit-reports\/58\)/);
  assert.match(md, /2\. \*\*Pre-tender meeting\*\*/);
  // No summary → no invented overview line.
  const second = md.split(/\n\n/)[2];
  assert.doesNotMatch(second, /Overview:/);
  assert.equal(formatVisitDate('2026-11-12', 'zh'), '2026年11月12日');
});

test('Chinese list labels say 报告链接, never the typo 连接', () => {
  const md = formatVisitReportList([{
    type: 'report', title: '扬州技术交流', href: '/visit-reports/46', visitDate: '2026-10-28', summary: '讨论了规格更新。',
  }], 'zh');
  assert.match(md, /\*\*最近拜访\*\*（共 1 份报告）/);
  assert.match(md, /日期：2026年10月28日/);
  assert.match(md, /概述：讨论了规格更新。/);
  assert.match(md, /报告链接：\[点击查看\]\(\/visit-reports\/46\)/);
  assert.doesNotMatch(md, /报告连接/);
});

test('a markdown visit-report table in the model answer is replaced by the numbered list', () => {
  const sources = sourcesFromSteps([{
    tool: 'get_customer',
    result: {
      id: 12, name: 'Demo Shipbuilding Co.', href: '/customers/12',
      visitReports: [{
        id: 54, title: 'Reference visit', href: '/visit-reports/54',
        visitDate: '2026-11-12', summary: 'Reviewed milling machines on site.',
      }, {
        id: 43, title: 'Pre-tender meeting', href: '/visit-reports/43',
        visitDate: '2026-10-30', summary: 'Delivery time was the main concern.',
      }],
    },
  }]);
  const reply = [
    'Demo Shipbuilding Co. is an active lead.',
    '',
    '**最近拜访**（共 2 份报告）',
    '',
    '| 日期 | 报告 | 要点 |',
    '| --- | --- | --- |',
    '| 2026-11-12 | Reference visit (id 54) | Reviewed milling machines on site. |',
    '| 2026-10-30 | Pre-tender meeting (id 43) | Delivery time was the main concern. |',
    '',
    '下一步（来自报告 54）',
    '',
    '- 2026-11-30: Keep contact',
  ].join('\n');
  const out = ensureVisitReportList(reply, sources, 'en');
  assert.doesNotMatch(out, /\| 日期 \| 报告 \| 要点 \|/);
  assert.doesNotMatch(out, /\| ---/);
  assert.match(out, /Demo Shipbuilding Co\. is an active lead\./);
  assert.match(out, /\*\*Recent visits\*\*/);
  assert.match(out, /1\. \*\*Reference visit\*\*/);
  assert.match(out, /Report link: \[View report\]\(\/visit-reports\/54\)/);
  assert.match(out, /2\. \*\*Pre-tender meeting\*\*/);
  assert.match(out, /下一步（来自报告 54）/);
  assert.ok(out.indexOf('Recent visits') < out.indexOf('下一步'));
  assert.equal(isVisitReportTableHeader('| 日期 | 报告 | 要点 |'), true);
  assert.equal(isVisitReportTableHeader('| Name | Value |'), false);
  assert.deepEqual(reportsFromSources(sources).map((r) => r.href), ['/visit-reports/54', '/visit-reports/43']);
});

test('when the model writes prose without a table, the list is still inserted before next steps', () => {
  const sources = [
    { type: 'customer', title: 'Demo Co.', href: '/customers/12' },
    { type: 'report', title: 'Plant visit', href: '/visit-reports/10', visitDate: '2026-07-15', summary: 'Discussed the first phase.' },
  ];
  const out = ensureList('Here is a brief read-out.\n\nNext steps\n\n- Follow up next week.', sources, 'en');
  assert.match(out, /Here is a brief read-out\./);
  assert.match(out, /1\. \*\*Plant visit\*\*/);
  assert.match(out, /Overview: Discussed the first phase\./);
  assert.ok(out.indexOf('Plant visit') < out.indexOf('Next steps'));
});
