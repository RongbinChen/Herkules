import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractFileSearchOr, normalizeMachineSerial } from '../src/services/machineSerial.js';

test('upload stores a trimmed serial and treats a blank field as null', () => {
  assert.deepEqual(normalizeMachineSerial('  5.1022  '), { ok: true, value: '5.1022' });
  assert.deepEqual(normalizeMachineSerial('5.1022'), { ok: true, value: '5.1022' });
  assert.deepEqual(normalizeMachineSerial('WS-180/2'), { ok: true, value: 'WS-180/2' });
  assert.deepEqual(normalizeMachineSerial(''), { ok: true, value: null });
  assert.deepEqual(normalizeMachineSerial('   '), { ok: true, value: null });
  assert.deepEqual(normalizeMachineSerial(null), { ok: true, value: null });
  assert.deepEqual(normalizeMachineSerial(undefined), { ok: true, value: null });
});

test('edit can clear a serial, and a non-serial is refused rather than stored', () => {
  // Clearing the field on edit is the same write as leaving it blank on upload.
  assert.deepEqual(normalizeMachineSerial(null), { ok: true, value: null });
  assert.equal(normalizeMachineSerial('5.1022; drop').ok, false);
  assert.equal(normalizeMachineSerial('hello world!').ok, false);
  assert.equal(normalizeMachineSerial('x'.repeat(41)).ok, false);
  assert.equal(normalizeMachineSerial('.1022').ok, false);
});

test('search matches serial as well as filename, note and customer', () => {
  const or = contractFileSearchOr('5.1022');
  assert.deepEqual(or, [
    { filename: { contains: '5.1022', mode: 'insensitive' } },
    { note: { contains: '5.1022', mode: 'insensitive' } },
    { machineSerial: { contains: '5.1022', mode: 'insensitive' } },
    { customer: { name: { contains: '5.1022', mode: 'insensitive' } } },
  ]);
});

test('upload and edit persist machineSerial, and search reads that column', () => {
  const src = readFileSync(new URL('../src/routes/contracts.js', import.meta.url), 'utf8');
  const select = src.slice(src.indexOf('const FILE_SELECT'), src.indexOf('const LIST_SELECT'));
  assert.match(select, /machineSerial:\s*true/);

  const create = src.slice(src.indexOf('const saved = await prisma.contractFile.create'), src.indexOf('res.status(201)'));
  assert.match(create, /machineSerial:\s*serial\.value/);

  const patch = src.slice(src.indexOf('const editsMeta'), src.indexOf('const updated = await prisma.contractFile.update'));
  assert.match(patch, /machineSerial/);
  assert.match(patch, /data\.machineSerial = serial\.value/);
  // Serial is file metadata: the same uploader-or-admin gate as type and note.
  assert.ok(patch.indexOf('machineSerial') < patch.indexOf('Only the uploader or an admin'));

  assert.match(src, /contractFileSearchOr\(q\)/);
});
