import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { readContractUnlock } from '../src/services/contractUnlock.js';
import {
  maySuggestContractValue,
  presentContractValue,
  viewerMaySeeValue,
} from '../src/services/followUpValue.js';
import { selectDashboardFollowUps } from '../src/services/dashboardFollowUps.js';
import { selectOpenOrders } from '../src/services/openOrders.js';

const AMOUNT = 'EUR 38,000,000.00';
const SECRET = 'followup-value-test-secret';

function order(overrides = {}) {
  return {
    id: 12,
    title: 'Hengli Engine (Dalian) Co., Ltd. - 4 milling machines',
    team: 'WRC',
    machineType: 'PROFIMILL 8000/120-G',
    orderNo: '26HMSQ-Siegen0902-0212-G',
    notes: 'letter of credit still in draft',
    contractValue: AMOUNT,
    owner: { id: 4, name: 'Becky Chen' },
    ...overrides,
  };
}

function assertNoPrice(payload) {
  const dumped = JSON.stringify(payload);
  assert.equal(dumped.includes(AMOUNT), false);
  assert.equal(dumped.includes('38,000,000'), false);
  assert.equal(dumped.includes('38000000'), false);
  assert.equal(dumped.includes('EUR'), false);
  assert.equal(payload.contractValue, null);
}

test('a locked teammate or admin does not receive the raw contract value', () => {
  const row = order();
  for (const viewer of [{ isAdmin: false, team: 'WRC' }, { isAdmin: true, team: null }]) {
    const locked = presentContractValue(row, viewer, null);
    assertNoPrice(locked);
    assert.equal(locked.contractValueLocked, true);
    assert.equal(locked.hasContractValue, true);
    assert.equal(locked.contractValueHidden, undefined);
    assert.equal(typeof locked.hasContractValue, 'boolean');
    assert.equal(locked.title, row.title);
    assert.equal(locked.machineType, row.machineType);
    assert.equal(locked.notes, row.notes);
  }
});

test('the wrong team PIN does not open the price, even for an admin', () => {
  const locked = presentContractValue(order(), { isAdmin: true, team: null }, 'HRC');
  assertNoPrice(locked);
  assert.equal(locked.contractValueLocked, true);
  assert.equal(locked.hasContractValue, true);
});

test('an unlocked teammate or admin receives the contract value', () => {
  const row = order();
  const teammate = presentContractValue(row, { isAdmin: false, team: 'WRC' }, 'WRC');
  const admin = presentContractValue(row, { isAdmin: true, team: null }, 'WRC');
  for (const open of [teammate, admin]) {
    assert.equal(open.contractValue, AMOUNT);
    assert.equal(open.contractValueLocked, false);
    assert.equal(open.hasContractValue, true);
    assert.equal(open.contractValueHidden, undefined);
    assert.equal(open.team, 'WRC');
  }
});

test('someone outside the team never receives the price, PIN or not', () => {
  const row = order();
  for (const unlockTeam of [null, 'WRC', 'HRC']) {
    const hidden = presentContractValue(row, { isAdmin: false, team: 'HRC' }, unlockTeam);
    assertNoPrice(hidden);
    assert.equal(hidden.contractValueHidden, true);
    assert.equal(hidden.contractValueLocked, undefined);
    assert.equal(hidden.hasContractValue, undefined);
    assert.equal(JSON.stringify(hidden).includes('hasContractValue'), false);
  }
  assert.equal(viewerMaySeeValue({ isAdmin: false, team: 'OTHER' }, 'WRC'), false);
  assert.equal(viewerMaySeeValue(null, 'WRC'), false);
});

test('an empty price is not described as a hidden amount', () => {
  for (const contractValue of [null, '', '   ']) {
    const locked = presentContractValue(order({ contractValue }), { isAdmin: true, team: null }, null);
    assert.equal(locked.contractValue, null);
    assert.equal(locked.hasContractValue, false);
    assert.equal(locked.contractValueLocked, true);
    const open = presentContractValue(order({ contractValue }), { isAdmin: false, team: 'WRC' }, 'WRC');
    assert.equal(open.contractValue, null);
    assert.equal(open.hasContractValue, false);
    assert.equal(open.contractValueLocked, false);
  }
});

test('a currency string other than EUR is withheld the same way', () => {
  const locked = presentContractValue(
    order({ contractValue: 'USD 980,000' }),
    { isAdmin: false, team: 'WRC' },
    null,
  );
  const dumped = JSON.stringify(locked);
  assert.equal(dumped.includes('980,000'), false);
  assert.equal(dumped.includes('USD'), false);
  assert.equal(locked.hasContractValue, true);
});

test('suggesting a price takes the same two gates, on the same team', () => {
  const wrc = { isAdmin: false, team: 'WRC' };
  const admin = { isAdmin: true, team: null };
  assert.equal(maySuggestContractValue(wrc, 'WRC', 'WRC'), true);
  assert.equal(maySuggestContractValue(admin, 'WRC', 'WRC'), true);
  assert.equal(maySuggestContractValue(admin, 'HRC', 'WRC'), false);
  assert.equal(maySuggestContractValue(wrc, 'WRC', null), false);
  assert.equal(maySuggestContractValue(wrc, 'WRC', 'HRC'), false);
  assert.equal(maySuggestContractValue({ isAdmin: false, team: 'HRC' }, 'WRC', 'WRC'), false);
});

test('the unlock token is the existing contract PIN, bound to one team and one user', () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  try {
    const sign = (payload, options) => jwt.sign(
      { scope: 'contract', team: 'WRC', userId: 7, ...payload },
      SECRET,
      { expiresIn: '5m', ...options },
    );
    const req = (userId, raw) => ({
      user: { userId },
      headers: raw ? { 'x-contract-token': raw } : {},
    });

    assert.equal(readContractUnlock(req(7, sign({}))), 'WRC');
    assert.equal(readContractUnlock(req(7, sign({ team: 'HRC' }))), 'HRC');
    assert.equal(readContractUnlock(req(7, null)), null);
    assert.equal(readContractUnlock({ user: { userId: 7 }, headers: {} }), null);
    assert.equal(readContractUnlock(req(8, sign({ userId: 7 }))), null);
    assert.equal(readContractUnlock(req(7, sign({ scope: 'auth' }))), null);
    assert.equal(readContractUnlock(req(7, sign({ team: 'OTHER' }))), null);
    assert.equal(readContractUnlock(req(7, sign({}, { expiresIn: '-10s' }))), null);
    assert.equal(readContractUnlock(req(7, 'not-a-token')), null);
    assert.equal(readContractUnlock({ headers: { 'x-contract-token': sign({}) } }), null);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

test('dashboard strip still has no contract value', () => {
  const { items } = selectDashboardFollowUps([{
    id: 12,
    title: 'Hengli Engine (Dalian) Co., Ltd. - 4 milling machines',
    orderNo: '26HMSQ-Siegen0902-0212-G',
    status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00.000Z',
    contractValue: AMOUNT,
    notes: 'private account 9988',
    customer: { name: 'Hengli Engine (Dalian) Co., Ltd.' },
    owner: { id: 4, name: 'Becky Chen' },
    milestones: [
      {
        id: 1,
        kind: 'CONTRACT_SIGNED',
        label: null,
        dueDate: '2026-09-02',
        doneAt: '2026-09-02T02:00:00.000Z',
        en: 'Contract signed',
        zh: '合同签署',
        owner: { name: 'Becky Chen' },
      },
      {
        id: 2,
        kind: 'PAYMENT_DOWN',
        label: null,
        dueDate: '2026-11-20',
        doneAt: null,
        en: 'Down payment received',
        zh: '预付款到账',
        owner: { name: 'Becky Chen' },
        notes: '20% of the contract',
      },
    ],
  }], { today: '2026-11-10' });

  assert.equal(items.length, 1);
  const dumped = JSON.stringify(items);
  assert.equal(dumped.includes(AMOUNT), false);
  assert.equal(dumped.includes('38,000,000'), false);
  assert.equal(dumped.includes('EUR'), false);
  assert.equal(dumped.includes('contractValue'), false);
  assert.equal(dumped.includes('9988'), false);
});

test('open orders do not carry the contract amount', () => {
  const orders = selectOpenOrders([{
    id: 1,
    filename: 'hengli-commercial.pdf',
    docType: 'COMMERCIAL',
    note: null,
    customerId: 9,
    customerName: 'Hengli Engine (Dalian) Co., Ltd.',
    ocrStatus: 'DONE',
    summary: {
      fields: [
        { key: 'amount', value: AMOUNT },
        { key: 'contractNo', value: '26HMSQ-Siegen0902-0212-G' },
        { key: 'signedDate', value: '2026-09-02' },
        { key: 'machine', value: 'PROFIMILL 8000/120-G' },
      ],
    },
    team: 'WRC',
    closedAt: null,
    linkedFollowUps: [],
  }], []);
  assert.equal(orders.length, 1);
  const dumped = JSON.stringify(orders);
  assert.equal(dumped.includes(AMOUNT), false);
  assert.equal(dumped.includes('38,000,000'), false);
  assert.equal(dumped.includes('EUR'), false);
  assert.equal(dumped.includes('amount'), false);
  assert.equal(orders[0].machineType, 'PROFIMILL 8000/120-G');
});

test('list, detail, create and update all pass the price through the PIN gate', () => {
  const src = readFileSync(new URL('../src/routes/followUps.js', import.meta.url), 'utf8');
  const uses = src.split('presentContractValue(').length - 1;
  assert.ok(uses >= 4, `expected the gate on list, detail, create and update, saw ${uses}`);
  assert.match(src, /readContractUnlock\(req\)/);
  assert.match(src, /maySuggestContractValue\(viewer, forTeam, req\.contractTeam\)/);
  assert.match(src, /viewerMaySeeValue\(viewer, targetTeam\) && unlockTeam === targetTeam/);

  const dashStart = src.indexOf("router.get('/dashboard'");
  const detailStart = src.indexOf("router.get('/:id'");
  assert.ok(dashStart !== -1 && detailStart > dashStart);
  const dashboard = src.slice(dashStart, detailStart);
  assert.equal(dashboard.includes('contractValue'), false);

  const mail = readFileSync(new URL('../src/services/followUpMail.js', import.meta.url), 'utf8');
  const reminders = readFileSync(new URL('../src/services/followUps.js', import.meta.url), 'utf8');
  assert.equal(mail.includes('contractValue'), false);
  assert.equal(reminders.includes('contractValue'), false);
});
