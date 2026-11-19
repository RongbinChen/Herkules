import test from 'node:test';
import assert from 'node:assert/strict';
import { authorNameFromContent, resolveAuthorIdFromUsers } from '../src/services/visitReportAuthor.js';

const users = [
  { id: 1, name: 'Ada North' },
  { id: 2, name: 'Ben South' },
];
const uploader = 99;

const fromBody = [
  'Telephone Call Report',
  '',
  '+----------+------------+---+------+------------+',
  '| To       | A. Example |   | From | Ada North  |',
  '+----------+------------+---+------+------------+',
  '| Company  | Northline  |   | Date | August 19, 2022 |',
  '+----------+------------+---+------+------------+',
  '',
  'The call covered the project briefing.',
].join('\n');

const faxNameBody = [
  '+----------+------------+---+------+------------+',
  '| To       | A. Example |   | Fax  | Pat Lee    |',
  '+----------+------------+---+------+------------+',
  '| Company  | Northline  |   | Date | August 19, 2022 |',
  '+----------+------------+---+------+------------+',
].join('\n');

const faxNumberBody = [
  '+----------+------------+---+------+------------+',
  '| To       | A. Example |   | Fax  | 555-0199   |',
  '+----------+------------+---+------+------------+',
  '| Company  | Northline  |   | Phone| 555-0100   |',
  '+----------+------------+---+------+------------+',
].join('\n');

test('a unique meta.author match credits that user', () => {
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'Ada North' } }, users, uploader), 1);
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'ada north' } }, users, uploader), 1);
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'North' } }, users, uploader), 1);
});

test('no match, a short name, or an empty name keeps the uploader', () => {
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'Zoe West' } }, users, uploader), uploader);
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'Al' } }, users, uploader), uploader);
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: '  ' } }, users, uploader), uploader);
  assert.equal(resolveAuthorIdFromUsers({}, users, uploader), uploader);
  assert.equal(resolveAuthorIdFromUsers(null, users, uploader), uploader);
});

test('an ambiguous name keeps the uploader', () => {
  const overlapping = [...users, { id: 3, name: 'Ada West' }];
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'Ada' } }, overlapping, uploader), uploader);
  assert.equal(resolveAuthorIdFromUsers({ meta: { author: 'Ada North' } }, overlapping, uploader), 1);
});

test('a letterhead From is used when meta.author is empty', () => {
  assert.equal(authorNameFromContent({ originalBody: fromBody }), 'Ada North');
  assert.equal(resolveAuthorIdFromUsers({ originalBody: fromBody }, users, uploader), 1);
});

test('a value already in meta.author wins over the letterhead From', () => {
  const content = { meta: { author: 'Ben South' }, originalBody: fromBody };
  assert.equal(authorNameFromContent(content), 'Ben South');
  assert.equal(resolveAuthorIdFromUsers(content, users, uploader), 2);
  const unmatched = { meta: { author: 'Zoe West' }, originalBody: fromBody };
  assert.equal(resolveAuthorIdFromUsers(unmatched, users, uploader), uploader);
});

test('a name-like Fax slot can credit a unique user when From is missing', () => {
  const withPat = [...users, { id: 4, name: 'Pat Lee' }];
  assert.equal(authorNameFromContent({ originalBody: faxNameBody }), 'Pat Lee');
  assert.equal(resolveAuthorIdFromUsers({ originalBody: faxNameBody }, withPat, uploader), 4);
});

test('a fax number is not used as the author', () => {
  assert.equal(authorNameFromContent({ originalBody: faxNumberBody }), '');
  assert.equal(resolveAuthorIdFromUsers({ originalBody: faxNumberBody }, users, uploader), uploader);
});
