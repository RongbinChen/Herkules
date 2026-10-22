import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { briefBodySchema } from '../src/services/tripBriefSchema.js';

const context = {
  startTime: '2026-09-14T01:00:00.000Z',
  endTime: '2026-09-16T10:00:00.000Z',
  flights: [{ date: '14 Sep', flightNo: 'CA4501', routing: 'PVG → XIY', depart: '06:55', arrive: '11:00' }],
  constraints: null,
  stops: [{
    customer: { name: '西安客户', address: '西安市', latitude: 34.26, longitude: 108.94 },
    priority: 'NORMAL',
    visitDuration: null,
    notes: null,
  }],
};

test('接受向导发出的 brief + context，并去掉首尾空白', () => {
  const parsed = briefBodySchema.parse({
    brief: '  第一天拜访西安的客户  ',
    context,
  });
  assert.equal(parsed.brief, '第一天拜访西安的客户');
  assert.equal(parsed.context.stops[0].customer.name, '西安客户');
  assert.equal(parsed.context.flights[0].arrive, '11:00');
  assert.equal(parsed.context.constraints, null);
});

test('空说明、超长说明、缺 context 都拒绝', () => {
  assert.equal(briefBodySchema.safeParse({ brief: '   ', context }).success, false);
  assert.equal(briefBodySchema.safeParse({ brief: '', context }).success, false);
  assert.equal(briefBodySchema.safeParse({ brief: '有内容' }).success, false);
  assert.equal(briefBodySchema.safeParse({ brief: 'x'.repeat(16001), context }).success, false);
});

test('没带 stops 时按空数组处理，旧的 time 字段仍可过', () => {
  const parsed = briefBodySchema.parse({
    brief: '没有客户也先读这段',
    context: { startTime: context.startTime, endTime: context.endTime, flights: [{ time: '11:00' }] },
  });
  assert.deepEqual(parsed.context.stops, []);
  assert.equal(parsed.context.flights[0].time, '11:00');
});

test('plan-brief 路由用的是这个 schema，而不是未定义的名字', () => {
  const src = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ briefBodySchema, flightSchema \} from '\.\.\/services\/tripBriefSchema\.js'/);
  assert.match(src, /briefBodySchema\.parse\(req\.body\)/);
  assert.doesNotMatch(src, /const chatContextSchema/);
});
