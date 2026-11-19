import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { missingCreateFieldsError } from '../src/services/visitReportRequired.js';

test('create rejects a missing title or visit date with a human-readable Chinese message', () => {
  assert.equal(missingCreateFieldsError('Plant visit', '2022-08-18'), null);
  assert.equal(missingCreateFieldsError('  Plant visit  ', '2022-08-18'), null);
  assert.equal(missingCreateFieldsError('', '2022-08-18'), '请填写标题');
  assert.equal(missingCreateFieldsError('   ', '2022-08-18'), '请填写标题');
  assert.equal(missingCreateFieldsError(null, '2022-08-18'), '请填写标题');
  assert.equal(missingCreateFieldsError('Plant visit', ''), '请填写拜访日期');
  assert.equal(missingCreateFieldsError('Plant visit', '  '), '请填写拜访日期');
  assert.equal(missingCreateFieldsError('Plant visit', null), '请填写拜访日期');
  assert.equal(missingCreateFieldsError('Plant visit', undefined), '请填写拜访日期');
  assert.equal(missingCreateFieldsError('', ''), '请填写标题和拜访日期');
  assert.equal(missingCreateFieldsError(undefined, undefined), '请填写标题和拜访日期');
  for (const args of [['', '2022-08-18'], ['Plant visit', ''], ['', '']]) {
    const message = missingCreateFieldsError(...args);
    assert.doesNotMatch(message, /visitDate/);
    assert.doesNotMatch(message, /\btitle\b/);
  }
});

test('the create route uses the distinguished required-field messages', () => {
  const route = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/visitReports.js'),
    'utf8',
  );
  const create = route.slice(route.indexOf("router.post('/',"), route.indexOf('router.put'));
  assert.match(create, /missingCreateFieldsError\(title, visitDate\)/);
  assert.match(create, /status\(400\)\.json\(\{ error: requiredError \}\)/);
  assert.doesNotMatch(create, /title 与 visitDate 必填/);
  assert.doesNotMatch(route, /title 与 visitDate 必填/);
});
