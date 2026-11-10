import test from 'node:test';
import assert from 'node:assert/strict';
import { lastPublishedAt, compareThreadsByLastPublished } from '../src/services/projectThreadOrder.js';

// The four Lifecycle cards Henner circled. Dates are the notice lines
// (DD/MM/YY), not the grey "Updated" scrape timestamps.
const generatorRotor = {
  threadKey: '0747-2640SCCSC259',
  lastUpdate: '2026-09-30T02:00:00.000Z',
  tracking: { updatedAt: '2026-09-30T08:00:00.000Z' },
  announcements: [
    { id: 1, round: 1, publishDate: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', infoClass: 'New Tenders' },
    { id: 2, round: 1, publishDate: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', infoClass: 'Evaluation Results' },
    { id: 3, round: 1, publishDate: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-30T02:00:00.000Z', infoClass: 'Tender Awards' },
  ],
};

const icbCentralized = {
  threadKey: '0701-224001050121',
  lastUpdate: '2026-08-24T00:00:00.000Z',
  tracking: { updatedAt: '2026-11-01T00:00:00.000Z' },
  announcements: [
    { id: 10, round: 1, publishDate: '2022-12-01T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'Tender Awards' },
    { id: 11, round: 1, publishDate: '2022-12-01T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'Tender Awards' },
  ],
};

const shanghaiElectric = {
  threadKey: '0613-264025122903',
  lastUpdate: '2026-08-24T00:00:00.000Z',
  announcements: [
    { id: 20, round: 1, publishDate: '2026-06-03T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'New Tenders' },
    { id: 21, round: 1, publishDate: '2026-06-11T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'New Tenders' },
    { id: 22, round: 1, publishDate: '2026-07-14T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'Evaluation Results' },
    { id: 23, round: 1, publishDate: '2026-07-20T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', infoClass: 'Tender Awards' },
  ],
};

const noNoticeDate = {
  threadKey: 'no-publish-date',
  lastUpdate: '2026-11-10T00:00:00.000Z',
  announcements: [
    { id: 99, round: 3, publishDate: null, updatedAt: '2026-11-10T00:00:00.000Z', infoClass: 'New Tenders' },
  ],
};

test('the card date is the latest notice publication, not the scrape time', () => {
  assert.equal(lastPublishedAt(generatorRotor.announcements), '2026-09-29T00:00:00.000Z');
  assert.equal(lastPublishedAt(icbCentralized.announcements), '2022-12-01T00:00:00.000Z');
  assert.equal(lastPublishedAt(shanghaiElectric.announcements), '2026-07-20T00:00:00.000Z');
  assert.equal(lastPublishedAt(noNoticeDate.announcements), null);
  assert.equal(lastPublishedAt([]), null);
  assert.equal(lastPublishedAt(null), null);
});

test('a later scrape or an edited tracking record does not outrank an older notice', () => {
  // The 2022 award was re-saved on 24/08/26 and its tracking row was touched
  // even later. It still dates — and sorts — as 1 December 2022.
  const ordered = [icbCentralized, shanghaiElectric, noNoticeDate, generatorRotor]
    .slice()
    .sort(compareThreadsByLastPublished)
    .map((t) => t.threadKey);
  assert.deepEqual(ordered, [
    '0747-2640SCCSC259',
    '0613-264025122903',
    '0701-224001050121',
    'no-publish-date',
  ]);
});

test('an undated notice does not hide an earlier real publication date', () => {
  const announcements = [
    { id: 1, round: 1, publishDate: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
    { id: 2, round: 4, publishDate: null, updatedAt: '2026-08-24T00:00:00.000Z' },
  ];
  assert.equal(lastPublishedAt(announcements), '2026-07-20T00:00:00.000Z');
});

test('a re-tender published after the award becomes the project date', () => {
  const announcements = [
    { id: 1, round: 1, publishDate: '2026-07-20T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 2, round: 2, publishDate: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
  ];
  assert.equal(lastPublishedAt(announcements), '2026-08-01T00:00:00.000Z');
});

test('same publication day breaks ties by tender round, then announcement id', () => {
  const day = '2026-07-20T00:00:00.000Z';
  const threads = [
    { threadKey: 'low-round', announcements: [{ id: 50, round: 1, publishDate: day }] },
    { threadKey: 'high-id', announcements: [{ id: 40, round: 2, publishDate: day }] },
    { threadKey: 'high-round', announcements: [{ id: 30, round: 3, publishDate: day }] },
  ];
  assert.deepEqual(
    threads.slice().sort(compareThreadsByLastPublished).map((t) => t.threadKey),
    ['high-round', 'high-id', 'low-round'],
  );
});

test('unparsable publication dates are treated as missing', () => {
  assert.equal(lastPublishedAt([{ id: 1, publishDate: 'not-a-date', updatedAt: '2026-08-24T00:00:00.000Z' }]), null);
});
