import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerHref,
  reportHref,
  projectTrackingHref,
  bidOpenHref,
  hotProjectHref,
  tripHref,
  followUpHref,
  calendarEventHref,
  contractsHref,
  reminderReportHref,
  eventHref,
  toAppPath,
  isTrustedAppPath,
  targetTitleFromReminder,
} from '../src/services/assistantLinks.js';

test('module hrefs point at real routes and encode query values', () => {
  assert.equal(customerHref(12), '/customers/12');
  assert.equal(reportHref(57), '/visit-reports/57');
  assert.equal(projectTrackingHref('0747-2640 SCC'), '/chinabidding/tracking?q=0747-2640%20SCC');
  assert.equal(bidOpenHref(9), '/chinabidding/bidopen?id=9');
  assert.equal(hotProjectHref(3), '/hotprojects?id=3');
  assert.equal(tripHref(4), '/trips/4');
  assert.equal(followUpHref(8), '/followups/8');
  assert.equal(calendarEventHref(504), '/calendar?event=504');
  assert.equal(contractsHref(12), '/contracts?customerId=12');
  assert.equal(contractsHref(null), '/contracts');
  assert.equal(customerHref('nope'), null);
});

test('a report reminder deep-links to the visit-report remind anchor', () => {
  const ev = {
    id: 504,
    title: '⏰ Keep contact',
    visitReportId: 57,
    start: '2026-11-30T01:00:00.000Z',
    category: 'REMINDER',
  };
  const href = reminderReportHref(ev);
  assert.match(href, /^\/visit-reports\/57\?remindDate=2026-11-30#remind-/);
  assert.equal(eventHref(ev), href);
  assert.equal(targetTitleFromReminder(ev.title), 'Keep contact');
  assert.equal(eventHref({ id: 88, category: 'MEETING' }), '/calendar?event=88');
});

test('only allowlisted in-app paths are trusted', () => {
  assert.equal(toAppPath('/chinabidding/tracking?q=ABC'), '/chinabidding/tracking?q=ABC');
  assert.equal(isTrustedAppPath('/customers/12'), true);
  assert.equal(isTrustedAppPath('/evil'), false);
  assert.equal(isTrustedAppPath('https://evil.example/customers/12'), false);
  assert.equal(
    toAppPath('https://www.herkulesgroup-china.com/trip/share/abcTOKEN'),
    '/trip/share/abcTOKEN',
  );
});
