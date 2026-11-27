import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGeneratedTitle } from '../src/services/visitReport.js';

test('sanitizeGeneratedTitle keeps a descriptive title and rejects template leftovers', () => {
  assert.equal(
    sanitizeGeneratedTitle('Northline grinders reference visit (November 26, 2026)'),
    'Northline grinders reference visit (November 26, 2026)',
  );
  assert.equal(sanitizeGeneratedTitle('"Northline grinders reference visit"'), 'Northline grinders reference visit');
  assert.equal(sanitizeGeneratedTitle('# Plant walk-through'), 'Plant walk-through');
  assert.equal(sanitizeGeneratedTitle('Please select type of report'), null);
  assert.equal(sanitizeGeneratedTitle('Visit Report'), null);
  assert.equal(sanitizeGeneratedTitle('拜访报告'), null);
  assert.equal(sanitizeGeneratedTitle(''), null);
  assert.equal(sanitizeGeneratedTitle('   '), null);
});
