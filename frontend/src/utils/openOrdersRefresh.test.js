import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createOpenOrdersRefresh, OPEN_ORDERS_EPOCH_KEY } from './openOrdersRefresh.js'

function emitter() {
  const map = new Map()
  return {
    addEventListener(type, fn) {
      let set = map.get(type)
      if (!set) { set = new Set(); map.set(type, set) }
      set.add(fn)
    },
    removeEventListener(type, fn) { map.get(type)?.delete(fn) },
    emit(type, event) { for (const fn of [...(map.get(type) || [])]) fn(event) },
    count(type) { return map.get(type)?.size || 0 },
  }
}

function fakeEnv() {
  const store = new Map()
  const window = emitter()
  const document = emitter()
  document.visibilityState = 'visible'
  return {
    window,
    document,
    storage: {
      setItem(k, v) { store.set(k, String(v)) },
      getItem(k) { return store.has(k) ? store.get(k) : null },
    },
  }
}

test('mark closed notifies this tab and records an epoch for other tabs', () => {
  const hub = createOpenOrdersRefresh()
  const env = fakeEnv()
  const reasons = []
  const stop = hub.watch((reason) => reasons.push(reason), env)

  hub.invalidate(env)
  assert.deepEqual(reasons, ['invalidate'])
  assert.match(env.storage.getItem(OPEN_ORDERS_EPOCH_KEY), /^\d+-\d+$/)

  const first = env.storage.getItem(OPEN_ORDERS_EPOCH_KEY)
  hub.invalidate(env)
  assert.notEqual(env.storage.getItem(OPEN_ORDERS_EPOCH_KEY), first)
  assert.deepEqual(reasons, ['invalidate', 'invalidate'])
  stop()
})

test('a list left open in another tab refetches from the storage epoch', () => {
  const hub = createOpenOrdersRefresh()
  const env = fakeEnv()
  const reasons = []
  const stop = hub.watch((reason) => reasons.push(reason), env)

  env.window.emit('storage', { key: 'contractUnlock' })
  assert.deepEqual(reasons, [])
  env.window.emit('storage', { key: OPEN_ORDERS_EPOCH_KEY, newValue: '1-1' })
  assert.deepEqual(reasons, ['storage'])
  stop()
})

test('showing the yellow list again refetches; a hidden tab does not', () => {
  const hub = createOpenOrdersRefresh()
  const env = fakeEnv()
  const reasons = []
  const stop = hub.watch((reason) => reasons.push(reason), env)

  env.window.emit('focus')
  env.window.emit('pageshow')
  env.document.visibilityState = 'hidden'
  env.document.emit('visibilitychange')
  env.document.visibilityState = 'visible'
  env.document.emit('visibilitychange')

  assert.deepEqual(reasons, ['focus', 'pageshow', 'visible'])
  stop()
  env.window.emit('focus')
  env.document.emit('visibilitychange')
  assert.deepEqual(reasons, ['focus', 'pageshow', 'visible'])
  assert.equal(env.window.count('focus'), 0)
  assert.equal(env.document.count('visibilitychange'), 0)
})

test('unwatching one list leaves the other one listening', () => {
  const hub = createOpenOrdersRefresh()
  const env = fakeEnv()
  const a = []
  const b = []
  const stopA = hub.watch((reason) => a.push(reason), env)
  const stopB = hub.watch((reason) => b.push(reason), env)
  stopA()
  hub.invalidate(env)
  assert.deepEqual(a, [])
  assert.deepEqual(b, ['invalidate'])
  stopB()
})

test('Mark closed / Reopen invalidates, and the yellow list watches that signal', () => {
  const contracts = readFileSync(new URL('../components/ContractsPage.jsx', import.meta.url), 'utf8')
  const toggle = contracts.slice(
    contracts.indexOf('async function toggleClosed'),
    contracts.indexOf('async function doDelete'),
  )
  assert.match(toggle, /invalidateOpenOrders\(\)/)
  assert.ok(toggle.indexOf('contractsAPI.patch') < toggle.indexOf('invalidateOpenOrders()'))

  const follow = readFileSync(new URL('../components/ProjectFollowUps.jsx', import.meta.url), 'utf8')
  const yellow = follow.slice(follow.indexOf('function OpenOrders'), follow.indexOf('function ContractPicker'))
  assert.match(yellow, /watchOpenOrdersRefresh/)
  assert.match(yellow, /followUpsAPI\.openOrders\(token\)/)
  assert.match(yellow, /reason === 'invalidate' \|\| reason === 'storage'/)
})
