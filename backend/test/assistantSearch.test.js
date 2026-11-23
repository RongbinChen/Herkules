import test from 'node:test';
import assert from 'node:assert/strict';
import { textMatchesQuery, selectMatching } from '../src/services/assistantSearch.js';

test('hengli matches Hengli Engine and does not match Shengli Oilfield', () => {
  assert.equal(textMatchesQuery('Hengli Engine (Dalian) Co., Ltd.', 'hengli'), true);
  assert.equal(textMatchesQuery('Hengli Engine (Dalian) Co., Ltd.', 'Hengli'), true);
  assert.equal(textMatchesQuery('Dalian Hengli', 'hengli'), true);
  assert.equal(textMatchesQuery('Meeting at (Hengli)', 'Hengli'), true);
  assert.equal(textMatchesQuery('Shengli Oilfield Shengli Power Machinery Group Co., Ltd.', 'hengli'), false);
  assert.equal(textMatchesQuery('Shengli Oilfield Shengli Power Machinery Group Co., Ltd.', 'Hengli'), false);
  assert.equal(textMatchesQuery('SHENGLI POWER', 'hengli'), false);
  // A shorter prefix at a word start still finds the same customer.
  assert.equal(textMatchesQuery('Hengli Engine (Dalian) Co., Ltd.', 'Heng'), true);
  assert.equal(textMatchesQuery('Shengli Oilfield Shengli Power Machinery Group Co., Ltd.', 'Heng'), false);
});

test('selectMatching drops Shengli customer rows from a Hengli query', () => {
  const rows = [
    { name: 'Hengli Engine (Dalian) Co., Ltd.' },
    { name: 'Shengli Oilfield Shengli Power Machinery Group Co., Ltd.' },
    { name: 'Shengli Oilfield Shengli Power Machinery Group Co., Ltd. ,' },
  ];
  const hit = selectMatching(rows, 'hengli', (r) => [r.name]);
  assert.deepEqual(hit.map((r) => r.name), ['Hengli Engine (Dalian) Co., Ltd.']);
});
