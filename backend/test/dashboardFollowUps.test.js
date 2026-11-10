import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_WINDOW_DAYS,
  DASHBOARD_FOLLOWUP_LIMIT,
  SIGNED_WINDOW_MONTHS,
  addMonths,
  daysBetween,
  isoDay,
  selectDashboardFollowUps,
} from '../src/services/dashboardFollowUps.js';

const TODAY = '2026-11-10';

function row(partial) {
  return {
    id: partial.id,
    title: partial.title || `Order ${partial.id}`,
    orderNo: partial.orderNo ?? `NO-${partial.id}`,
    status: partial.status || 'ACTIVE',
    createdAt: partial.createdAt || '2026-01-01T00:00:00.000Z',
    customer: partial.customer === undefined ? { name: `Customer ${partial.id}` } : partial.customer,
    owner: partial.owner === undefined ? { id: 1, name: 'Ada' } : partial.owner,
    contractValue: partial.contractValue ?? 'EUR 1,250,000',
    notes: partial.notes ?? 'issuing bank account 123 and a long internal note',
    milestones: partial.milestones || [],
  };
}

function signed(date, extra = {}) {
  return {
    id: extra.id || 1,
    kind: 'CONTRACT_SIGNED',
    label: null,
    dueDate: date,
    doneAt: extra.doneAt === undefined ? `${date}T02:00:00.000Z` : extra.doneAt,
    en: 'Contract signed',
    zh: '合同签署',
    owner: null,
  };
}

function milestone(partial) {
  return {
    id: partial.id,
    kind: partial.kind,
    label: partial.label || null,
    dueDate: partial.dueDate,
    doneAt: partial.doneAt || null,
    en: partial.en || partial.kind,
    zh: partial.zh || null,
    owner: partial.owner || null,
    notes: partial.notes || 'chase the buyer, call the bank, send the discrepancy list again',
  };
}

test('calendar helpers use China days and month-end clamping', () => {
  assert.equal(isoDay('2026-11-10'), '2026-11-10');
  // Midnight in Beijing is the previous UTC evening. The day is still the 1st.
  assert.equal(isoDay('2026-10-31T16:00:00.000Z'), '2026-11-01');
  assert.equal(addMonths('2026-11-10', -SIGNED_WINDOW_MONTHS), '2025-05-10');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(daysBetween('2026-11-10', '2026-11-01'), -9);
  assert.equal(daysBetween('2026-11-10', '2026-11-10'), 0);
});

test('dashboard keeps live recent work and drops finished or stale orders', () => {
  const rows = [
    row({
      id: 4,
      status: 'COMPLETED',
      title: 'Finished press',
      milestones: [signed('2026-11-01'), milestone({ id: 41, kind: 'PAYMENT_FINAL', dueDate: '2026-11-01', en: 'Final payment received' })],
    }),
    row({
      id: 5,
      status: 'CANCELLED',
      milestones: [signed('2026-11-01'), milestone({ id: 51, kind: 'PAYMENT_DOWN', dueDate: '2026-10-01', en: 'Down payment received' })],
    }),
    row({
      id: 6,
      title: 'Old quiet order',
      milestones: [signed('2020-01-15'), milestone({ id: 61, kind: 'WARRANTY_EXPIRY', dueDate: '2027-08-01', en: 'Warranty expires' })],
    }),
    row({
      id: 11,
      title: 'Just outside the window',
      milestones: [signed('2025-05-09'), milestone({ id: 111, kind: 'WARRANTY_EXPIRY', dueDate: '2027-06-01', en: 'Warranty expires' })],
    }),
    row({
      id: 10,
      title: 'Signed on the window edge',
      milestones: [signed('2025-05-10'), milestone({ id: 101, kind: 'WARRANTY_EXPIRY', dueDate: '2027-01-01', en: 'Warranty expires', zh: '质保到期' })],
    }),
  ];

  const { items, total } = selectDashboardFollowUps(rows, { today: TODAY });
  assert.equal(total, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 10);
  assert.equal(items[0].signedOn, '2025-05-10');
  assert.equal(ACTION_WINDOW_DAYS, 60);
});

test('sorts overdue first, then soonest due, then most recently signed', () => {
  const rows = [
    row({
      id: 1,
      customer: { name: 'COSCO' },
      orderNo: 'WRC-14',
      milestones: [
        signed('2026-10-01'),
        milestone({ id: 11, kind: 'PAYMENT_DOWN', dueDate: '2026-11-20', en: 'Down payment received', zh: '预付款到账' }),
      ],
    }),
    row({
      id: 13,
      milestones: [
        signed('2026-11-01'),
        milestone({ id: 131, kind: 'DRAWING_APPROVAL', dueDate: '2026-11-20', en: 'Drawings / spec approved' }),
      ],
    }),
    row({
      id: 2,
      title: 'LC chase',
      customer: { name: 'Baowu' },
      orderNo: 'HRC-9',
      owner: { id: 1, name: 'Ada' },
      milestones: [
        signed('2026-09-01'),
        milestone({
          id: 21,
          kind: 'LC_OPEN_DEADLINE',
          dueDate: '2026-11-01',
          en: 'L/C to be opened by',
          zh: '信用证开证截止',
          owner: { id: 8, name: 'Bo' },
        }),
        milestone({ id: 22, kind: 'PAYMENT_DOWN', dueDate: '2026-11-18', en: 'Down payment received' }),
      ],
    }),
    row({
      id: 7,
      title: 'Old but overdue',
      milestones: [
        signed('2020-01-01'),
        milestone({ id: 71, kind: 'PAYMENT_FINAL', dueDate: '2026-11-05', en: 'Final payment received' }),
      ],
    }),
    row({
      id: 9,
      title: 'Opened this week',
      createdAt: '2026-11-02T01:00:00.000Z',
      milestones: [
        milestone({ id: 91, kind: 'SHIPMENT', dueDate: '2026-11-10', en: 'Shipment / customs' }),
      ],
    }),
    row({
      id: 8,
      status: 'ON_HOLD',
      milestones: [
        signed('2026-08-01'),
        milestone({ id: 81, kind: 'DRAWING_APPROVAL', dueDate: '2026-12-01', en: 'Drawings / spec approved' }),
      ],
    }),
    row({
      id: 3,
      title: 'Dates not in yet',
      customer: null,
      milestones: [signed('2026-11-09', { doneAt: '2026-11-09T00:00:00.000Z' })],
    }),
  ];

  const { items, total } = selectDashboardFollowUps(rows, { today: TODAY });
  assert.equal(total, 7);
  assert.deepEqual(items.map((item) => item.id), [2, 7, 9, 13, 1, 8, 3]);

  const chase = items[0];
  assert.equal(chase.customerName, 'Baowu');
  assert.equal(chase.orderNo, 'HRC-9');
  assert.equal(chase.overdueCount, 1);
  assert.equal(chase.next.kind, 'LC_OPEN_DEADLINE');
  assert.equal(chase.next.label, 'L/C to be opened by');
  assert.equal(chase.next.zh, '信用证开证截止');
  assert.equal(chase.next.short, 'L/C open');
  assert.equal(chase.next.dueDate, '2026-11-01');
  assert.equal(chase.next.cue, '9d over');
  assert.equal(chase.next.tone, 'overdue');
  // The milestone owner chases it; the follow-up owner is only the fallback.
  assert.equal(chase.next.ownerName, 'Bo');
  assert.equal(chase.ownerName, 'Ada');
  assert.equal(chase.dates[1].short, 'Down payment');
  assert.equal(chase.dates[1].dueDate, '2026-11-18');
  assert.equal(chase.dates.some((d) => d.kind === 'CONTRACT_SIGNED'), false);

  assert.equal(items[2].signedOn, '2026-11-02');
  assert.equal(items[2].next.cue, 'Today');
  assert.equal(items[2].next.tone, 'today');
  assert.equal(items[4].next.cue, 'in 10d');
  assert.equal(items[4].next.tone, 'soon');
  assert.equal(items[4].next.ownerName, 'Ada');
  assert.equal(items[5].status, 'ON_HOLD');
  assert.equal(items[5].next.tone, 'later');
  assert.equal(items[6].next, null);
  assert.equal(items[6].customerName, null);
});

test('caps the strip and keeps extra open dates off the card', () => {
  const manyDates = [
    signed('2026-06-01'),
    ...['LC_OPEN_DEADLINE', 'LC_RECEIVED', 'PAYMENT_DOWN', 'PAYMENT_SHIPMENT', 'DRAWING_APPROVAL', 'FAT'].map((kind, i) => (
      milestone({ id: 300 + i, kind, dueDate: `2026-11-${String(12 + i).padStart(2, '0')}`, en: kind })
    )),
  ];
  const rows = [
    row({ id: 30, milestones: manyDates }),
    ...Array.from({ length: DASHBOARD_FOLLOWUP_LIMIT + 2 }, (_, i) => row({
      id: 40 + i,
      milestones: [
        signed('2026-07-01'),
        milestone({ id: 400 + i, kind: 'FAC', dueDate: '2026-12-15', en: 'FAC (final acceptance)' }),
      ],
    })),
  ];

  const { items, total } = selectDashboardFollowUps(rows, { today: TODAY });
  assert.equal(items.length, DASHBOARD_FOLLOWUP_LIMIT);
  assert.equal(total, DASHBOARD_FOLLOWUP_LIMIT + 3);
  assert.equal(items[0].id, 30);
  assert.equal(items[0].dates.length, 4);
  assert.equal(items[0].moreDates, 2);
  assert.deepEqual(items[0].dates.map((d) => d.dueDate), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
});

test('the strip never carries contract value, notes, or milestone essays', () => {
  const { items } = selectDashboardFollowUps([
    row({
      id: 12,
      contractValue: 'USD 980,000',
      notes: 'private: down payment landed in account 9988',
      milestones: [
        signed('2026-10-02'),
        milestone({
          id: 121,
          kind: 'LC_OPEN_DEADLINE',
          dueDate: '2026-11-12',
          label: 'Buyer opens L/C',
          en: 'L/C to be opened by',
          notes: 'call treasury and quote the full discrepancy paragraph',
        }),
      ],
    }),
  ], { today: TODAY });

  const dumped = JSON.stringify(items);
  assert.equal(dumped.includes('980,000'), false);
  assert.equal(dumped.includes('9988'), false);
  assert.equal(dumped.includes('discrepancy'), false);
  assert.equal(dumped.includes('contractValue'), false);
  assert.equal(items[0].next.label, 'Buyer opens L/C');
  assert.equal(items[0].next.short, 'L/C open');
  assert.equal(Object.keys(items[0]).sort().join(','), 'customerName,dates,id,moreDates,next,orderNo,overdueCount,ownerName,signedOn,status,title');
});
