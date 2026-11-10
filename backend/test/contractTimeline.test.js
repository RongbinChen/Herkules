import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIMELINE_KINDS, addDays, addMonths, assembleProposals, detectDeliveryStart,
  hasConcreteTiming, isIsoDate, lcClausesFromText, parseDate, parseTimelineAnswer,
  parseTiming, planAnchorShift, planMilestoneApply, projectTimeline, redactMoney,
  redactProposalNotes, resolveTimeline, timelineFromSummary, timelineKindsFor, timelinePrompt,
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

test('a matching FAC or a closed commercial is finished and stays off the list', () => {
  const summary = (obj) => ({ fields: fields(obj) });
  const row = (over) => ({
    filename: `f${over.id}.pdf`,
    note: null,
    ocrStatus: 'DONE',
    team: 'WRC',
    summary: null,
    linkedFollowUps: [],
    closedAt: null,
    ...over,
  });
  const files = [
    row({
      id: 1, docType: 'COMMERCIAL', customerId: 1, customerName: 'Anshan',
      summary: summary({ contractNo: 'GD-WS-01-2512', signedDate: '2024-06-01' }),
    }),
    row({
      id: 2, docType: 'FAC', customerId: 1, customerName: 'Anshan',
      summary: summary({ contractNo: 'GD-WS-01-2512' }),
    }),
    row({
      id: 3, docType: 'COMMERCIAL', customerId: 1, customerName: 'Anshan',
      note: 'Kom. No.: 30-4410',
      summary: summary({ contractNo: 'OPEN-4410', signedDate: '1 March 2026' }),
    }),
    row({
      id: 4, docType: 'TECHNICAL', customerId: 1, customerName: 'Anshan',
      summary: summary({ contractNo: 'OPEN-4410', machine: 'WS 450' }),
    }),
    row({
      id: 5, docType: 'FAC', customerId: 2, customerName: 'Other Mill',
      summary: summary({ contractNo: 'SOME-OTHER-ORDER' }),
    }),
    row({
      id: 6, docType: 'COMMERCIAL', customerId: 2, customerName: 'Other Mill',
      summary: summary({ contractNo: 'KEEP-ME', signedDate: '2025-01-15' }),
    }),
    row({
      id: 7, docType: 'COMMERCIAL', customerId: 3, customerName: 'Marked',
      summary: summary({ contractNo: 'DONE-1', signedDate: '2023-05-01' }),
      closedAt: '2026-10-01T00:00:00.000Z',
    }),
    row({
      id: 8, docType: 'TECHNICAL', customerId: 3, customerName: 'Marked',
      summary: summary({ contractNo: 'DONE-1', machine: 'ProfiGrind' }),
    }),
    row({
      id: 9, docType: 'COMMERCIAL', customerId: 4, customerName: 'Unread but open',
      ocrStatus: 'DONE', summary: null,
    }),
    row({
      id: 10, docType: 'COMMERCIAL', customerId: 5, customerName: 'Closed before summary',
      ocrStatus: 'DONE', summary: null, closedAt: new Date('2026-09-01'),
    }),
    row({
      id: 11, docType: 'COMMERCIAL', customerId: 6, customerName: 'Same number, other mill',
      summary: summary({ contractNo: 'GD-WS-01-2512', signedDate: '2022-02-02' }),
    }),
    row({
      id: 12, docType: 'COMMERCIAL', customerId: 1, customerName: 'Anshan',
      summary: summary({ contractNo: 'OPEN-4410' }),
    }),
    row({
      id: 13, docType: 'FAC', customerId: 1, customerName: 'Anshan', filename: 'fac-note.pdf',
      ocrStatus: 'PENDING', summary: null, note: 'Kom. No.: 30-8800',
    }),
    row({
      id: 14, docType: 'COMMERCIAL', customerId: 1, customerName: 'Anshan',
      summary: summary({ komNo: '30-8800', signedDate: '2021-01-01' }),
    }),
    row({
      id: 15, docType: 'COMMERCIAL', customerId: 7, customerName: 'Queued',
      ocrStatus: 'PENDING', summary: null, closedAt: '2026-08-01T00:00:00.000Z',
      note: 'Kom. No.: 30-1500',
    }),
    row({
      id: 16, docType: 'TECHNICAL', customerId: 7, customerName: 'Queued',
      summary: summary({ contractNo: '30-1500', machine: 'WS 180' }),
    }),
    row({
      id: 17, docType: 'COMMERCIAL', customerId: 3, customerName: 'Marked',
      summary: summary({ contractNo: 'DONE-1', signedDate: '2023-05-01' }),
    }),
  ];
  const orders = selectOpenOrders(files, []);
  const ids = orders.map((o) => o.fileIds.slice().sort((a, b) => a - b).join(','));
  assert.deepEqual(ids.sort(), ['11', '3,4,12', '6', '9']);
  assert.equal(orders.some((o) => o.fileIds.includes(1)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(7)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(8)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(10)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(14)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(16)), false);
  assert.equal(orders.some((o) => o.fileIds.includes(17)), false);
  const stillOpen = orders.find((o) => o.fileIds.includes(3));
  assert.equal(stillOpen.machineType, 'WS 450');
  assert.equal(stillOpen.files.some((f) => !f.summarised), false);
  const notSummarised = orders.find((o) => o.fileIds.includes(9));
  assert.equal(notSummarised.files[0].summarised, false);
});

test('open orders sort by signed date descending, undated last', () => {
  const summary = (obj) => ({ fields: fields(obj) });
  const row = (over) => ({
    filename: `f${over.id}.pdf`,
    docType: 'COMMERCIAL',
    note: null,
    ocrStatus: 'DONE',
    team: 'HRC',
    linkedFollowUps: [],
    closedAt: null,
    ...over,
  });
  const files = [
    row({
      id: 30, customerId: 1, customerName: 'Older',
      summary: summary({ contractNo: 'A', signedDate: '2020-01-01' }),
    }),
    row({
      id: 10, customerId: 2, customerName: 'Newer',
      summary: summary({ contractNo: 'B', signedDate: '15 March 2026' }),
    }),
    row({
      id: 40, customerId: 3, customerName: 'Mango',
      summary: summary({ contractNo: 'C', signedDate: 'March 2026' }),
    }),
    row({
      id: 21, customerId: 4, customerName: 'Apple',
      summary: summary({ contractNo: 'D' }),
    }),
    row({
      id: 20, customerId: 4, customerName: 'Apple',
      summary: summary({ contractNo: 'E' }),
    }),
    row({
      id: 50, customerId: 5, customerName: 'Newer',
      summary: summary({ contractNo: 'F', signedDate: '2026-03-15' }),
    }),
  ];
  const orders = selectOpenOrders(files, []);
  assert.deepEqual(orders.map((o) => o.fileIds[0]), [10, 50, 30, 20, 21, 40]);
  assert.deepEqual(orders.map((o) => o.signedDate), [
    '2026-03-15', '2026-03-15', '2020-01-01', null, null, null,
  ]);
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
  assert.match(src, /shiftFollowUpMilestones/);
  assert.match(src, /'COMMERCIAL', 'TECHNICAL', 'FAC'/);
  assert.match(src, /closedAt: true/);
  assert.match(src, /closedAt: f\.closedAt/);

  const contracts = readFileSync(new URL('../src/routes/contracts.js', import.meta.url), 'utf8');
  assert.match(contracts, /closed:\s*z\.boolean\(\)/);
  assert.match(contracts, /closedAt:\s*true/);
});

test('a past down-payment expectation is not marked received', () => {
  const proposals = resolveTimeline(timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'The Buyer shall pay the down payment within 10 days after the signature date.',
  })), { today: '2026-11-10' });
  const got = byKind(proposals);
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-10-26');
  assert.equal(got.PAYMENT_DOWN.done, false);
  assert.equal(got.PAYMENT_DOWN.confirmReceipt, true);
  const actions = planMilestoneApply([], [{
    kind: 'PAYMENT_DOWN', dueDate: '2026-10-26', notes: 'within 10 days', done: true,
  }]);
  assert.equal(actions[0].action, 'create');
  assert.equal(actions[0].data.done, undefined);
  assert.equal(actions[0].data.dueDate, '2026-10-26');
});

test('letter-of-credit receipt and latest shipment come only from a commercial file, and only with a real number', () => {
  const commercial = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'Down payment within 10 days after the signature date / Not later than 30 days after the signature date, the Buyer shall open an irrevocable letter of credit.',
    delivery: 'Delivery time of the first lot is 3 months FOB after receipt of the down payment. The letter of credit shall be received within 15 days of the opening deadline. The latest shipment date is 90 days after the letter of credit is received.',
  }));
  const technical = [
    { kind: 'LC_RECEIVED', notes: 'The letter of credit must be received within N days of the opening deadline.' },
    { kind: 'LC_LATEST_SHIPMENT', notes: 'The latest shipment date is N days after the letter of credit is received.' },
    { kind: 'INSTALLATION', offset: { n: 30, unit: 'days', dir: 'after', base: 'SHIPMENT' }, notes: 'Installation within 30 days of arrival' },
    { kind: 'SHIPMENT', absolute: '2027-06-01', notes: 'Technical protocol shipment 1 June 2027' },
  ];
  const { proposals, deliveryStart } = assembleProposals([
    { docType: 'COMMERCIAL', fileId: 1, clauses: commercial },
    { docType: 'TECHNICAL', fileId: 2, clauses: technical },
  ], { today: '2026-11-10' });
  const got = byKind(proposals);

  assert.equal(got.LC_OPEN_DEADLINE.docType, 'COMMERCIAL');
  assert.equal(got.LC_OPEN_DEADLINE.dueDate, '2026-11-15');
  assert.equal(got.LC_RECEIVED.docType, 'COMMERCIAL');
  assert.equal(got.LC_RECEIVED.dueDate, '2026-11-30');
  assert.equal(got.LC_LATEST_SHIPMENT.docType, 'COMMERCIAL');
  assert.equal(got.LC_LATEST_SHIPMENT.dueDate, '2027-02-28');
  assert.equal(got.INSTALLATION.docType, 'TECHNICAL');
  assert.equal(got.SHIPMENT.docType, 'COMMERCIAL');
  assert.equal(got.SHIPMENT.dueDate, '2027-01-26');
  assert.equal(deliveryStart.rule, 'PAYMENT_DOWN');
  assert.doesNotMatch(got.LC_RECEIVED.notes, /\bN days\b/);
  assert.doesNotMatch(got.LC_LATEST_SHIPMENT.notes, /\bN days\b/);

  const technicalOnly = assembleProposals([
    { docType: 'TECHNICAL', fileId: 2, clauses: technical },
  ], { today: '2026-11-10' });
  const tech = byKind(technicalOnly.proposals);
  assert.equal(tech.LC_RECEIVED, undefined);
  assert.equal(tech.LC_LATEST_SHIPMENT, undefined);
  assert.equal(tech.INSTALLATION.docType, 'TECHNICAL');
  assert.equal(tech.SHIPMENT.docType, 'TECHNICAL');
  assert.equal(tech.SHIPMENT.dueDate, '2027-06-01');

  const pages = lcClausesFromText([
    'The letter of credit must be received within N days of the opening deadline.',
    'The letter of credit shall be received within 15 days of the opening deadline.',
    '最晚装运期为收到信用证后90日。',
  ].join('\n'));
  assert.equal(pages.length, 2);
  assert.equal(pages.find((c) => c.kind === 'LC_RECEIVED').offset.n, 15);
  assert.equal(pages.find((c) => c.kind === 'LC_RECEIVED').offset.base, 'LC_OPEN');
  assert.equal(pages.find((c) => c.kind === 'LC_LATEST_SHIPMENT').offset.base, 'LC_RECEIVED');
  assert.equal(hasConcreteTiming(pages[0]), true);
});

test('a technical prompt does not ask for letter-of-credit milestones', () => {
  const technical = timelinePrompt('TECHNICAL');
  const commercial = timelinePrompt('COMMERCIAL');
  assert.deepEqual(timelineKindsFor('TECHNICAL').includes('LC_RECEIVED'), false);
  assert.deepEqual(timelineKindsFor('TECHNICAL').includes('LC_LATEST_SHIPMENT'), false);
  assert.equal(timelineKindsFor('TECHNICAL').includes('INSTALLATION'), true);
  assert.match(technical, /Do not extract letter-of-credit/);
  assert.doesNotMatch(technical, /LC_RECEIVED/);
  assert.match(commercial, /LC_RECEIVED/);
  assert.match(commercial, /LC_LATEST_SHIPMENT/);
  assert.match(commercial, /Never write the letter N/);
});

test('delivery counted from the down payment follows that receipt, not the signature', () => {
  const clauses = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'Down payment within 10 days after the signature date / 70% against shipping documents / The Buyer shall open the L/C within 30 days of signing. The contract becomes effective when the down payment arrives.',
    delivery: 'Delivery time of the first lot is 3 months FOB after receipt of the down payment.',
  }));
  const detected = detectDeliveryStart(clauses);
  assert.equal(detected.rule, 'PAYMENT_DOWN');
  assert.equal(detected.ambiguous, false);
  assert.match(detected.evidence, /down payment/i);

  const { proposals, deliveryStart } = assembleProposals([
    { docType: 'COMMERCIAL', clauses },
  ], { today: '2026-10-01' });
  const got = byKind(proposals);
  assert.equal(deliveryStart.rule, 'PAYMENT_DOWN');
  assert.equal(deliveryStart.source, 'contract');
  assert.equal(got.PAYMENT_DOWN.dueDate, '2026-10-26');
  assert.equal(got.PAYMENT_DOWN.done, false);
  assert.equal(got.CONTRACT_EFFECTIVE.dueDate, '2026-10-26');
  assert.equal(got.SHIPMENT.dueDate, '2027-01-26');
  assert.equal(got.PAYMENT_SHIPMENT.dueDate, '2027-01-26');
  assert.equal(got.LC_OPEN_DEADLINE.dueDate, '2026-11-15');
  assert.equal(got.LC_OPEN_DEADLINE.docType, 'COMMERCIAL');

  const shifted = planAnchorShift({
    clauses,
    existing: [
      { id: 1, kind: 'PAYMENT_DOWN', dueDate: '2026-10-26', doneAt: null },
      { id: 2, kind: 'SHIPMENT', dueDate: '2027-01-26', doneAt: null },
      { id: 3, kind: 'PAYMENT_SHIPMENT', dueDate: '2027-01-26', doneAt: null },
      { id: 4, kind: 'LC_OPEN_DEADLINE', dueDate: '2026-11-15', doneAt: null },
    ],
    movedKind: 'PAYMENT_DOWN',
    before: { paymentDate: '2026-10-26' },
    after: { paymentDate: '2026-11-05' },
  });
  const by = Object.fromEntries(shifted.map((s) => [s.kind, s]));
  assert.equal(by.PAYMENT_DOWN, undefined);
  assert.equal(by.SHIPMENT.dueDate, '2027-02-05');
  assert.equal(by.PAYMENT_SHIPMENT.dueDate, '2027-02-05');
  assert.equal(by.LC_OPEN_DEADLINE, undefined);
});

test('delivery counted from signing does not move when the down payment date moves', () => {
  const clauses = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: '20% advance within 10 days of signing / 70% on shipment. The Buyer shall open the L/C within 30 days of signing.',
    delivery: '12 months after signing',
  }));
  const detected = detectDeliveryStart(clauses);
  assert.equal(detected.rule, 'SIGNED');
  assert.equal(detected.ambiguous, false);
  const dated = byKind(projectTimeline(clauses, { today: '2026-10-01' }));
  assert.equal(dated.SHIPMENT.dueDate, '2027-10-16');
  assert.equal(dated.LC_OPEN_DEADLINE.dueDate, '2026-11-15');

  const shifted = planAnchorShift({
    clauses,
    existing: [
      { id: 2, kind: 'SHIPMENT', dueDate: '2027-10-16', doneAt: null },
      { id: 3, kind: 'PAYMENT_SHIPMENT', dueDate: '2027-10-16', doneAt: null },
      { id: 4, kind: 'LC_OPEN_DEADLINE', dueDate: '2026-11-15', doneAt: null },
      { id: 5, kind: 'SHIPMENT_HAND', dueDate: '2027-01-01', doneAt: null },
    ],
    movedKind: 'PAYMENT_DOWN',
    before: { signedDate: '2026-10-16', paymentDate: '2026-10-26' },
    after: { signedDate: '2026-10-16', paymentDate: '2026-12-01' },
  });
  assert.equal(shifted.find((s) => s.kind === 'SHIPMENT'), undefined);
  assert.equal(shifted.find((s) => s.kind === 'LC_OPEN_DEADLINE'), undefined);
});

test('an unclear delivery start is not invented, and a chosen basis then dates it', () => {
  const clauses = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'Down payment within 10 days of signing.',
    delivery: 'Delivery within 12 months.',
  }));
  const detected = detectDeliveryStart(clauses);
  assert.equal(detected.rule, null);
  assert.equal(detected.ambiguous, true);

  const open = assembleProposals([{ docType: 'COMMERCIAL', clauses }], { today: '2026-10-01' });
  assert.equal(open.deliveryStart.ambiguous, true);
  assert.equal(open.deliveryStart.rule, null);
  assert.equal(byKind(open.proposals).SHIPMENT.dueDate, null);
  assert.equal(byKind(open.proposals).SHIPMENT.needsStart, true);
  assert.equal(byKind(open.proposals).PAYMENT_DOWN.dueDate, '2026-10-26');

  const fromSigning = assembleProposals(
    [{ docType: 'COMMERCIAL', clauses }],
    { today: '2026-10-01', deliveryStart: 'SIGNED' },
  );
  assert.equal(fromSigning.deliveryStart.rule, 'SIGNED');
  assert.equal(fromSigning.deliveryStart.source, 'manual');
  assert.equal(fromSigning.deliveryStart.ambiguous, false);
  assert.equal(byKind(fromSigning.proposals).SHIPMENT.dueDate, '2027-10-16');

  const fromPayment = assembleProposals(
    [{ docType: 'COMMERCIAL', clauses }],
    { today: '2026-10-01', deliveryStart: 'PAYMENT_DOWN' },
  );
  assert.equal(byKind(fromPayment.proposals).SHIPMENT.dueDate, '2027-10-26');

  const shifted = planAnchorShift({
    clauses,
    existing: [
      { id: 2, kind: 'SHIPMENT', dueDate: null, doneAt: null },
    ],
    movedKind: 'DELIVERY_START',
    before: {},
    after: { deliveryStart: 'PAYMENT_DOWN', deliveryStartSource: 'manual', paymentDate: '2026-10-26' },
  });
  assert.equal(shifted.find((s) => s.kind === 'SHIPMENT').dueDate, '2027-10-26');
  assert.equal(shifted.find((s) => s.kind === 'SHIPMENT').action, 'update');
});

test('effectiveness names the delivery start when the delivery clause says "after effective"', () => {
  const onPayment = timelineFromSummary(fields({
    signedDate: '1 March 2026',
    payment: '预付款于合同签订后15日内支付。Effective upon receipt of the down payment.',
    delivery: '12 months after effective',
  }));
  assert.equal(detectDeliveryStart(onPayment).rule, 'PAYMENT_DOWN');
  assert.equal(byKind(resolveTimeline(onPayment)).SHIPMENT.dueDate, '2027-03-16');

  const onSigning = timelineFromSummary(fields({
    signedDate: '1 March 2026',
    payment: 'The contract is effective on signing.',
    delivery: '6 months after effective',
  }));
  assert.equal(detectDeliveryStart(onSigning).rule, 'SIGNED');
  assert.equal(byKind(resolveTimeline(onSigning)).SHIPMENT.dueDate, '2026-09-01');

  const unnamed = timelineFromSummary(fields({
    signedDate: '1 March 2026',
    delivery: '6 months after the contract becomes effective',
  }));
  assert.equal(detectDeliveryStart(unnamed).rule, null);
  assert.equal(detectDeliveryStart(unnamed).ambiguous, true);
  assert.equal(byKind(resolveTimeline(unnamed)).SHIPMENT.dueDate, null);
});

test('a hand-edited or finished date is not moved when the down payment confirmation moves', () => {
  const clauses = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'Down payment within 10 days of signing. 70% on shipment.',
    delivery: '3 months after receipt of the down payment.',
  }));
  const shifted = planAnchorShift({
    clauses,
    existing: [
      { id: 2, kind: 'SHIPMENT', dueDate: '2028-01-01', doneAt: null },
      { id: 3, kind: 'PAYMENT_SHIPMENT', dueDate: '2027-01-26', doneAt: new Date('2027-01-20') },
    ],
    movedKind: 'PAYMENT_DOWN',
    before: { paymentDate: '2026-10-26' },
    after: { paymentDate: '2026-11-20' },
  });
  assert.equal(shifted.length, 0);
});

test('correcting the signed date moves a down payment that is still the contractual formula', () => {
  const clauses = timelineFromSummary(fields({
    signedDate: '16 October 2026',
    payment: 'Down payment within 10 days of signing.',
    delivery: '12 months after signing',
  }));
  const shifted = planAnchorShift({
    clauses,
    existing: [
      { id: 1, kind: 'PAYMENT_DOWN', dueDate: '2026-10-26', doneAt: null },
      { id: 2, kind: 'SHIPMENT', dueDate: '2027-10-16', doneAt: null },
    ],
    movedKind: 'CONTRACT_SIGNED',
    before: { signedDate: '2026-10-16' },
    after: { signedDate: '2026-10-20' },
  });
  const by = Object.fromEntries(shifted.map((s) => [s.kind, s]));
  assert.equal(by.PAYMENT_DOWN.dueDate, '2026-10-30');
  assert.equal(by.SHIPMENT.dueDate, '2027-10-20');
});

