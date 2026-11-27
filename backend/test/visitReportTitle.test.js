import test from 'node:test';
import assert from 'node:assert/strict';
import { alignGeneratedTitleDate, sanitizeGeneratedTitle } from '../src/services/visitReport.js';

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

test('a generated title uses the recognized visit date and never keeps today', () => {
  const today = '2026-11-27';
  const withToday = 'Jiangsu Xihua new milling machine enquiry exchange (2026-11-27)';
  assert.equal(
    alignGeneratedTitleDate(withToday, '2026-07-16'),
    'Jiangsu Xihua new milling machine enquiry exchange (2026-07-16)',
  );
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua exchange (July 16th, 2026)', '2026-07-16'),
    'Jiangsu Xihua exchange (2026-07-16)',
  );
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua exchange (November 27, 2026)', '2026-07-16'),
    'Jiangsu Xihua exchange (2026-07-16)',
  );
  const omitted = alignGeneratedTitleDate(withToday, '');
  assert.equal(omitted, 'Jiangsu Xihua new milling machine enquiry exchange');
  assert.doesNotMatch(omitted, new RegExp(today));
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua exchange (November 27, 2026)', null),
    'Jiangsu Xihua exchange',
  );
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua exchange (20260716)', ''),
    'Jiangsu Xihua exchange',
  );
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua exchange (07/16/2026)', ''),
    'Jiangsu Xihua exchange',
  );
  assert.equal(
    alignGeneratedTitleDate('Jiangsu Xihua new milling machine enquiry exchange', ''),
    'Jiangsu Xihua new milling machine enquiry exchange',
  );
  assert.equal(alignGeneratedTitleDate('Visit Report (2026-11-27)', ''), null);
});
