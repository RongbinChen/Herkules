import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { loadJsxModule } from '../../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(here, '../../../../shared/fixtures/alpine-grid-original.md')

const body = [
  'X axis driven system is with problem',
  '',
  'Beijing No.1 people working on this matter',
  '',
  '- Customer got in general a good impression',
  '- non-critical workpiece of their own',
  '',
  'changed for table movement',
  '',
  '| Term | Share |',
  '| --- | --- |',
  '| Downpayment | 20% downpayment, 70% B/L, 10% FAT |',
  '| Instrument | L/C terms |',
  '',
  'full hydrostatic, full casted part, sufficient reference',
  '',
  '客户对非关键工件的安排保持原文。',
].join('\n')

test('the retained body shows every source phrase, including the table, without markup injection', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: `${body}\n\n<script>alert(1)</script>`,
  }))
  for (const phrase of [
    'X axis driven system is with problem',
    'Beijing No.1 people working on this matter',
    'full hydrostatic, full casted part, sufficient reference',
    'Customer got in general a good impression',
    'non-critical workpiece of their own',
    'changed for table movement',
    '20% downpayment, 70% B/L, 10% FAT',
    'L/C terms',
    '客户对非关键工件的安排保持原文。',
  ]) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(html, /<table/)
  assert.match(html, /<li /)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /text-sm font-normal leading-relaxed/)
})

test('an imported report shows the original body and its targets, not a rewritten section', async () => {
  const { default: VisitReportModal } = await loadJsxModule(path.join(here, '../VisitReportModal.jsx'))
  const report = {
    id: 8,
    title: 'Northline visit',
    status: 'FINAL',
    visitDate: '2026-11-12T00:00:00.000Z',
    canEdit: true,
    author: { id: 1, name: 'Ada North' },
    summary: 'Separate summary.',
    content: {
      bodySource: 'original',
      originalBody: 'X axis driven system is with problem',
      needs: 'This rewritten section must not appear',
      targets: [{ title: 'Follow the L/C terms', date: '2026-11-30', note: 'L/C terms' }],
    },
  }
  const html = renderToStaticMarkup(createElement(VisitReportModal, {
    report, lang: 'en', onClose: () => {}, onSaved: () => {},
  }))
  assert.match(html, /X axis driven system is with problem/)
  assert.match(html, /Follow the L\/C terms/)
  assert.match(html, /Separate summary/)
  assert.match(html, /Targets &amp; Reminders|Targets & Reminders/)
  assert.doesNotMatch(html, /This rewritten section must not appear/)
  assert.doesNotMatch(html, /<textarea/)
})

test('editing an imported report can add a target when extraction found none', async () => {
  const { default: VisitReportModal } = await loadJsxModule(path.join(here, '../VisitReportModal.jsx'))
  const report = {
    id: 8,
    title: 'Northline visit',
    status: 'DRAFT',
    visitDate: '2026-11-12T00:00:00.000Z',
    canEdit: true,
    author: { id: 1, name: 'Ada North' },
    content: { bodySource: 'original', originalBody: 'X axis driven system is with problem', targets: [] },
  }
  const html = renderToStaticMarkup(createElement(VisitReportModal, {
    report, startEditing: true, lang: 'en', onClose: () => {}, onSaved: () => {},
  }))
  assert.match(html, /Add target/)
  assert.match(html, /X axis driven system is with problem/)
  assert.doesNotMatch(html, /Regenerate caption/)
})

test('a pandoc grid table is rendered as a real table with reconstructed wrapped cells', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, { markdown: readFileSync(fixturePath, 'utf8') }))

  // No ASCII scaffolding or a raw dump of pipes in normal reading output.
  assert.doesNotMatch(html, /\+\-{3,}\+/)
  assert.doesNotMatch(html, /\+\-+\+.*\-+\+/)
  assert.doesNotMatch(html, /\| To\s*\|/)
  assert.doesNotMatch(html, /\+\-+\-+\-/)

  for (const name of ['Mornhill', 'Brocklane', 'Industry', 'Quotation', 'Customer', 'Shanghai', 'Holdings', 'Tscharee', 'Telex', 'Milling machine', 'Power generation']) {
    assert.match(html, new RegExp(name))
  }
  assert.match(html, /Attendees/)
  assert.match(html, /Customer/)
  assert.match(html, /Workshop/)
  assert.match(html, /Mr\. Wang Guo Qiang/)
  assert.doesNotMatch(html, /Parti cipants/)
  assert.match(html, /data-attendees/)
  assert.match(html, /data-report-meta/)

  for (const split of ['M ornhill', 'Br ocklane', 'I ndustry', 'T elex', 'H oldings', 'Tsch aree']) {
    assert.doesNotMatch(html, new RegExp(split.replace(/\s+/g, ' ')))
  }

  for (const phrase of [
    'Helena Frost',
    '20% downpayment, 70% B/L, 10% FAT',
    'L/C terms',
    'X axis driven system is with problem',
    'Beijing No.1 people working on this matter',
    'non-critical workpiece of their own',
    'changed for table movement',
    'full hydrostatic, full casted part, sufficient reference',
  ]) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  // Angle brackets stay literal text (React escapes them, they are not markup).
  assert.match(html, /&lt;X&gt;/)
  assert.match(html, /&lt;10 mm&gt;/)

  // Both the grid table and the pipe table render as real tables.
  assert.ok((html.match(/<table/g) || []).length >= 2)
  assert.match(html, /Downpayment/)
  assert.match(html, /Instrument/)
})

test('the retained body keeps soft-wrapped prose, lists, and pipe tables intact', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: [
      'The shop reported that the X axis driven system is with problem.',
      'Beijing No.1 people working on this matter while the gap is held at',
      '<X> and <10 mm>.',
      '',
      '- Keep the L/C terms on the commercial list',
      '- Record the 20% downpayment, 70% B/L, 10% FAT split',
      '',
      '| Term | Share |',
      '| --- | --- |',
      '| Downpayment | 20% downpayment, 70% B/L, 10% FAT |',
      '| Instrument | L/C terms |',
    ].join('\n'),
  }))
  assert.match(html, /The shop reported that the X axis driven system is with problem\. Beijing No\.1 people working on this matter while the gap is held at/)
  assert.match(html, /&lt;X&gt; and &lt;10 mm&gt;\./)
  assert.match(html, /<li /)
  assert.match(html, /<table/)
  assert.doesNotMatch(html, /<script>/)
})

const shopFloorBody = [
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

const shopFloorPhotos = [
  { storedName: 'image1.png', kind: 'image', caption: 'SNK HF 12 M machine working on a workpiece' },
  { storedName: 'image2.png', kind: 'image', caption: 'Dismantled SNK machine tables and drive system' },
  { storedName: 'image3.png', kind: 'image', caption: 'Worn worm rack components of an SNK machine' },
  { storedName: 'image4.png', kind: 'image', caption: 'An SNK machine undergoing repair, with its table and drive' },
]

test('leftover [] marks in the retained body are replaced with the matching photos', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: shopFloorBody,
    photos: shopFloorPhotos,
    lang: 'en',
  }))

  for (const phrase of [
    'Two SNK machines installed nearby one machine with same dimension.',
    'One machine is down for repairing work.',
    'The table and drive system were completed dismantled.',
    'They ordered tailor-made attachment as follows:',
    'The table drive problem obviously interrupted business.',
    ...shopFloorPhotos.map((photo) => photo.caption),
  ]) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.equal((html.match(/data-inline-photos/g) || []).length, 3)
  assert.equal((html.match(/data-inline-photo=/g) || []).length, 4)
  assert.match(html, /text-sm font-normal leading-relaxed text-slate-700/)
  assert.doesNotMatch(html, /<textarea/)
  assert.doesNotMatch(html, /Regenerate caption/)
  assert.doesNotMatch(html, /data-caption-editor/)
  // The leftover Word marks themselves must not remain as brackets.
  assert.doesNotMatch(html, />\[\]</)

  const firstCaption = html.indexOf(shopFloorPhotos[0].caption)
  const secondCaption = html.indexOf(shopFloorPhotos[1].caption)
  const repair = html.indexOf('One machine is down for repairing work.')
  const table = html.indexOf('The table and drive system were completed dismantled.')
  const attachment = html.indexOf('They ordered tailor-made attachment as follows:')
  const lastCaption = html.indexOf(shopFloorPhotos[3].caption)
  assert.ok(firstCaption > repair)
  assert.ok(secondCaption > firstCaption)
  assert.ok(table > secondCaption)
  assert.ok(lastCaption > attachment)
})

test('reading an imported report shows inlined photos in the body and only unused photos in the gallery', async () => {
  const { default: VisitReportModal } = await loadJsxModule(path.join(here, '../VisitReportModal.jsx'))
  const report = {
    id: 54,
    title: 'Shop visit',
    status: 'FINAL',
    visitDate: '2026-11-12T00:00:00.000Z',
    canEdit: true,
    author: { id: 7, name: 'Ada North' },
    customer: { id: 3, name: 'Northline Works' },
    content: { bodySource: 'original', originalBody: shopFloorBody },
    attachments: [
      ...shopFloorPhotos,
      { storedName: 'extra.png', kind: 'image', caption: 'A fifth shop-floor photo' },
    ],
  }
  const read = renderToStaticMarkup(createElement(VisitReportModal, {
    report, lang: 'en', currentUserId: 7, onClose: () => {}, onSaved: () => {},
  }))
  assert.match(read, /One machine is down for repairing work/)
  assert.match(read, /SNK HF 12 M machine working on a workpiece/)
  assert.match(read, /A fifth shop-floor photo/)
  assert.match(read, /Report photos/)
  assert.doesNotMatch(read, /<textarea/)
  assert.doesNotMatch(read, /Regenerate caption/)
  // Inlined captions appear before the leftover gallery heading.
  assert.ok(read.indexOf('SNK HF 12 M machine working on a workpiece') < read.indexOf('Report photos'))
  assert.ok(read.indexOf('A fifth shop-floor photo') > read.indexOf('Report photos'))

  const allInlined = renderToStaticMarkup(createElement(VisitReportModal, {
    report: { ...report, attachments: shopFloorPhotos },
    lang: 'en', currentUserId: 7, onClose: () => {}, onSaved: () => {},
  }))
  assert.match(allInlined, /Worn worm rack components of an SNK machine/)
  assert.doesNotMatch(allInlined, /Report photos/)

  const editing = renderToStaticMarkup(createElement(VisitReportModal, {
    report, startEditing: true, lang: 'en', currentUserId: 7, onClose: () => {}, onSaved: () => {},
  }))
  assert.match(editing, /data-caption-editor/)
  assert.match(editing, /Regenerate caption/)
  assert.match(editing, /Report photos/)
  // The source marks stay editable in the body textarea; every photo stays
  // in the gallery so captions can be edited and saved with the report.
  assert.match(editing, /\[\] \[\]/)
  assert.equal((editing.match(/data-caption-editor/g) || []).length, 5)
})

test('the detail page inlines photos in the preserved body and sends only leftovers to the gallery', () => {
  const detail = readFileSync(new URL('../VisitReportDetail.jsx', import.meta.url), 'utf8')
  assert.match(detail, /leftoverPhotos\(content\.originalBody, report\.attachments\)/)
  assert.match(detail, /photos=\{report\.attachments\}/)
  assert.match(detail, /<OriginalBody/)
})

test('loose lists render as 1, 2, 3 and keep a muted aside before item 5', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: [
      'Some additional exchange on the new milling machine projects of the yard',
      '',
      '1.  Table type and latest specification we received this Monday.',
      '',
      '2.  I mentioned the price and delivery time difference',
      '',
      '3.  Suggested again several technical points: full hydrostatic, full casted part,',
      '    sufficient reference.',
      '',
      '4.  Early next week, the institute will carry out a soil',
      '    investigation report for the yard.',
      '',
      '(Maybe it is still a chance to change some of machines back to gantry',
      'type, I feel)',
      '',
      '5.  Exchange with the commercial lead about basic contract term.',
    ].join('\n'),
  }))
  assert.match(html, /<ol[^>]*class="[^"]*list-decimal/)
  // start is omitted for a list that begins at 1, and set for the follow-on list.
  assert.match(html, /start="5"/)
  assert.equal((html.match(/<ol/g) || []).length, 2)
  assert.match(html, /soil investigation report for the yard/)
  assert.doesNotMatch(html, /<li[^>]*>[^<]*is<\/li>/)
  assert.match(html, /text-slate-500/)
  assert.match(html, /\(Maybe it is still a chance to change some of machines back to gantry type, I feel\)/)
  assert.match(html, /font-semibold text-slate-800/)
  assert.ok(html.indexOf('Maybe it is still a chance') < html.indexOf('start="5"'))
})

test('letterhead chrome is hidden and participants become aligned attendee chips', async () => {
  const { default: OriginalBody } = await loadJsxModule(path.join(here, 'OriginalBody.jsx'))
  const html = renderToStaticMarkup(createElement(OriginalBody, {
    markdown: `Please select type of report\n\n${readFileSync(fixturePath, 'utf8')}`,
  }))
  assert.doesNotMatch(html, /Please select type of report/i)
  assert.match(html, /data-report-meta/)
  assert.match(html, /data-attendees/)
  assert.match(html, /grid-cols-\[auto_minmax\(0,1fr\)\]/)
  assert.match(html, /rounded-full bg-slate-100/)
  assert.match(html, /min-h-\[1\.75rem\]/)
  assert.match(html, /uppercase tracking-wide text-slate-400/)
  assert.match(html, /Mr\. Wang Guo Qiang \(Head of purchasing dept\. \(ALPINE\)\)/)
  assert.doesNotMatch(html, /Wang Guo<\/span>/)
  assert.doesNotMatch(html, /Parti cipants/)
})
