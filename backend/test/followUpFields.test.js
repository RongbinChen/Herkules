import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { followUpCreateData, followUpUpdateData } from '../src/services/followUpFields.js';
import { presentContractValue } from '../src/services/followUpValue.js';

const shenyang = {
  title: 'Shenyang Fortune Precision Equipment Co., Ltd. — GRG-FCJM-202608A',
  orderNo: 'GRG-FCJM-202608A',
  machineType: 'ProfiMill evo 5000/80-G',
  machineSerial: '  5.1022  ',
  contractValue: 'EUR 4,000,000.00',
  team: 'WRC',
  notes: '',
};

test('create stores a trimmed serial and still saves when the serial is blank', () => {
  const withSerial = followUpCreateData(shenyang, { userId: 4, creatorTeam: 'HRC' });
  assert.equal(withSerial.title, shenyang.title);
  assert.equal(withSerial.orderNo, 'GRG-FCJM-202608A');
  assert.equal(withSerial.machineType, 'ProfiMill evo 5000/80-G');
  assert.equal(withSerial.machineSerial, '5.1022');
  assert.equal(withSerial.contractValue, 'EUR 4,000,000.00');
  assert.equal(withSerial.team, 'WRC');
  assert.equal(withSerial.ownerId, 4);
  assert.equal(withSerial.createdById, 4);
  assert.equal(withSerial.notes, null);

  for (const machineSerial of [undefined, null, '', '   ']) {
    const data = followUpCreateData({ ...shenyang, machineSerial }, { userId: 4, creatorTeam: 'WRC' });
    assert.equal(data.machineSerial, null);
    assert.equal(data.machineType, 'ProfiMill evo 5000/80-G');
    assert.equal(data.contractValue, 'EUR 4,000,000.00');
  }
});

test('an older follow-up with no serial still has a null column and a team', () => {
  const data = followUpCreateData({ title: '  Older order  ' }, { userId: 1, creatorTeam: 'OTHER' });
  assert.equal(data.title, 'Older order');
  assert.equal(data.machineSerial, null);
  assert.equal(data.machineType, null);
  assert.equal(data.contractValue, null);
  assert.equal(data.team, 'HRC');
  assert.equal(data.ownerId, 1);
});

test('update writes or clears the serial without touching fields that were not sent', () => {
  assert.deepEqual(
    followUpUpdateData({ machineSerial: ' SN-9 ' }, { mayWriteValue: false }),
    { machineSerial: 'SN-9' },
  );
  assert.deepEqual(
    followUpUpdateData({ machineSerial: '  ' }, { mayWriteValue: true }),
    { machineSerial: null },
  );
  // A status change from the detail header must not wipe a serial already stored.
  assert.deepEqual(
    followUpUpdateData({ status: 'ON_HOLD' }, { mayWriteValue: true }),
    { status: 'ON_HOLD' },
  );
});

test('someone who cannot write the contract value can still save a serial', () => {
  const blocked = followUpUpdateData({
    machineSerial: '5.1022',
    machineType: 'ProfiMill evo 5000/80-G',
    contractValue: 'EUR 9',
  }, { mayWriteValue: false });
  assert.equal(blocked.machineSerial, '5.1022');
  assert.equal(blocked.machineType, 'ProfiMill evo 5000/80-G');
  assert.equal(Object.hasOwn(blocked, 'contractValue'), false);

  const allowed = followUpUpdateData({
    machineSerial: '5.1022',
    contractValue: '',
  }, { mayWriteValue: true });
  assert.equal(allowed.machineSerial, '5.1022');
  assert.equal(allowed.contractValue, null);
});

test('a locked or hidden price still returns the machine serial', () => {
  const row = {
    id: 8,
    team: 'WRC',
    machineType: 'ProfiMill evo 5000/80-G',
    machineSerial: '5.1022',
    contractValue: 'EUR 4,000,000.00',
  };
  const locked = presentContractValue(row, { isAdmin: false, team: 'WRC' }, null);
  assert.equal(locked.machineSerial, '5.1022');
  assert.equal(locked.machineType, 'ProfiMill evo 5000/80-G');
  assert.equal(locked.contractValue, null);
  assert.equal(locked.contractValueLocked, true);
  assert.equal(locked.hasContractValue, true);
  assert.equal(JSON.stringify(locked).includes('4,000,000'), false);

  const outsider = presentContractValue(row, { isAdmin: false, team: 'HRC' }, 'HRC');
  assert.equal(outsider.machineSerial, '5.1022');
  assert.equal(outsider.contractValue, null);
  assert.equal(outsider.contractValueHidden, true);
  assert.equal(outsider.contractValueLocked, undefined);
});

test('the follow-up schema keeps machineSerial optional and the route keeps the PIN gate', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const model = schema.split('model ProjectFollowUp {')[1].split('model ')[0];
  assert.match(model, /machineSerial\s+String\?/);
  assert.doesNotMatch(model, /machineSerial\s+String\?[^\n]*@default/);

  const route = readFileSync(new URL('../src/routes/followUps.js', import.meta.url), 'utf8');
  assert.match(route, /followUpCreateData\(b,/);
  assert.match(route, /followUpUpdateData\(b,/);
  assert.match(route, /machineSerial: \{ contains: q/);
  assert.ok(route.split('presentContractValue(').length - 1 >= 4);
  assert.match(route, /readContractUnlock\(req\)/);
  assert.match(route, /maySuggestContractValue\(viewer, forTeam, req\.contractTeam\)/);
  assert.match(route, /viewerMaySeeValue\(viewer, targetTeam\) && unlockTeam === targetTeam/);
  assert.equal(route.includes('redactValue'), false);
  assert.equal(route.includes('canSeeValue'), false);
});
