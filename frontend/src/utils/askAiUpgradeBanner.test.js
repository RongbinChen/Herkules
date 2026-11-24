import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASK_AI_UPGRADE_BANNER_START,
  ASK_AI_UPGRADE_BANNER_END,
  ASK_AI_UPGRADE_BANNER_COPY,
  copyForLang,
  resolveBannerLang,
  dismissalStorageKey,
  dismissAskAiUpgradeBanner,
  hasDismissedAskAiUpgradeBanner,
  isWithinAskAiUpgradeBannerWindow,
  shouldShowAskAiUpgradeBanner,
} from './askAiUpgradeBanner.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    removeItem: (key) => { delete data[key] },
    _data: data,
  }
}

const INSIDE = '2026-11-27T12:00:00-05:00'
const BEFORE = '2026-11-23T23:59:59-05:00'
const AT_START = ASK_AI_UPGRADE_BANNER_START
const JUST_BEFORE_END = '2026-11-30T23:59:59-05:00'
const AT_END = ASK_AI_UPGRADE_BANNER_END
const AFTER = '2026-12-01T00:00:01-05:00'

test('shown inside the 7-day window, including the start and the last instant before the end', () => {
  assert.equal(ASK_AI_UPGRADE_BANNER_START, '2026-11-24T00:00:00-05:00')
  assert.equal(ASK_AI_UPGRADE_BANNER_END, '2026-12-01T00:00:00-05:00')
  assert.equal(isWithinAskAiUpgradeBannerWindow(AT_START), true)
  assert.equal(isWithinAskAiUpgradeBannerWindow(INSIDE), true)
  assert.equal(isWithinAskAiUpgradeBannerWindow(JUST_BEFORE_END), true)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: INSIDE, storage: memoryStorage() }), true)
})

test('hidden after the end date, even if the user never saw or dismissed it', () => {
  const storage = memoryStorage()
  assert.equal(isWithinAskAiUpgradeBannerWindow(AT_END), false)
  assert.equal(isWithinAskAiUpgradeBannerWindow(AFTER), false)
  assert.equal(isWithinAskAiUpgradeBannerWindow(BEFORE), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: AT_END, storage }), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: AFTER, storage }), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: BEFORE, storage }), false)
})

test('hidden after dismiss, and after the same storage write used by the CTA', () => {
  const storage = memoryStorage()
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: INSIDE, storage }), true)
  dismissAskAiUpgradeBanner(12, storage)
  assert.equal(hasDismissedAskAiUpgradeBanner(12, storage), true)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: INSIDE, storage }), false)
  // Clicking the CTA uses the same dismiss helper, then navigates to /search.
  assert.equal(storage._data[dismissalStorageKey(12)], '1')
})

test('not shown for a user who already dismissed; another user on the same browser still sees it', () => {
  const storage = memoryStorage()
  dismissAskAiUpgradeBanner(12, storage)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 12, now: INSIDE, storage }), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: 34, now: INSIDE, storage }), true)
  assert.notEqual(dismissalStorageKey(12), dismissalStorageKey(34))
})

test('not shown when there is no user id', () => {
  const storage = memoryStorage()
  assert.equal(shouldShowAskAiUpgradeBanner({ now: INSIDE, storage }), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: '', now: INSIDE, storage }), false)
  assert.equal(shouldShowAskAiUpgradeBanner({ userId: null, now: INSIDE, storage }), false)
})

test('locale strings: English default, Chinese for the 中文 locale', () => {
  const en = copyForLang('en')
  const zh = copyForLang('zh')
  const fallback = copyForLang('auto')
  assert.equal(en.title, 'Ask AI has been upgraded')
  assert.equal(
    en.body,
    'Ask about visit reports, follow-ups, and calendar events. Answers now include links you can open directly.',
  )
  assert.equal(en.cta, 'Try Ask AI')
  assert.deepEqual(en, ASK_AI_UPGRADE_BANNER_COPY.en)
  assert.equal(zh.title, 'Ask AI 已升级')
  assert.match(zh.body, /拜访报告/)
  assert.match(zh.body, /项目跟进/)
  assert.match(zh.body, /日历活动/)
  assert.match(zh.body, /链接/)
  assert.equal(zh.cta, '试试 Ask AI')
  assert.equal(zh.dismiss, '关闭')
  assert.deepEqual(fallback, en)
  assert.equal(resolveBannerLang('zh'), 'zh')
  assert.equal(resolveBannerLang('en'), 'en')
  assert.equal(resolveBannerLang('auto', memoryStorage()), 'en')
  assert.equal(resolveBannerLang(undefined, memoryStorage({ assistantLang: 'zh' })), 'zh')
  assert.equal(resolveBannerLang(undefined, memoryStorage({ assistantLang: 'auto', vrLang: 'zh' })), 'zh')
  assert.equal(resolveBannerLang(undefined, memoryStorage({ assistantLang: 'auto' })), 'en')
})
