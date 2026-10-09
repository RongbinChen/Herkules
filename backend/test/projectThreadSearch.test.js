import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingAnnouncementIds, filterThreadsByAnnouncementMatches } from '../src/services/projectThreadSearch.js';

test('正文或摘要可命中关键词，同时保留原有元数据搜索', async () => {
  let received;
  const db = { bidProject: { findMany: async (args) => { received = args; return [{ id: 2859 }]; } } };
  const ids = await findMatchingAnnouncementIds(db, '  HUARUI  ');
  assert.deepEqual(ids, new Set([2859]));
  const fields = received.where.OR.map((clause) => Object.keys(clause)[0]);
  for (const field of ['rawContent', 'summary', 'projectName', 'projectCode', 'purchaser', 'winner', 'threadKey', 'equipmentType']) assert.ok(fields.includes(field));
  assert.deepEqual(received.where.OR.find((item) => item.rawContent), { rawContent: { contains: 'HUARUI', mode: 'insensitive' } });
  assert.deepEqual(received.select, { id: true });
});

test('命中早期公告时保留全部公告和最新阶段，不按命中公告重新计算', () => {
  const thread = { projectName: 'Latest award', currentStage: 'AWARD', announcements: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const result = filterThreadsByAnnouncementMatches([thread, { announcements: [{ id: 4 }] }], new Set([1]));
  assert.deepEqual(result, [thread]);
  assert.equal(result[0].announcements.length, 3);
  assert.equal(result[0].currentStage, 'AWARD');
  assert.equal(result[0], thread);
});

test('没有命中时返回空结果；空白关键词不发全文查询且保留所有项目', async () => {
  const db = { bidProject: { findMany: async () => assert.fail('blank query should not scan notice text') } };
  for (const q of [null, undefined, '', '   ']) assert.equal(await findMatchingAnnouncementIds(db, q), null);
  const threads = [{ announcements: [{ id: 1 }] }];
  assert.deepEqual(filterThreadsByAnnouncementMatches(threads, new Set()), []);
  assert.equal(filterThreadsByAnnouncementMatches(threads, null), threads);
});
