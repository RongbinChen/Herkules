// 7-day in-page banner on the dashboard announcing the Ask AI upgrade.
// Dates are America/New_York. Bump ASK_AI_UPGRADE_BANNER_START / _END if
// merge is delayed past the start (or if the window should be extended).
//
// Window: 2026-11-24 00:00 through 2026-12-01 00:00 (exclusive) in EST (UTC-5).
// After the end, the banner never shows, even if the user never saw it.
// Dismissal is stored in localStorage per user id so two accounts on the
// same browser do not share it. No schema or server preference is required.

export const ASK_AI_UPGRADE_BANNER_START = '2026-11-24T00:00:00-05:00'
export const ASK_AI_UPGRADE_BANNER_END = '2026-12-01T00:00:00-05:00'
export const ASK_AI_UPGRADE_BANNER_TIME_ZONE = 'America/New_York'

const STORAGE_PREFIX = 'herkules:askAiUpgradeBanner:dismissed:'

export const ASK_AI_UPGRADE_BANNER_COPY = {
  en: {
    title: 'Ask AI has been upgraded',
    body: 'Ask about visit reports, follow-ups, and calendar events. Answers now include links you can open directly.',
    cta: 'Try Ask AI',
    dismiss: 'Dismiss',
  },
  zh: {
    title: 'Ask AI 已升级',
    body: '可以询问拜访报告、项目跟进和日历活动。回答里现在带有可直接打开的链接。',
    cta: '试试 Ask AI',
    dismiss: '关闭',
  },
}

export function copyForLang(lang) {
  return lang === 'zh' ? ASK_AI_UPGRADE_BANNER_COPY.zh : ASK_AI_UPGRADE_BANNER_COPY.en
}

// Dashboard has no language toggle. Reuse the Ask AI / Visit Reports locale
// when it is explicitly 中文; otherwise default to English (including Auto).
export function resolveBannerLang(lang, storage) {
  if (lang === 'zh' || lang === 'en') return lang
  const store = storage || safeStorage()
  const assistant = store?.getItem('assistantLang')
  if (assistant === 'zh' || assistant === 'en') return assistant
  const vr = store?.getItem('vrLang')
  if (vr === 'zh' || vr === 'en') return vr
  return 'en'
}

export function dismissalStorageKey(userId) {
  if (userId == null || userId === '') return null
  return `${STORAGE_PREFIX}${userId}`
}

function safeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function isWithinAskAiUpgradeBannerWindow(now = new Date(), start = ASK_AI_UPGRADE_BANNER_START, end = ASK_AI_UPGRADE_BANNER_END) {
  const t = new Date(now).getTime()
  const from = new Date(start).getTime()
  const until = new Date(end).getTime()
  if (Number.isNaN(t) || Number.isNaN(from) || Number.isNaN(until)) return false
  return t >= from && t < until
}

export function hasDismissedAskAiUpgradeBanner(userId, storage) {
  const key = dismissalStorageKey(userId)
  if (!key) return false
  const store = storage || safeStorage()
  try {
    return Boolean(store?.getItem(key))
  } catch {
    return false
  }
}

export function dismissAskAiUpgradeBanner(userId, storage) {
  const key = dismissalStorageKey(userId)
  if (!key) return
  const store = storage || safeStorage()
  try {
    store?.setItem(key, '1')
  } catch { /* private mode: banner may reappear in this session only */ }
}

export function shouldShowAskAiUpgradeBanner({
  userId,
  now = new Date(),
  storage,
  start = ASK_AI_UPGRADE_BANNER_START,
  end = ASK_AI_UPGRADE_BANNER_END,
} = {}) {
  if (userId == null || userId === '') return false
  if (!isWithinAskAiUpgradeBannerWindow(now, start, end)) return false
  if (hasDismissedAskAiUpgradeBanner(userId, storage)) return false
  return true
}
