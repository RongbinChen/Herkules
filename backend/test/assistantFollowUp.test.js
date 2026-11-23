import test from 'node:test';
import assert from 'node:assert/strict';
import { presentFollowUpForAssistant, lockedContractResult } from '../src/services/assistantFollowUp.js';

const AMOUNT = 'EUR 9,900,000.00';

function row() {
  return {
    id: 8,
    title: 'Demo milling order',
    orderNo: 'PO-100',
    status: 'ACTIVE',
    team: 'HRC',
    machineType: 'ProfiMill',
    machineSerial: 'SN-001',
    contractValue: AMOUNT,
    notes: 'LC in draft',
    owner: { name: 'Alex' },
    customer: { id: 12, name: 'Demo Shipbuilding Co.' },
    milestones: [
      { kind: 'LC_OPENING', label: null, dueDate: '2026-12-01T00:00:00.000Z', doneAt: null, owner: { name: 'Alex' } },
    ],
    contacts: [{ name: 'Pat Lee', role: 'Buyer', company: 'Demo Shipbuilding Co.', phone: 'should-not-appear' }],
    updates: [],
    hotProject: { id: 3, category: 'OPEN' },
  };
}

function assertNoPrice(payload) {
  const dumped = JSON.stringify(payload);
  assert.equal(dumped.includes(AMOUNT), false);
  assert.equal(dumped.includes('9,900,000'), false);
  assert.equal(payload.contractValue, undefined);
}

test('a locked teammate gets follow-up status and dates but no amount', () => {
  const out = presentFollowUpForAssistant(row(), { isAdmin: false, team: 'HRC' }, null, { detail: true });
  assertNoPrice(out);
  assert.equal(out.contractValueLocked, true);
  assert.equal(out.hasContractValue, true);
  assert.equal(out.href, '/followups/8');
  assert.equal(out.nextMilestone.kind, 'LC_OPENING');
  assert.equal(out.customer.href, '/customers/12');
  assert.equal(out.hotProject.href, '/hotprojects?id=3');
  assert.match(out.valueNote, /Unlock the team PIN/);
  assert.equal(JSON.stringify(out).includes('should-not-appear'), false);
});

test('the matching PIN includes the amount the same way the follow-up page would', () => {
  const out = presentFollowUpForAssistant(row(), { isAdmin: false, team: 'HRC' }, 'HRC');
  assert.equal(out.contractValue, AMOUNT);
  assert.equal(out.sensitive, true);
  assert.equal(out.contractValueLocked, false);
});

test('the wrong team never receives the amount, PIN or not', () => {
  const out = presentFollowUpForAssistant(row(), { isAdmin: false, team: 'WRC' }, 'WRC', { detail: true });
  assertNoPrice(out);
  assert.equal(out.contractValueHidden, true);
});

test('ask_contracts returns a locked pointer at /contracts when the PIN is not unlocked', () => {
  const locked = lockedContractResult({ customerId: 12 });
  assert.equal(locked.locked, true);
  assert.equal(locked.href, '/contracts?customerId=12');
  assert.match(locked.message, /PIN/);
  assert.equal(JSON.stringify(locked).includes(AMOUNT), false);
});
