import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUMMARY_VISITOR_RULE,
  isOurVisitBrand,
  visitorsForSummary,
  sanitizeGeneratedSummary,
  buildSummaryUserContent,
} from '../src/services/visitReport.js';

const FROM_ONLY = [
  '+----------+------------+',
  '| From     | Ada North  |',
  '+----------+------------+',
  '',
  'Notes from the mill walk-through.',
].join('\n');

test('SUMMARY_VISITOR_RULE tells the model to name the visitor, not the company', () => {
  assert.match(SUMMARY_VISITOR_RULE, /From/);
  assert.match(SUMMARY_VISITOR_RULE, /Herkules/);
  assert.match(SUMMARY_VISITOR_RULE, /Waldrich Siegen/);
  assert.match(SUMMARY_VISITOR_RULE, /Herkules Group/);
  assert.match(SUMMARY_VISITOR_RULE, /Herkules visited/);
  assert.match(SUMMARY_VISITOR_RULE, /不要编造人名/);
});

test('isOurVisitBrand covers our names and not a customer or Waldrich Coburg', () => {
  assert.equal(isOurVisitBrand('Herkules'), true);
  assert.equal(isOurVisitBrand('Herkules Group'), true);
  assert.equal(isOurVisitBrand('Waldrich Siegen'), true);
  assert.equal(isOurVisitBrand('WaldrichSiegen'), true);
  assert.equal(isOurVisitBrand('瓦德里希西根'), true);
  assert.equal(isOurVisitBrand('赫库勒斯'), true);
  assert.equal(isOurVisitBrand('Waldrich Coburg'), false);
  assert.equal(isOurVisitBrand('Northline Paper'), false);
  assert.equal(isOurVisitBrand('Ada North'), false);
  assert.equal(isOurVisitBrand(''), false);
});

test('visitorsForSummary uses a letterhead From and ignores a brand-only name', () => {
  assert.deepEqual(visitorsForSummary(FROM_ONLY), ['Ada North']);
  assert.deepEqual(visitorsForSummary('No letterhead here.'), []);
  assert.deepEqual(visitorsForSummary('plain notes', ['Herkules']), []);
  assert.deepEqual(visitorsForSummary('plain notes', ['Ada North', 'ada north']), ['Ada North']);
});

test('sanitizeGeneratedSummary replaces a company visiting subject with the named person', () => {
  const visitors = { visitors: ['Ada North'] };
  assert.equal(
    sanitizeGeneratedSummary(
      'Herkules visited Northline Paper, a 2026 joint venture in the region, to discuss grinders.',
      visitors,
    ),
    'Ada North visited Northline Paper, a 2026 joint venture in the region, to discuss grinders.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Waldrich Siegen visited the Northline mill last week.', visitors),
    'Ada North visited the Northline mill last week.',
  );
  assert.equal(
    sanitizeGeneratedSummary('WaldrichSiegen visited the Northline mill last week.', visitors),
    'Ada North visited the Northline mill last week.',
  );
  assert.equal(
    sanitizeGeneratedSummary('We from Herkules visited Northline Paper to discuss grinders.', visitors),
    'Ada North visited Northline Paper to discuss grinders.',
  );
  assert.equal(
    sanitizeGeneratedSummary('A team from Herkules visited Northline Paper.', visitors),
    'Ada North visited Northline Paper.',
  );
  assert.equal(
    sanitizeGeneratedSummary('The Herkules sales team visited Northline Paper.', visitors),
    'Ada North visited Northline Paper.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules Group visited Northline Paper to discuss grinders.', visitors),
    'Ada North visited Northline Paper to discuss grinders.',
  );
});

test('sanitizeGeneratedSummary uses a neutral opening when no visitor is known', () => {
  assert.equal(
    sanitizeGeneratedSummary('Herkules visited Northline Paper to discuss grinders.'),
    'The visit was to Northline Paper to discuss grinders.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules met with the plant manager at Northline.'),
    'The meeting was with the plant manager at Northline.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules held a meeting with the plant manager at Northline.'),
    'A meeting was held with the plant manager at Northline.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules paid a visit to Northline Paper.'),
    'The visit was to Northline Paper.',
  );
});

test('sanitizeGeneratedSummary rewrites a Chinese company opening and does not invent a name', () => {
  assert.equal(
    sanitizeGeneratedSummary('Herkules拜访了北线纸业，并讨论了磨床方案。', { visitors: ['陈安'] }),
    '陈安拜访了北线纸业，并讨论了磨床方案。',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules拜访了北线纸业。'),
    '本次拜访了北线纸业。',
  );
  assert.equal(
    sanitizeGeneratedSummary('赫库勒斯拜访了北线纸业。'),
    '本次拜访了北线纸业。',
  );
  assert.equal(
    sanitizeGeneratedSummary('瓦德里希西根拜访了北线纸业。'),
    '本次拜访了北线纸业。',
  );
});

test('sanitizeGeneratedSummary joins more than one named visitor', () => {
  assert.equal(
    sanitizeGeneratedSummary('Herkules visited Northline Paper.', {
      visitors: ['Ada North', 'Blake West'],
    }),
    'Ada North and Blake West visited Northline Paper.',
  );
  assert.equal(
    sanitizeGeneratedSummary('Herkules拜访了北线纸业。', {
      visitors: ['陈安', '李平'],
    }),
    '陈安、李平拜访了北线纸业。',
  );
});

test('sanitizeGeneratedSummary leaves customer names, products, and Waldrich Coburg alone', () => {
  const body = 'Northline Paper plans to buy a Herkules grinder and compared it with other brands.';
  assert.equal(sanitizeGeneratedSummary(body), body);
  const coburg = 'A competitor mentioned a Waldrich Coburg machine at the meeting.';
  assert.equal(sanitizeGeneratedSummary(coburg), coburg);
  const alreadyNamed = 'Ada North visited Northline Paper to discuss grinders.';
  assert.equal(sanitizeGeneratedSummary(alreadyNamed, { visitors: ['Ada North'] }), alreadyNamed);
  assert.equal(sanitizeGeneratedSummary(''), '');
  assert.equal(sanitizeGeneratedSummary(null), '');
});

test('buildSummaryUserContent names a letterhead From and repeats the visitor rule', () => {
  const named = buildSummaryUserContent(FROM_ONLY);
  assert.deepEqual(named.visitors, ['Ada North']);
  assert.match(named.user, /Visitors named in the letterhead or source: Ada North/);
  assert.match(named.user, /not to a company brand/);
  assert.match(named.user, /Notes from the mill walk-through/);
  assert.match(named.user, /Write the summary in English/);

  const unknown = buildSummaryUserContent('Meeting notes from the mill walk-through, no letterhead.');
  assert.deepEqual(unknown.visitors, []);
  assert.match(unknown.user, /do not invent a name/);
  assert.match(unknown.user, /without a company subject/);
});
