import test from 'node:test'
import assert from 'node:assert/strict'
import {
  withFromSearch,
  readBackSource,
  resolveBackTarget,
  performBack,
  askAiHref,
  askAiBackLabel,
  isAskAiPath,
  linkStateForSearch,
  recordNavigation,
  getPreviousAppPath,
  resetNavigationLog,
} from './appBack.js'

test('withFromSearch stamps from=search and keeps query + hash', () => {
  assert.equal(withFromSearch('/visit-reports/54'), '/visit-reports/54?from=search')
  assert.equal(
    withFromSearch('/visit-reports/54#remind-abc'),
    '/visit-reports/54?from=search#remind-abc',
  )
  assert.equal(
    withFromSearch('/visit-reports/54?remindDate=2026-11-12#remind-abc', { threadId: 8 }),
    '/visit-reports/54?remindDate=2026-11-12&from=search&thread=8#remind-abc',
  )
  assert.equal(withFromSearch('/hotprojects?id=3'), '/hotprojects?id=3&from=search')
  assert.equal(withFromSearch('/calendar?event=504'), '/calendar?event=504&from=search')
  assert.equal(withFromSearch('/chinabidding/bidopen?id=9'), '/chinabidding/bidopen?id=9&from=search')
  assert.equal(
    withFromSearch('/chinabidding/tracking?q=TK-1'),
    '/chinabidding/tracking?q=TK-1&from=search',
  )
  assert.equal(withFromSearch('/contracts?customerId=12'), '/contracts?customerId=12&from=search')
  assert.equal(withFromSearch('/customers/12'), '/customers/12?from=search')
  assert.equal(withFromSearch('/followups/4'), '/followups/4?from=search')
  assert.equal(withFromSearch('/trips/7'), '/trips/7?from=search')
  assert.equal(withFromSearch('/search'), '/search')
  assert.equal(withFromSearch('/search?thread=8'), '/search?thread=8')
  assert.equal(withFromSearch('https://example.com/x'), 'https://example.com/x')
  // Do not overwrite an existing from=
  assert.equal(withFromSearch('/customers/12?from=map'), '/customers/12?from=map')
})

test('readBackSource prefers the query param and keeps thread from state', () => {
  assert.deepEqual(readBackSource('?from=search&thread=8', null), { from: 'search', threadId: '8' })
  assert.deepEqual(
    readBackSource('', { from: 'search', threadId: 3 }),
    { from: 'search', threadId: 3 },
  )
  assert.equal(readBackSource('?from=map', { from: 'search' }).from, 'map')
  assert.equal(readBackSource('', { from: '/search' }).from, 'search')
})

test('resolveBackTarget returns Ask AI with a locale-aware label', () => {
  const en = resolveBackTarget({
    search: '?from=search&thread=8',
    fallbackPath: '/visit-reports',
    fallbackLabel: '← Visit Reports',
    lang: 'en',
  })
  assert.deepEqual(en, {
    to: '/search?thread=8',
    label: '← Ask AI',
    source: 'search',
    useHistoryBack: false,
  })
  const zh = resolveBackTarget({
    search: '?from=search',
    fallbackPath: '/visit-reports',
    fallbackLabel: '← 拜访报告',
    lang: 'zh',
  })
  assert.equal(zh.to, '/search')
  assert.equal(zh.label, '← 搜索')
  assert.equal(zh.source, 'search')
})

test('resolveBackTarget falls back to the module list when there is no Ask AI origin', () => {
  const back = resolveBackTarget({
    search: '',
    state: null,
    fallbackPath: '/visit-reports',
    fallbackLabel: '← Visit Reports',
    lang: 'en',
    previousPath: '/dashboard',
  })
  assert.deepEqual(back, {
    to: '/visit-reports',
    label: '← Visit Reports',
    source: 'list',
    useHistoryBack: false,
  })
})

test('unstamped arrival from /search uses history.back when it stays in the app', () => {
  const pop = resolveBackTarget({
    search: '',
    fallbackPath: '/visit-reports',
    fallbackLabel: '← Visit Reports',
    lang: 'en',
    previousPath: '/search?thread=8',
    historyLength: 3,
  })
  assert.equal(pop.source, 'search')
  assert.equal(pop.to, '/search')
  assert.equal(pop.useHistoryBack, true)
  assert.equal(pop.label, '← Ask AI')

  const newTab = resolveBackTarget({
    search: '',
    fallbackPath: '/visit-reports',
    fallbackLabel: '← Visit Reports',
    lang: 'en',
    previousPath: '/search',
    historyLength: 1,
  })
  assert.equal(newTab.source, 'search')
  assert.equal(newTab.useHistoryBack, false)
  assert.equal(newTab.to, '/search')
})

test('performBack uses history.back only when it is safe, otherwise the fallback path', () => {
  const calls = []
  const navigate = (to) => calls.push(to)
  performBack(navigate, { useHistoryBack: true, to: '/search' }, 4)
  assert.deepEqual(calls, [-1])
  calls.length = 0
  performBack(navigate, { useHistoryBack: true, to: '/search' }, 1)
  assert.deepEqual(calls, ['/search'])
  calls.length = 0
  performBack(navigate, { useHistoryBack: false, to: '/visit-reports' }, 4)
  assert.deepEqual(calls, ['/visit-reports'])
})

test('askAi helpers and the navigation log', () => {
  assert.equal(askAiHref(), '/search')
  assert.equal(askAiHref(8), '/search?thread=8')
  assert.equal(askAiBackLabel('zh'), '← 搜索')
  assert.equal(askAiBackLabel('en'), '← Ask AI')
  assert.equal(isAskAiPath('/search?thread=8'), true)
  assert.equal(isAskAiPath('/visit-reports/54'), false)
  assert.deepEqual(linkStateForSearch(8), { from: 'search', threadId: 8 })
  resetNavigationLog()
  recordNavigation('/search', '')
  recordNavigation('/visit-reports/54', '?from=search')
  assert.equal(getPreviousAppPath(), '/search')
  resetNavigationLog()
})
