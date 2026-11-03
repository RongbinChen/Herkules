import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('the Delete control is rendered only when the server allows it, in the active language', async () => {
  const { default: DeleteReportButton } = await loadJsxModule(path.join(here, 'DeleteReportButton.jsx'))
  const report = { id: 10, title: 'COSCO visit', authorId: 7, canDelete: false }
  const coordinator = { id: 3, isAdmin: false }
  const admin = { id: 1, isAdmin: true }
  const uploader = { id: 7, isAdmin: false }

  assert.equal(renderToStaticMarkup(createElement(DeleteReportButton, {
    report, user: coordinator, lang: 'en',
  })), '')
  // Server said no, so an admin does not see Delete either.
  assert.equal(renderToStaticMarkup(createElement(DeleteReportButton, {
    report, user: admin, lang: 'zh',
  })), '')

  const zh = renderToStaticMarkup(createElement(DeleteReportButton, {
    report: { ...report, canDelete: true }, user: uploader, lang: 'zh',
  }))
  assert.match(zh, /删除/)
  assert.doesNotMatch(zh, />Delete</)

  const en = renderToStaticMarkup(createElement(DeleteReportButton, {
    report: { ...report, canDelete: true }, user: admin, lang: 'en',
  }))
  assert.match(en, />Delete</)
  assert.match(en, /type="button"/)
})
