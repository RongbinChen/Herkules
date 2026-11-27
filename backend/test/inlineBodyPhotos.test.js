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

const WUXI_BODY = [
  'Feedback on WALDRICH COBURG TAURUS:',
  '',
  'He generally handles machine-related issues by himself/3^rd^ party.',
  '',
  '![](media/image1.png){width="6.495833333333334in" height="3.934722222222222in"}',
  '',
  '*Taurus machine installed in a temperature control room*',
  '',
  'The installation container is still on the customer\'s premises, as shown in the photo below.',
  '',
  '![](media/image2.jpg){width="3.8in" height="2.848886701662292in"}',
  '',
  '*WALDRICH COBURG installation container remaining on site.*',
  '',
  '![](media/image3.png){width="4.25in" height="2.5in"}',
  '',
  'Production continued on the next shift.',
].join('\n')

const wuxiPhotos = [
  { storedName: 'a.png', kind: 'image', name: 'image1.png', caption: 'The Taurus machine is installed in a temperature-controlled room.', markdownPath: 'photo-1.jpg' },
  { storedName: 'b.jpg', kind: 'image', name: 'image2.jpg', caption: 'The WALDRICH COBURG installation container remains on site.', markdownPath: 'photo-2.jpg' },
  { storedName: 'c.png', kind: 'image', name: 'image3.png', caption: 'A spindle housing waiting for inspection.', markdownPath: 'photo-3.jpg' },
]

test('pandoc media image marks keep a following italic caption once and note a photo that has none', () => {
  const source = WUXI_BODY
  const content = { bodySource: 'original', originalBody: source }
  const md = reportToMarkdown({
    title: 'Wuxi visit',
    content,
  }, { photos: wuxiPhotos })
  assert.equal(content.originalBody, source)

  const body = md.split('## Report photos')[0]
  assert.doesNotMatch(body, /!\[\]\(media\//)
  assert.doesNotMatch(body, /\{width=/)
  assert.doesNotMatch(body, /media\/image1\.png/)
  assert.doesNotMatch(body, /media\/image2\.jpg/)
  assert.doesNotMatch(body, /6\.495833333333334in/)
  assert.doesNotMatch(body, /2\.848886701662292in/)
  assert.equal((body.match(/Taurus machine installed in a temperature control room/g) || []).length, 1)
  assert.equal((body.match(/WALDRICH COBURG installation container remaining on site/g) || []).length, 1)
  assert.match(body, /\*Taurus machine installed in a temperature control room\*/)
  assert.doesNotMatch(body, /^#{1,6} .*Taurus machine/m)
  assert.doesNotMatch(body, /See the photo below: The Taurus machine/)
  assert.doesNotMatch(body, /See the photo below: The WALDRICH COBURG/)
  assert.match(body, /See the photo below: A spindle housing waiting for inspection\./)
  assert.match(body, /Production continued on the next shift/)
  assert.ok(body.indexOf('See the photo below: A spindle housing waiting for inspection.') < body.indexOf('Production continued on the next shift.'))
  // Word export keeps pandoc superscript markers so the converter can raise them.
  assert.match(body, /himself\/3\^rd\^ party/)

  const gallery = md.slice(md.indexOf('## Report photos'))
  assert.match(gallery, /!\[The Taurus machine is installed in a temperature-controlled room\.\]\(photo-1\.jpg\)\{width=14cm\}/)
  assert.match(gallery, /!\[The WALDRICH COBURG installation container remains on site\.\]\(photo-2\.jpg\)\{width=14cm\}/)
  assert.match(gallery, /!\[A spindle housing waiting for inspection\.\]\(photo-3\.jpg\)\{width=14cm\}/)
  assert.deepEqual(leftoverPhotos(source, wuxiPhotos).map((photo) => photo.storedName), ['a.png', 'b.jpg', 'c.png'])

  // The stored parse still contains the mark. Only the display/export pass removes it.
  assert.match(parseOriginalBody(source).map((block) => block.text || '').join('\n'), /media\/image1\.png/)
})

test('media image variants: quotes, missing attributes, alt text, joined captions, and gallery matching', () => {
  const singleQuotes = [
    '![](media/image1.png){width=\'6.495833333333334in\' height=\'3.934722222222222in\'}',
    '',
    '*Taurus machine installed in a temperature control room*',
  ].join('\n')
  const quoted = renderOriginalBodyMarkdown(singleQuotes, wuxiPhotos).markdown
  assert.doesNotMatch(quoted, /media\/image|\{width=|!\[\]/)
  assert.equal((quoted.match(/Taurus machine installed in a temperature control room/g) || []).length, 1)
  assert.doesNotMatch(quoted, /See the photo below/)

  const joined = renderOriginalBodyMarkdown([
    '![](media/image1.png){width="6.495833333333334in" height="3.934722222222222in"}',
    '*Taurus machine installed in a temperature control room*',
  ].join('\n'), wuxiPhotos).markdown
  assert.doesNotMatch(joined, /media\/image|\{width=/)
  assert.equal((joined.match(/Taurus machine installed in a temperature control room/g) || []).length, 1)

  const bare = renderOriginalBodyMarkdown('![](media/image2.jpg)\n\nAfter the visit.', [wuxiPhotos[1]]).markdown
  assert.match(bare, /See the photo below: The WALDRICH COBURG installation container remains on site\./)
  assert.match(bare, /After the visit\./)
  assert.doesNotMatch(bare, /!\[\]\(media/)

  const unquoted = renderOriginalBodyMarkdown(
    '![](media/image2.jpg){width=3.8in height=2.848886701662292in}',
    [wuxiPhotos[1]],
  ).markdown
  assert.match(unquoted, /See the photo below: The WALDRICH COBURG installation container remains on site\./)
  assert.doesNotMatch(unquoted, /2\.848886701662292in/)

  const altOnly = renderOriginalBodyMarkdown('![Shop overview](media/image9.png){width="4in" height="3in"}', []).markdown
  assert.equal(altOnly.trim(), '*See the photo below: Shop overview.*')

  const noMatch = renderOriginalBodyMarkdown('![](media/image8.png)', []).markdown
  assert.equal(noMatch.trim(), '*See the photo below.*')

  const byName = renderOriginalBodyMarkdown('![](media/image1.png){width="1in" height="1in"}', [
    { storedName: 's2.jpg', name: 'image2.jpg', caption: 'Named second', markdownPath: 'p2.jpg' },
    { storedName: 's1.png', name: 'image1.png', caption: 'Named first', markdownPath: 'p1.jpg' },
  ]).markdown
  assert.match(byName, /See the photo below: Named first\./)
  assert.doesNotMatch(byName, /Named second/)

  const byIndex = renderOriginalBodyMarkdown('![](media/image2.jpg){width="3.8in" height="2.8in"}', [
    { storedName: 'u1.png', name: 'u1.png', caption: 'First gallery photo', markdownPath: 'p1.jpg' },
    { storedName: 'u2.jpg', name: 'u2.jpg', caption: 'Second gallery photo', markdownPath: 'p2.jpg' },
  ]).markdown
  assert.match(byIndex, /See the photo below: Second gallery photo\./)

  const withDocument = renderOriginalBodyMarkdown('![](media/image1.png)', [
    { storedName: 'orig.docx', kind: 'document', name: 'original.docx' },
    { storedName: 'only.png', name: 'uuid-photo.png', caption: 'The only report photo', markdownPath: 'p1.jpg' },
  ]).markdown
  assert.match(withDocument, /See the photo below: The only report photo\./)

  const zh = renderOriginalBodyMarkdown([
    '车间正在加工精密零件。',
    '',
    '![](media/image1.png){width="6.495833333333334in" height="3.934722222222222in"}',
  ].join('\n'), [
    { storedName: 'z.png', name: 'image1.png', caption: '主轴箱待检', markdownPath: 'z.jpg' },
  ]).markdown
  assert.match(zh, /见下方照片：主轴箱待检。/)
  assert.doesNotMatch(zh, /主轴箱待检\./)
  assert.doesNotMatch(zh, /See the photo below|media\/image|\{width=/)

  const mixed = embedInlinePhotos(parseOriginalBody([
    '[]',
    '',
    '![](media/image2.jpg){width="3.8in" height="2.848886701662292in"}',
  ].join('\n')), wuxiPhotos.slice(0, 2))
  assert.equal(mixed.blocks.some((block) => block.type === 'photos'), true)
  assert.equal(mixed.blocks.some((block) => block.photoNote && /remains on site/.test(block.text)), true)
  assert.deepEqual(mixed.leftoverPhotos.map((photo) => photo.name), ['image2.jpg'])
  assert.equal(JSON.stringify(mixed.blocks).includes('media/image'), false)

  const unrelated = embedInlinePhotos(parseOriginalBody('See ![](photo.jpg) in the annex.'), wuxiPhotos)
  assert.match(unrelated.blocks.map((block) => block.text).join('\n'), /!\[\]\(photo\.jpg\)/)
})
