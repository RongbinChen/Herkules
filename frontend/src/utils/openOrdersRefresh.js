// The yellow "Contracts without a follow-up" list is a fetch of
// /followups/open-orders. Mark closed / Reopen writes ContractFile.closedAt and
// does not change the unlock token, so a list that is already on screen keeps
// the response it loaded at unlock until something tells it to fetch again.
//
// Same tab: invalidateOpenOrders() calls the listeners directly (writing
// localStorage does not fire a storage event in the document that wrote it).
// Another tab: that write does fire storage there, and the open list refetches
// with its own unlock token. The value is only a counter.

export const OPEN_ORDERS_EPOCH_KEY = 'openOrdersEpoch'

function defaultEnv() {
  let storage = null
  try { storage = globalThis.localStorage } catch { storage = null }
  return {
    window: globalThis.window,
    document: globalThis.document,
    storage,
  }
}

export function createOpenOrdersRefresh() {
  const listeners = new Set()
  let seq = 0

  function invalidate(env = defaultEnv()) {
    seq += 1
    try { env.storage?.setItem(OPEN_ORDERS_EPOCH_KEY, `${Date.now()}-${seq}`) } catch { /* private mode */ }
    for (const fn of [...listeners]) fn('invalidate')
  }

  function watch(reload, env = defaultEnv()) {
    const onRefresh = (reason) => reload(reason)
    listeners.add(onRefresh)
    const onStorage = (e) => {
      if (e?.key === OPEN_ORDERS_EPOCH_KEY) reload('storage')
    }
    const onFocus = () => reload('focus')
    const onPageShow = () => reload('pageshow')
    const onVisible = () => {
      if (env.document?.visibilityState === 'visible') reload('visible')
    }
    env.window?.addEventListener('storage', onStorage)
    env.window?.addEventListener('focus', onFocus)
    env.window?.addEventListener('pageshow', onPageShow)
    env.document?.addEventListener('visibilitychange', onVisible)
    return () => {
      listeners.delete(onRefresh)
      env.window?.removeEventListener('storage', onStorage)
      env.window?.removeEventListener('focus', onFocus)
      env.window?.removeEventListener('pageshow', onPageShow)
      env.document?.removeEventListener('visibilitychange', onVisible)
    }
  }

  return { invalidate, watch }
}

const shared = createOpenOrdersRefresh()

export function invalidateOpenOrders() {
  shared.invalidate()
}

export function watchOpenOrdersRefresh(reload) {
  return shared.watch(reload)
}
