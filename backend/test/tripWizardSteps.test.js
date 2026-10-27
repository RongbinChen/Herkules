import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  buildTripPayload,
  maxReachable,
  resolveWizardStep,
  stepErrors,
  wizardStepNeedsRedirect,
} from '../../frontend/src/components/trip-wizard/context.js';

function draft(overrides = {}) {
  return {
    meta: {
      title: 'Xi\'an trip',
      startTime: '2026-09-14T09:00',
      endTime: '2026-09-16T18:00',
      notes: '',
      assigneeIds: [],
      hidePhoneOnShare: false,
      flights: [],
      ...(overrides.meta || {}),
    },
    stops: overrides.stops ?? [{ customerId: 1, priority: 'NORMAL', visitDuration: '', notes: '', plannedArrival: null }],
    constraints: overrides.constraints ?? '',
    baseStopOrder: overrides.baseStopOrder,
  };
}

test('向导是 Basics / Order / Plan 三步', () => {
  assert.deepEqual(STEPS, ['Basics', 'Order', 'Plan']);
});

test('约束为空也不挡住 Plan；缺标题或缺客户停在前面', () => {
  assert.deepEqual(stepErrors(draft())[3], []);
  assert.equal(maxReachable(draft()), 3);
  assert.equal(maxReachable(draft({ stops: [] })), 1);
  assert.ok(stepErrors(draft({ meta: { title: '  ' } }))[1].includes('Trip title is required'));
  const backwards = draft({ meta: { startTime: '2026-09-16T18:00', endTime: '2026-09-14T09:00' } });
  assert.ok(stepErrors(backwards)[1].some((e) => e.includes('End must be after start')));
});

test('编辑默认落在 Plan，旧的 step=4 收成 3，新建缺省仍是第 1 步', () => {
  assert.equal(resolveWizardStep(null, 'edit'), 3);
  assert.equal(resolveWizardStep('', 'edit'), 3);
  assert.equal(resolveWizardStep('foo', 'edit'), 3);
  assert.equal(resolveWizardStep('4', 'edit'), 3);
  assert.equal(resolveWizardStep('4', 'create'), 3);
  assert.equal(resolveWizardStep('5', 'create'), 3);
  assert.equal(resolveWizardStep('2', 'edit'), 2);
  assert.equal(resolveWizardStep(null, 'create'), 1);
  assert.equal(resolveWizardStep('1', 'create'), 1);
  assert.equal(wizardStepNeedsRedirect(null, 'edit'), true);
  assert.equal(wizardStepNeedsRedirect('4', 'create'), true);
  assert.equal(wizardStepNeedsRedirect('4', 'edit'), true);
  assert.equal(wizardStepNeedsRedirect(null, 'create'), false);
  assert.equal(wizardStepNeedsRedirect('3', 'edit'), false);
  assert.equal(wizardStepNeedsRedirect('1', 'create'), false);
});

test('保存载荷仍走 stops，空约束写成 null', () => {
  const payload = buildTripPayload(draft({ constraints: '  ' }));
  assert.equal(payload.constraints, null);
  assert.equal(payload.customerIds, undefined);
  assert.deepEqual(payload.stops.map((s) => s.customerId), [1]);
  assert.equal(buildTripPayload(draft({ constraints: '- Wednesday only' })).constraints, '- Wednesday only');
});
