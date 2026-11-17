import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displayablePhotos,
  embedInlinePhotos,
  leftoverPhotos,
  renderOriginalBodyMarkdown,
  splitTextWithPhotos,
} from '../../shared/inlineBodyPhotos.js'
import { isPlaceholderOnlyLine, parseOriginalBody } from '../../shared/originalBodyBlocks.js'
import { reportToMarkdown } from '../src/services/visitReportExport.js'

const BODY = [
  'Two SNK machines installed nearby one machine with same dimension.',
  '',
  'One machine is down for repairing work.',
  '',
  '[] []',
  '',
  '[]',
  '',
  'The table and drive system were completed dismantled.',
  '',
  'They ordered tailor-made attachment as follows:',
  '',
  '[]',
  '',
  'The table drive problem obviously interrupted business.',
].join('\n')

const captions = [
  'SNK HF 12 M machine working on a workpiece',
  'Dismantled SNK machine tables and drive system',
  'Worn worm rack components of an SNK machine',
  'An SNK machine undergoing repair, with its table and drive',
]

const photos = captions.map((caption, index) => ({
  storedName: `image${index + 1}.png`,
  kind: 'image',
  name: `image${index + 1}.png`,
  caption,
  markdownPath: `photo-${index + 1}.jpg`,
}))

test('placeholder-only lines stay their own paragraphs and are not joined with prose', () => {
  const blocks = parseOriginalBody([
    'One machine is down for repairing work.',
    '[] []',
    '[]',
    'The table and drive system were completed dismantled.',
  ].join('\n'))
  assert.deepEqual(blocks.map((block) => block.text), [
    'One machine is down for repairing work.',
    '[] []',
    '[]',
    'The table and drive system were completed dismantled.',
  ])
  assert.equal(isPlaceholderOnlyLine('[] []'), true)
  assert.equal(isPlaceholderOnlyLine('[]'), true)
  assert.equal(isPlaceholderOnlyLine('See [] here'), false)
  assert.equal(isPlaceholderOnlyLine('[](http://example.com)'), false)
  assert.equal(isPlaceholderOnlyLine('![](photo.jpg)'), false)
})

test('photos are assigned to [] marks in document order, including two on one line', () => {
  const { blocks, leftoverPhotos: leftover } = embedInlinePhotos(parseOriginalBody(BODY), photos)
  assert.equal(leftover.length, 0)

  const rows = blocks.filter((block) => block.type === 'photos')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0].photos.map((photo) => photo.caption), [captions[0], captions[1]])
  assert.deepEqual(rows[1].photos.map((photo) => photo.caption), [captions[2]])
  assert.deepEqual(rows[2].photos.map((photo) => photo.caption), [captions[3]])

  const prose = blocks.filter((block) => block.type === 'paragraph').map((block) => block.text)
  assert.ok(prose.includes('Two SNK machines installed nearby one machine with same dimension.'))
  assert.ok(prose.includes('One machine is down for repairing work.'))
  assert.ok(prose.includes('They ordered tailor-made attachment as follows:'))
  assert.equal(prose.some((text) => String(text).includes('[]')), false)
})

test('photos already used inline are omitted from the leftover gallery, and extra photos stay there', () => {
  const extra = { storedName: 'extra.png', kind: 'image', caption: 'A fifth shop-floor photo', markdownPath: 'photo-5.jpg' }
  const leftover = leftoverPhotos(BODY, [...photos, extra])
  assert.deepEqual(leftover.map((photo) => photo.storedName), ['extra.png'])
  assert.deepEqual(leftoverPhotos(BODY, photos).map((photo) => photo.storedName), [])
})

test('document attachments are skipped, leftover brackets are dropped, and markdown links are left alone', () => {
  assert.deepEqual(
    displayablePhotos([
      { storedName: 'doc.docx', kind: 'document', caption: 'Original Word file' },
      photos[0],
    ]).map((photo) => photo.storedName),
    ['image1.png'],
  )

  const { blocks } = embedInlinePhotos(parseOriginalBody('Before\n\n[] []\n\nAfter'), [photos[0]])
  const photoBlocks = blocks.filter((block) => block.type === 'photos')
  assert.equal(photoBlocks.length, 1)
  assert.equal(photoBlocks[0].photos.length, 1)
  assert.equal(JSON.stringify(blocks).includes('[]'), false)

  const mixed = splitTextWithPhotos('See ![](photo.jpg) and [](http://example.com) then [] done', [photos[0]])
  assert.equal(mixed.filter((part) => part.type === 'photo').length, 1)
  assert.equal(mixed.find((part) => part.type === 'photo').photo.storedName, 'image1.png')
  const text = mixed.filter((part) => part.type === 'text').map((part) => part.text).join('')
  assert.match(text, /!\[\]\(photo\.jpg\)/)
  assert.match(text, /\[\]\(http:\/\/example.com\)/)
  assert.doesNotMatch(text, /then\s+\[\]\s+done/)
})

test('export places inlined photos at the leftover marks and keeps unused photos at the end', () => {
  const md = reportToMarkdown({
    title: 'Shop visit',
    summary: 'A separate summary.',
    content: { bodySource: 'original', originalBody: BODY, needs: 'This rewritten section must not appear' },
  }, { photos })

  const first = md.indexOf(`![${captions[0]}](photo-1.jpg){width=14cm}`)
  const second = md.indexOf(`![${captions[1]}](photo-2.jpg){width=14cm}`)
  const third = md.indexOf(`![${captions[2]}](photo-3.jpg){width=14cm}`)
  const fourth = md.indexOf(`![${captions[3]}](photo-4.jpg){width=14cm}`)
  const afterRepair = md.indexOf('One machine is down for repairing work.')
  const afterTable = md.indexOf('The table and drive system were completed dismantled.')
  const afterAttachment = md.indexOf('They ordered tailor-made attachment as follows:')
  const closing = md.indexOf('The table drive problem obviously interrupted business.')

  assert.ok(afterRepair > md.indexOf('## Summary'))
  assert.ok(first > afterRepair)
  assert.ok(second > first)
  assert.ok(afterTable > second)
  assert.ok(third > second)
  assert.ok(third < afterTable)
  assert.ok(fourth > afterAttachment)
  assert.ok(closing > fourth)
  assert.equal(md.includes('## Report photos'), false)
  assert.doesNotMatch(md, /(?:^|\n)\[\](?:\s|\[\]|\n|$)/)
  assert.doesNotMatch(md, /This rewritten section must not appear/)

  const withExtra = reportToMarkdown({
    title: 'Shop visit',
    content: { bodySource: 'original', originalBody: BODY },
  }, { photos: [...photos, { storedName: 'extra.png', kind: 'image', caption: 'A fifth shop-floor photo', markdownPath: 'photo-5.jpg' }] })
  const galleryAt = withExtra.indexOf('## Report photos')
  assert.ok(galleryAt > closing)
  assert.ok(withExtra.indexOf('![A fifth shop-floor photo](photo-5.jpg){width=14cm}') > galleryAt)
  assert.ok(withExtra.indexOf(`![${captions[0]}](photo-1.jpg)`) < galleryAt)
  assert.equal((withExtra.match(/## Report photos/g) || []).length, 1)

  const { markdown } = renderOriginalBodyMarkdown('Plain paragraph with no marks.', photos)
  assert.match(markdown, /Plain paragraph with no marks/)
  assert.doesNotMatch(markdown, /!\[/)
})
