import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIMELINE_KINDS, addDays, addMonths, isIsoDate, parseDate, parseTimelineAnswer,
  parseTiming, planMilestoneApply, redactMoney,   redactProposalNotes, resolveTimeline, timelineFromSummary,
} from '../src/services/contractTimelineFormat.js';
import { orderIdsMatch, selectOpenOrders } from '../src/services/openOrders.js';

const fields = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));

function byKind(proposals) {
  return Object.fromEntries(proposals.map((p) => [p.kind, p]));
}

test('calendar arithmetic clamps month ends and steps across years', () => {
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
  assert.equal(addDays('2026-01-15', 10), '2026-01-25');
  assert.equal(addDays('2026-01-15', 30), '2026-02-14');
  assert.equal(addDays('2027-01-25', 60), '2027-03-26');
});

test('dates are read in the forms a contract summary actually uses', () => {
  assert.equal(parseDate('2026-03-15').date, '2026-03-15');
  assert.equal(parseDate('15 March 2026').date, '2026-03-15');
  assert.equal(parseDate('15th of March 2026').date, '2026-03-15');
  assert.equal(parseDate('March 15, 2026').date, '2026-03-15');
  assert.equal(parseDate('2026年3月15日').date, '2026-03-15');
  assert.equal(parseDate('15.03.2026').date, '2026-03-15');
  assert.equal(parseDate('03/15/2026').date, '2026-03-15');
  assert.equal(parseDate('March 2027').date, '2027-03-31');
  assert.equal(parseDate('March 2027').monthOnly, true);
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(isIsoDate('2026-03-15'), true);
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.equal(isIsoDate('15 March 2026'), false);
});

test('summary prose becomes a dated timeline counted from the signature', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '15 March 2026',
    payment: '20% advance within 15 days of signing / 70% by L/C to be opened within 30 days of signing, payable against shipping documents / 10% within 30 days of FAC',
    delivery: '12 months after signing',
    warranty: '12 months from the date of signing the acceptance certificate',
  })), { today: '2026-11-06' });
  const got = byKind(proposals);

  assert.equal(got.CONTRACT_SIGNED.dueDate, '2026-03-15');
  assert.equal(got.CONTRACT_SIGNED.done, true);
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-03-30');
  assert.equal(got.LC_OPEN_DEADLINE.dueDate, '2026-04-14');
  assert.equal(got.PAYMENT_SHIPMENT.dueDate, '2027-03-15');
  assert.equal(got.SHIPMENT.dueDate, '2027-03-15');
  assert.equal(got.PAYMENT_FINAL.dueDate, null);
  assert.match(got.PAYMENT_FINAL.notes, /FAC|acceptance/i);
  assert.equal(got.WARRANTY_EXPIRY.dueDate, null);
  assert.match(got.WARRANTY_EXPIRY.notes, /12 months/i);
  assert.equal(got.PAYMENT_DOWN.notes.includes('EUR'), false);
});

test('Chinese payment, delivery and a chain through effectiveness', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '2026-03-01',
    payment: '预付款于合同签订后15日内支付；信用证于签订后30日内开立。Effective upon receipt of the down payment.',
    delivery: '12 months after effective',
    warranty: '质保期自终验收之日起12个月',
  })), { today: '2026-03-01' });
  const got = byKind(proposals);

  assert.equal(got.CONTRACT_SIGNED.dueDate, '2026-03-01');
  assert.equal(got.CONTRACT_SIGNED.done, false);
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-03-16');
  assert.equal(got.LC_OPEN_DEADLINE.dueDate, '2026-03-31');
  assert.equal(got.CONTRACT_EFFECTIVE.dueDate, '2026-03-16');
  assert.equal(got.SHIPMENT.dueDate, '2027-03-16');
  assert.equal(got.WARRANTY_EXPIRY.dueDate, null);
});

test('the one-line payment shape the summariser is asked to write', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '2026-04-01',
    payment: '20% advance / 70% on shipment / 10% on acceptance',
    delivery: '10 months after signing',
    warranty: '12 months from the date of signing the acceptance certificate',
  })), { today: '2026-11-06' });
  const got = byKind(proposals);
  // "20% advance" names the milestone and no clock, so the date stays blank
  // rather than being invented as the signing day.
  assert.equal(got.PAYMENT_DOWN.dueDate, null);
  assert.match(got.PAYMENT_DOWN.notes, /advance/i);
  assert.equal(got.SHIPMENT.dueDate, '2027-02-01');
  assert.equal(got.PAYMENT_SHIPMENT.dueDate, '2027-02-01');
  assert.equal(got.PAYMENT_FINAL.dueDate, null);
  assert.match(got.PAYMENT_FINAL.notes, /acceptance/i);
  assert.equal(got.WARRANTY_EXPIRY.dueDate, null);
});

test('a month name and an absolute deadline are dates, not offsets', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '2026-01-10',
    delivery: 'March 2027',
    payment: '10% advance by 30 June 2026',
  })), { today: '2026-11-06' });
  const got = byKind(proposals);
  assert.equal(got.SHIPMENT.dueDate, '2027-03-31');
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-06-30');
});

test('FAT before shipment and warranty after a known FAC', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '2026-01-15',
    delivery: '12 months after signing. FAT 14 days before shipment.',
    warranty: '18 months after shipment',
  })), { today: '2026-02-01' });
  const got = byKind(proposals);
  assert.equal(got.SHIPMENT.dueDate, '2027-01-15');
  assert.equal(got.FAT.dueDate, '2027-01-01');
  assert.equal(got.WARRANTY_EXPIRY.dueDate, '2028-07-15');
});

test('the DGX line format resolves the same way, and unknown lines are dropped', () => {
  const clauses = parseTimelineAnswer(`
CONTRACT_SIGNED | 2026-01-15 | signed in Shanghai
PAYMENT_DOWN | 10 days after SIGNED | 20% advance within 10 days of signing
CONTRACT_EFFECTIVE | on PAYMENT_DOWN | effective when the advance arrives
SHIPMENT | 12 months after EFFECTIVE | delivery twelve months after effectiveness
PAYMENT_SHIPMENT | on SHIPMENT | 70% against shipping documents
FAC | 60 days after SHIPMENT | final acceptance within 60 days of arrival
WARRANTY_EXPIRY | 12 months after FAC | 12 months from acceptance
NOT_A_KIND | 2026-01-01 | ignore me
LC_OPEN_DEADLINE | — | L/C mentioned without a date
`);
  const got = byKind(resolveTimeline(clauses, { today: '2026-11-06' }));
  assert.equal(got.NOT_A_KIND, undefined);
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-01-25');
  assert.equal(got.CONTRACT_EFFECTIVE.dueDate, '2026-01-25');
  assert.equal(got.SHIPMENT.dueDate, '2027-01-25');
  assert.equal(got.PAYMENT_SHIPMENT.dueDate, '2027-01-25');
  assert.equal(got.FAC.dueDate, '2027-03-26');
  assert.equal(got.WARRANTY_EXPIRY.dueDate, '2028-03-26');
  assert.equal(got.LC_OPEN_DEADLINE.dueDate, null);
  assert.match(got.LC_OPEN_DEADLINE.notes, /L\/C/);
});

test('relative timing prefers the base next to the number', () => {
  const t = parseTiming('预付款于合同签订后15日内支付');
  assert.equal(t.offset.base, 'SIGNED');
  assert.equal(t.offset.n, 15);
  assert.equal(t.offset.dir, 'after');
  const before = parseTiming('FAT 14 days before shipment');
  assert.equal(before.offset.base, 'SHIPMENT');
  assert.equal(before.offset.dir, 'before');
  const acceptance = parseTiming('12 months from the date of signing the acceptance certificate');
  assert.equal(acceptance.offset.base, 'FAC');
  assert.equal(acceptance.offset.unit, 'months');
});

test('currency amounts leave the note, percentages stay', () => {
  assert.equal(redactMoney('20% advance of EUR 1,180,000 within 15 days'), '20% advance of [value] within 15 days');
  assert.equal(redactMoney('€5.900.000 on shipment'), '[value] on shipment');
  assert.equal(redactMoney('欧元5,900,000'), '[value]');
  const proposals = redactProposalNotes(resolveTimeline(timelineFromSummary(fields({
    signedDate: '2026-03-15',
    payment: '20% advance of EUR 1,180,000 within 15 days of signing',
  })), { today: '2026-11-06' }));
  assert.match(byKind(proposals).PAYMENT_DOWN.notes, /20%/);
  assert.equal(byKind(proposals).PAYMENT_DOWN.dueDate, '2026-03-30');
  assert.doesNotMatch(byKind(proposals).PAYMENT_DOWN.notes, /1,180,000|EUR/);
});

test('apply writes empty milestones and skips ones that already have a date', () => {
  const proposals = [
    { kind: 'PAYMENT_DOWN', dueDate: '2026-04-01', notes: '20% within 15 days' },
    { kind: 'SHIPMENT', dueDate: '2027-03-15', notes: '12 months' },
    { kind: 'LC_OPEN_DEADLINE', dueDate: '2026-04-14', notes: 'open the L/C' },
    { kind: 'CONTRACT_SIGNED', dueDate: '2026-03-15', notes: 'signed', done: true },
  ];
  const existing = [
    { kind: 'PAYMENT_DOWN', dueDate: new Date('2026-05-01'), doneAt: null, notes: 'typed' },
    { kind: 'SHIPMENT', dueDate: null, doneAt: null, notes: 'keep this' },
    { kind: 'LC_OPEN_DEADLINE', dueDate: null, doneAt: new Date('2026-04-01'), notes: null },
  ];
  const actions = planMilestoneApply(existing, proposals, { replace: false });
  const by = Object.fromEntries(actions.map((a) => [a.kind, a]));
  assert.equal(by.PAYMENT_DOWN.action, 'skip');
  assert.equal(by.PAYMENT_DOWN.reason, 'filled');
  assert.equal(by.LC_OPEN_DEADLINE.action, 'skip');
  assert.equal(by.SHIPMENT.action, 'update');
  assert.equal(by.SHIPMENT.data.dueDate, '2027-03-15');
  assert.equal(by.SHIPMENT.data.notes, undefined);
  assert.equal(by.CONTRACT_SIGNED.action, 'create');
  assert.equal(by.CONTRACT_SIGNED.data.done, true);

  const replaced = planMilestoneApply(existing, proposals, { replace: true });
  const down = replaced.find((a) => a.kind === 'PAYMENT_DOWN');
  assert.equal(down.action, 'update');
  assert.equal(down.data.dueDate, '2026-04-01');
  assert.equal(down.data.done, undefined);
});

test('order numbers match across punctuation and do not match short fragments', () => {
  assert.equal(orderIdsMatch('HT-2026-001', 'ht2026001'), true);
  assert.equal(orderIdsMatch('30-0004', '30-0004'), true);
  assert.equal(orderIdsMatch('12', '12345'), false);
  assert.equal(orderIdsMatch('', '12345'), false);
});

test('open orders are readable commercial contracts with no live or completed follow-up', () => {
  const summary = (obj) => ({ fields: fields(obj) });
  const files = [
    {
      id: 1, filename: 'a-commercial.pdf', docType: 'COMMERCIAL', note: 'Kom. No.: 30-0004',
      customerId: 9, customerName: 'Qingdao Haixi', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ contractNo: 'HT-2026-001', signedDate: '15 March 2026', amount: 'EUR 9,000,000' }),
      linkedFollowUps: [],
    },
    {
      id: 2, filename: 'a-technical.pdf', docType: 'TECHNICAL', note: null,
      customerId: 9, customerName: 'Qingdao Haixi', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ contractNo: 'HT-2026-001', machine: 'ProfiGrind 400' }),
      linkedFollowUps: [],
    },
    {
      id: 3, filename: 'already.pdf', docType: 'COMMERCIAL', note: null,
      customerId: 9, customerName: 'Qingdao Haixi', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ contractNo: 'HT-2020-9' }),
      linkedFollowUps: [{ status: 'ACTIVE' }],
    },
    {
      id: 4, filename: 'same-kom.pdf', docType: 'COMMERCIAL', note: null,
      customerId: 4, customerName: 'Other Mill', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ komNo: '30-0004' }),
      linkedFollowUps: [],
    },
    {
      id: 5, filename: 'unread.pdf', docType: 'COMMERCIAL', note: null,
      customerId: 4, customerName: 'Other Mill', ocrStatus: 'PENDING', team: 'HRC',
      summary: null, linkedFollowUps: [],
    },
    {
      id: 6, filename: 'tech-only.pdf', docType: 'TECHNICAL', note: null,
      customerId: 7, customerName: 'Bare Tech', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ machine: 'WS 450' }),
      linkedFollowUps: [],
    },
    {
      id: 7, filename: 'cancelled-link.pdf', docType: 'COMMERCIAL', note: null,
      customerId: 8, customerName: 'Restart', ocrStatus: 'DONE', team: 'HRC',
      summary: summary({ contractNo: 'HT-9' }),
      linkedFollowUps: [{ status: 'CANCELLED' }],
    },
  ];
  const followUps = [
    { id: 50, customerId: 9, status: 'ACTIVE', orderNo: 'OTHER-1', title: 'Older order' },
    { id: 51, customerId: 4, status: 'COMPLETED', orderNo: '30-0004', title: 'Done kom' },
  ];
  const orders = selectOpenOrders(files, followUps);
  const ids = orders.map((o) => o.fileIds.slice().sort((a, b) => a - b).join(','));
  assert.deepEqual(ids.sort(), ['1,2', '6', '7']);
  const haixi = orders.find((o) => o.customerId === 9);
  assert.equal(haixi.orderNo, 'HT-2026-001');
  assert.equal(haixi.machineType, 'ProfiGrind 400');
  assert.equal(haixi.signedDate, '2026-03-15');
  assert.equal(haixi.title.includes('Qingdao Haixi'), true);
  assert.equal(JSON.stringify(haixi).includes('9,000,000'), false);
  assert.equal(haixi.alsoOpen.length, 1);
  assert.equal(haixi.alsoOpen[0].id, 50);
  assert.equal(orders.some((o) => o.fileIds.includes(4)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(5)), false);
});

test('timeline kinds stay aligned with the catalogue and the schema', () => {
  const follow = readFileSync(new URL('../src/services/followUps.js', import.meta.url), 'utf8');
  const catalogue = [...follow.matchAll(/kind:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(TIMELINE_KINDS, catalogue);

  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const block = schema.split('enum MilestoneKind')[1].split('}')[0];
  const enumKinds = [...block.matchAll(/^\s*([A-Z_]+)\b/gm)].map((m) => m[1]);
  assert.deepEqual(TIMELINE_KINDS, enumKinds);
});

test('open-orders is registered before the :id route', () => {
  const src = readFileSync(new URL('../src/routes/followUps.js', import.meta.url), 'utf8');
  const openAt = src.indexOf("router.get('/open-orders'");
  const idAt = src.indexOf("router.get('/:id'");
  assert.ok(openAt !== -1 && openAt < idAt);
  assert.match(src, /suggestTimelineForFiles/);
  assert.match(src, /planMilestoneApply/);
});
