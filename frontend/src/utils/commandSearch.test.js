import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInput, projectTrackingHref, resultHref, examplesForLang, COMMANDS } from './commandSearch.js'

test('slash /project results deep-link to the tracking board with q=threadKey', () => {
  assert.equal(
    projectTrackingHref('0747-2640 SCC'),
    '/chinabidding/tracking?q=0747-2640%20SCC',
  )
  assert.equal(
    resultHref('project', { threadKey: 'TK-1', href: '/chinabidding/tracking?q=TK-1' }),
    '/chinabidding/tracking?q=TK-1&from=search',
  )
  // Even without a server href, the client still builds the tracking query.
  assert.equal(resultHref('project', { threadKey: 'TK-2' }), '/chinabidding/tracking?q=TK-2&from=search')
  assert.notEqual(resultHref('project', { threadKey: 'TK-2' }), '/chinabidding/tracking')
})

test('parseInput recognises the extended slash commands', () => {
  assert.deepEqual(parseInput('/project rotor'), { mode: 'search', type: 'project', query: 'rotor' })
  assert.equal(parseInput('/followup COSCO').type, 'followup')
  assert.equal(parseInput('/trip dalian').type, 'trip')
  assert.equal(parseInput('/hot milling').type, 'hot')
  assert.equal(parseInput('/').mode, 'palette')
  assert.ok(COMMANDS.some((c) => c.key === 'followup'))
})

test('welcome examples follow Auto / 中文 / EN', () => {
  const zh = examplesForLang('zh')
  assert.ok(zh.every((s) => /[\u4e00-\u9fff]/.test(s)))
  const en = examplesForLang('en')
  assert.ok(en.every((s) => !/[\u4e00-\u9fff]/.test(s)))
  const auto = examplesForLang('auto')
  assert.ok(auto.some((s) => /[\u4e00-\u9fff]/.test(s)))
  assert.ok(auto.some((s) => !/[\u4e00-\u9fff]/.test(s)))
})

test('slash-command result hrefs carry from=search so Back can return to Ask AI', () => {
  assert.equal(resultHref('customer', { id: 12 }), '/customers/12?from=search')
  assert.equal(resultHref('report', { id: 54 }, { threadId: 8 }), '/visit-reports/54?from=search&thread=8')
  assert.equal(resultHref('followup', { id: 4 }), '/followups/4?from=search')
  assert.equal(resultHref('trip', { id: 7 }), '/trips/7?from=search')
  assert.equal(resultHref('hot', { id: 3 }), '/hotprojects?id=3&from=search')
})
