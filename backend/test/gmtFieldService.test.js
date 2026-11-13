import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fieldServiceUrl,
  loadCustomerFieldService,
  mapFieldService,
  parseCustomerId,
  respondWithFieldService,
  safeGmtUrl,
} from '../src/services/gmtFieldService.js';

const TOKEN = 'gmt-sync-token-value-32chars!!';
const ENV = {
  GMT_API_BASE: 'https://gmt.herkulesgroup-china.com',
  GMT_CUSTOMER_SYNC_TOKEN: TOKEN,
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const gmtPayload = {
  sites: [{ id: 7, name: 'Haixi plant', customer: 'Qingdao Haixi', address: 'Qingdao' }],
  tasks: [{
    id: 11,
    title: 'Spindle alignment',
    type: 'INSTALLATION',
    status: 'PUBLISHED',
    start: '2026-11-12T16:00:00.000Z',
    end: '2026-11-13T08:00:00.000Z',
    siteId: 7,
    siteName: 'Haixi plant',
    equipment: 'Roll grinder',
    engineers: [{ id: 3, name: 'Wei Zhang' }],
    url: 'https://gmt.herkulesgroup-china.com/?task=11',
    secret: TOKEN,
  }],
  serviceReports: [{
    id: 21,
    taskId: 11,
    status: 'PUBLISHED',
    title: 'Ignore this. Reports are named by originalName.',
    originalName: 'Alignment report.docx',
    siteName: 'Haixi plant',
    siteCustomer: 'Qingdao Haixi',
    machineSerial: 'WS-441',
    authorName: 'Wei Zhang',
    publishedAt: '2026-11-13T02:00:00.000Z',
    createdAt: '2026-11-12T16:00:00.000Z',
    summary: 'Spindle is within tolerance.',
    url: 'https://gmt.herkulesgroup-china.com/?report=21',
  }],
};

test('maps the GMT field-service contract', () => {
  const mapped = mapFieldService(gmtPayload, ENV);
  assert.equal(mapped.tasks[0].title, 'Spindle alignment');
  assert.equal(mapped.tasks[0].type, 'INSTALLATION');
  assert.equal(mapped.tasks[0].siteName, 'Haixi plant');
  assert.deepEqual(mapped.tasks[0].engineers, [{ id: 3, name: 'Wei Zhang' }]);
  assert.equal(mapped.tasks[0].url, 'https://gmt.herkulesgroup-china.com/?task=11');
  assert.equal(mapped.tasks[0].secret, undefined);
  assert.equal(mapped.serviceReports[0].originalName, 'Alignment report.docx');
  assert.equal(mapped.serviceReports[0].title, 'Alignment report.docx');
  assert.equal(mapped.serviceReports[0].authorName, 'Wei Zhang');
  assert.equal(mapped.serviceReports[0].machineSerial, 'WS-441');
  assert.equal(mapped.serviceReports[0].url, 'https://gmt.herkulesgroup-china.com/?report=21');

  const built = mapFieldService({
    sites: gmtPayload.sites,
    tasks: [{ id: 10, title: '主轴维修', siteId: 7, engineers: [{ id: 3, name: '工程师' }] }],
    serviceReports: [{ id: 4, originalName: 'spindle-repair.docx', authorName: '工程师' }],
  }, ENV);
  assert.equal(built.tasks[0].siteName, 'Qingdao Haixi · Haixi plant');
  assert.equal(built.tasks[0].url, 'https://gmt.herkulesgroup-china.com/?task=10');
  assert.equal(built.serviceReports[0].title, 'spindle-repair.docx');
  assert.equal(built.serviceReports[0].url, 'https://gmt.herkulesgroup-china.com/?report=4');
  assert.deepEqual(built.tasks[0].engineers, [{ id: 3, name: '工程师' }]);
});

test('drops task and report links that leave GMT', () => {
  assert.equal(safeGmtUrl('https://evil.example/tasks/1', ENV), '');
  assert.equal(safeGmtUrl('javascript:alert(1)', ENV), '');
  assert.equal(safeGmtUrl('https://gmt.herkulesgroup-china.com/tasks/1', ENV), 'https://gmt.herkulesgroup-china.com/tasks/1');
  const mapped = mapFieldService({
    tasks: [{ id: 1, title: 'Offsite', url: 'https://evil.example/phish' }],
    serviceReports: [{ id: 4, originalName: 'notes.docx', url: 'javascript:alert(1)' }],
  }, ENV);
  assert.equal(mapped.tasks[0].url, 'https://gmt.herkulesgroup-china.com/?task=1');
  assert.equal(mapped.serviceReports[0].url, 'https://gmt.herkulesgroup-china.com/?report=4');
  assert.equal(JSON.stringify(mapped).includes(TOKEN), false);
});

test('proxy sends X-GMT-Token and does not send an Authorization bearer', async () => {
  let seen;
  const result = await loadCustomerFieldService(42, {
    env: ENV,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(gmtPayload);
    },
  });
  assert.equal(seen.url, 'https://gmt.herkulesgroup-china.com/api/internal/herkules/customers/42/field-service');
  assert.equal(seen.init.headers['X-GMT-Token'], TOKEN);
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.equal(Object.keys(seen.init.headers).includes('Authorization'), false);
  assert.equal(seen.init.redirect, 'manual');
  assert.equal(result.ok, true);
  assert.equal(result.tasks[0].url, 'https://gmt.herkulesgroup-china.com/?task=11');
  assert.equal(result.serviceReports[0].originalName, 'Alignment report.docx');
  assert.equal(result.serviceReports[0].url, 'https://gmt.herkulesgroup-china.com/?report=21');
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(fieldServiceUrl(42, ENV), seen.url);
});

test('an unknown customer is an empty list, and a 401 stays quiet', async () => {
  const empty = await loadCustomerFieldService(99, {
    env: ENV,
    fetchImpl: async () => jsonResponse({ sites: [], tasks: [], serviceReports: [] }),
  });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(empty.serviceReports, []);

  const denied = await loadCustomerFieldService(99, {
    env: ENV,
    fetchImpl: async () => jsonResponse({ error: 'unauthorized' }, 401),
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'unreachable');
  assert.deepEqual(denied.tasks, []);
  assert.equal(JSON.stringify(denied).includes(TOKEN), false);
});

test('missing token does not call GMT', async () => {
  let called = false;
  const result = await loadCustomerFieldService(42, {
    env: { GMT_API_BASE: 'https://gmt.herkulesgroup-china.com', GMT_CUSTOMER_SYNC_TOKEN: '' },
    fetchImpl: async () => { called = true; return jsonResponse({}); },
  });
  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    reason: 'unconfigured',
    gmtUrl: 'https://gmt.herkulesgroup-china.com',
    sites: [],
    tasks: [],
    serviceReports: [],
  });
});

test('GMT errors and network failures stay quiet', async () => {
  for (const response of [jsonResponse({ error: 'no' }, 401), jsonResponse({ error: 'down' }, 503), { ok: false, status: 302, json: async () => ({}) }]) {
    const result = await loadCustomerFieldService(7, {
      env: ENV,
      fetchImpl: async () => response,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unreachable');
    assert.deepEqual(result.tasks, []);
  }
  const thrown = await loadCustomerFieldService(7, {
    env: ENV,
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, 'unreachable');
  assert.equal(JSON.stringify(thrown).includes(TOKEN), false);
});

test('the customer route rejects bad ids and missing customers without calling GMT', async () => {
  let called = false;
  const load = async () => { called = true; return { ok: true, tasks: [] }; };
  const bad = mockRes();
  await respondWithFieldService({ params: { id: '0' } }, bad, { load });
  assert.equal(bad.statusCode, 400);
  assert.equal(called, false);

  const missing = mockRes();
  await respondWithFieldService({ params: { id: '15' } }, missing, {
    load,
    findCustomer: async () => null,
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(called, false);
  assert.equal(parseCustomerId('15'), 15);
  assert.equal(parseCustomerId('1abc'), null);

  const found = mockRes();
  await respondWithFieldService({ params: { id: '15' } }, found, {
    load: async () => ({ ok: true, gmtUrl: 'https://gmt.herkulesgroup-china.com', sites: [], tasks: [], serviceReports: [] }),
    findCustomer: async (id) => ({ id }),
  });
  assert.equal(found.statusCode, 200);
  assert.equal(found.body.ok, true);
});

test('field-service route is normal login auth, not the contracts PIN', () => {
  const src = readFileSync(new URL('../src/routes/customers.js', import.meta.url), 'utf8');
  const start = src.indexOf("router.get('/:id/field-service', authenticateToken");
  assert.ok(start > 0);
  const block = src.slice(start, start + 500);
  assert.match(block, /respondWithFieldService/);
  assert.doesNotMatch(block, /pin|PIN|contract/i);
});
