// Shared back-navigation for in-app deep links that start on Ask AI (/search).
// Detail pages should not always return to their own module list: when the
// user arrived from Ask AI, Back goes to /search (and the same thread when
// we know it). Links are stamped with ?from=search (and ?thread=) plus
// location state; a short navigation log covers unstamped same-tab clicks.

export const ASK_AI_FROM = 'search'
export const ASK_AI_PATH = '/search'

let currentAppPath = null
let previousAppPath = null

export function recordNavigation(pathname, search = '') {
  const next = `${pathname || ''}${search || ''}`
  if (currentAppPath && currentAppPath !== next) previousAppPath = currentAppPath
  currentAppPath = next
}

export function getPreviousAppPath() {
  return previousAppPath
}

// Test helper — not used in the app.
export function resetNavigationLog() {
  currentAppPath = null
  previousAppPath = null
}

export function isAskAiPath(path) {
  if (!path) return false
  const pathname = String(path).split('?')[0].split('#')[0]
  return pathname === ASK_AI_PATH
}

export function askAiHref(threadId) {
  if (threadId == null || threadId === '') return ASK_AI_PATH
  return `${ASK_AI_PATH}?thread=${encodeURIComponent(String(threadId))}`
}

export function askAiBackLabel(lang) {
  return lang === 'zh' ? '← 搜索' : '← Ask AI'
}

function searchParamsOf(search) {
  if (search && typeof search.get === 'function') return search
  const raw = typeof search === 'string' ? search.replace(/^\?/, '') : ''
  return new URLSearchParams(raw)
}

export function readBackSource(search, state) {
  const params = searchParamsOf(search)
  const fromParam = params.get('from')
  const threadParam = params.get('thread')
  let fromState = null
  if (state?.from === ASK_AI_FROM || state?.from === 'ask-ai' || state?.from === ASK_AI_PATH) {
    fromState = ASK_AI_FROM
  } else if (typeof state?.from === 'string' && state.from) {
    fromState = state.from
  }
  const from = fromParam || fromState
  const threadId = threadParam || state?.threadId || state?.thread || null
  return { from, threadId }
}

function isSearchSource(from) {
  return from === ASK_AI_FROM || from === 'ask-ai' || from === ASK_AI_PATH
}

// Append from=search (and thread when known) without clobbering existing
// query strings or #remind- / other hashes. Leaves /search alone.
export function withFromSearch(href, { threadId } = {}) {
  if (typeof href !== 'string' || !href.startsWith('/')) return href
  if (isAskAiPath(href)) return href
  const hashIdx = href.indexOf('#')
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : ''
  const pathAndQuery = hashIdx >= 0 ? href.slice(0, hashIdx) : href
  const qIdx = pathAndQuery.indexOf('?')
  const path = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery
  const params = new URLSearchParams(qIdx >= 0 ? pathAndQuery.slice(qIdx + 1) : '')
  if (!params.get('from')) params.set('from', ASK_AI_FROM)
  if (threadId != null && threadId !== '' && !params.get('thread')) {
    params.set('thread', String(threadId))
  }
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash}`
}

export function linkStateForSearch(threadId) {
  return { from: ASK_AI_FROM, ...(threadId != null && threadId !== '' ? { threadId } : {}) }
}

export function resolveBackTarget({
  search = '',
  state = null,
  fallbackPath,
  fallbackLabel,
  lang,
  previousPath,
  historyLength,
} = {}) {
  const { from, threadId } = readBackSource(search, state)
  if (isSearchSource(from)) {
    return {
      to: askAiHref(threadId),
      label: askAiBackLabel(lang),
      source: ASK_AI_FROM,
      useHistoryBack: false,
    }
  }
  // Unstamped same-tab navigation: the previous history entry is Ask AI, and
  // no other explicit from= (map, tracking, …) is present. Prefer history.back
  // when it stays inside the app; otherwise go to /search directly.
  const prev = previousPath === undefined ? getPreviousAppPath() : previousPath
  if (!from && isAskAiPath(prev)) {
    const canPop = historyLength == null ? true : Number(historyLength) > 1
    return {
      to: askAiHref(threadId),
      label: askAiBackLabel(lang),
      source: ASK_AI_FROM,
      useHistoryBack: canPop,
    }
  }
  return {
    to: fallbackPath,
    label: fallbackLabel,
    source: from || 'list',
    useHistoryBack: false,
  }
}

// navigate is React Router's navigate(). If history.back would leave the app
// (new tab, or only one history entry), fall back to the resolved `to`.
export function performBack(navigate, target, historyLength) {
  if (!target) return
  const length = historyLength == null
    ? (typeof window !== 'undefined' ? window.history.length : 0)
    : historyLength
  if (target.useHistoryBack && length > 1) {
    navigate(-1)
    return
  }
  if (target.to) navigate(target.to)
}
