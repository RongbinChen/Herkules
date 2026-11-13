import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('the gallery is bilingual, shows captions, and hides when there is nothing to show', async () => {
  const { default: ReportPhotos } = await loadJsxModule(path.join(here, 'ReportPhotos.jsx'))
  const photo = { storedName: 'bed.jpg', kind: 'image', caption: '车间里的磨床床身' }

  assert.equal(renderToStaticMarkup(createElement(ReportPhotos, { lang: 'en', photos: [] })), '')
  assert.equal(renderToStaticMarkup(createElement(ReportPhotos, {
    lang: 'zh',
    photos: [{ name: 'logo.png', kind: 'image' }],
  })), '')

  const zh = renderToStaticMarkup(createElement(ReportPhotos, {
    lang: 'zh',
    photos: [photo],
    editable: true,
    onCaptionChange: () => {},
    onRegenerate: () => {},
  }))
  assert.match(zh, /报告图片/)
  assert.match(zh, /车间里的磨床床身/)
  assert.match(zh, /重新生成说明/)
  assert.match(zh, /查看大图/)
  assert.doesNotMatch(zh, /Report photos/)
  assert.match(zh, /<textarea/)

  const en = renderToStaticMarkup(createElement(ReportPhotos, {
    lang: 'en',
    photos: [{ storedName: 'bed.jpg', kind: 'image', caption: 'Bed of the machine' }],
  }))
  assert.match(en, /Report photos/)
  assert.match(en, /Bed of the machine/)
  assert.doesNotMatch(en, /<textarea/)
  assert.doesNotMatch(en, /Regenerate caption/)
  assert.doesNotMatch(en, /报告图片/)
})

test('the photo block sits after the report body on the detail page and in the editor', () => {
  for (const file of ['../VisitReportDetail.jsx', '../VisitReportModal.jsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    const photos = src.indexOf('<ReportPhotos')
    const tables = src.indexOf('tables.length')
    assert.ok(photos > 0, file)
    assert.ok(tables > 0, file)
    assert.ok(photos > tables, file)
    assert.equal(src.split('<ReportPhotos').length - 1, 1, file)
    // The section fields are rendered before the gallery, not around it.
    assert.ok(src.indexOf('SECTIONS') < photos, file)
  }
})
