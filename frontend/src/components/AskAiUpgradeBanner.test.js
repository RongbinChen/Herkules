import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'
import { ASK_AI_UPGRADE_BANNER_COPY } from '../utils/askAiUpgradeBanner.js'

const here = path.dirname(fileURLToPath(import.meta.url))

async function renderView(props) {
  const { AskAiUpgradeBannerView } = await loadJsxModule(path.join(here, 'AskAiUpgradeBanner.jsx'))
  return renderToStaticMarkup(createElement(AskAiUpgradeBannerView, props))
}

test('English is the default locale and the CTA / dismiss controls are present', async () => {
  const html = await renderView({ onTry() {}, onDismiss() {} })
  const en = ASK_AI_UPGRADE_BANNER_COPY.en
  assert.match(html, new RegExp(en.title))
  assert.match(html, new RegExp(en.body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(html, />Try Ask AI</)
  assert.match(html, /aria-label="Dismiss"/)
  assert.doesNotMatch(html, /Ask AI 已升级/)
})

test('Chinese strings render when the locale is 中文', async () => {
  const html = await renderView({ lang: 'zh', onTry() {}, onDismiss() {} })
  const zh = ASK_AI_UPGRADE_BANNER_COPY.zh
  assert.match(html, new RegExp(zh.title))
  assert.match(html, /拜访报告/)
  assert.match(html, />试试 Ask AI</)
  assert.match(html, /aria-label="关闭"/)
  assert.doesNotMatch(html, /Ask AI has been upgraded/)
})
