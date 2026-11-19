import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  blocksToMarkdown,
  collapseProseSpaces,
  hasPreservedLetterhead,
  HEADER_META_KEYS,
  letterheadAuthorName,
  letterheadHeaderMeta,
  mergeLetterheadHeaderMeta,
  parseOriginalBody,
  rejoinLabelWraps,
  withLetterheadHeaderMeta,
} from './originalBodyBlocks.js'

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/alpine-grid-original.md')

const looseLists = [
  'Lead sentence here.',
  '',
  '1.  In general machine accuracy and cutting capacity of our machine is',
  '    much better',
  '',
  '2.  There are more issues of the first machine than the second, like',
  '    alarm/alert on temperature. But it is protecting  the machine in a',
  '    safe working condition.',
  '',
  'A section title without a period',
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
  '5.  Exchange with the commercial lead about basic',
  '    contract term.',
].join('\n')

test('loose numbered lists and wrapped lines stay one list with 1, 2, 3', () => {
  const blocks = parseOriginalBody(looseLists)
  const lists = blocks.filter((block) => block.type === 'list' && block.ordered)
  assert.equal(lists.length, 3)
  assert.equal(lists[0].start, 1)
  assert.deepEqual(lists[0].items, [
    'In general machine accuracy and cutting capacity of our machine is much better',
    'There are more issues of the first machine than the second, like alarm/alert on temperature. But it is protecting the machine in a safe working condition.',
  ])
  assert.equal(lists[1].start, 1)
  assert.equal(lists[1].items.length, 4)
  assert.match(lists[1].items[0], /Table type and latest specification/)
  assert.match(lists[1].items[2], /full hydrostatic, full casted part, sufficient reference/)
  assert.match(lists[1].items[3], /carry out a soil investigation report/)
  assert.doesNotMatch(lists[1].items[3], /soil\s*\n/)
})

test('a parenthetical aside between items 4 and 5 stays visible and the next item starts at 5', () => {
  const blocks = parseOriginalBody(looseLists)
  const aside = blocks.find((block) => block.aside)
  assert.ok(aside)
  assert.match(aside.text, /^\(Maybe it is still a chance[\s\S]*I feel\)$/)
  const after = blocks.slice(blocks.indexOf(aside) + 1).find((block) => block.type === 'list')
  assert.equal(after.start, 5)
  assert.match(after.items[0], /Exchange with the commercial lead about basic contract term/)
  const md = blocksToMarkdown(blocks)
  assert.match(md, /\(Maybe it is still a chance to change some of machines back to gantry type, I feel\)/)
  assert.match(md, /^5\. Exchange with the commercial lead/m)
  // The aside is not absorbed into item 4.
  const item4 = blocks.find((block) => block.type === 'list' && block.items?.[3])
  assert.doesNotMatch(item4.items[3], /Maybe it is still a chance/)
})

test('bullet lists also group across loose blank lines', () => {
  const blocks = parseOriginalBody([
    '- Customer got in general a good impression',
    '',
    '- non-critical workpiece of their own',
  ].join('\n'))
  const lists = blocks.filter((block) => block.type === 'list')
  assert.equal(lists.length, 1)
  assert.equal(lists[0].ordered, false)
  assert.deepEqual(lists[0].items, [
    'Customer got in general a good impression',
    'non-critical workpiece of their own',
  ])
})

test('ragged extra spaces collapse in prose and lists, not inside meaning', () => {
  assert.equal(collapseProseSpaces('protecting  the machine'), 'protecting the machine')
  assert.equal(collapseProseSpaces('part,  sufficient reference'), 'part, sufficient reference')
  const blocks = parseOriginalBody('The Japanese  machine is in  the hydrostatic oil system of the current  machine.')
  assert.equal(blocks[0].text, 'The Japanese machine is in the hydrostatic oil system of the current machine.')
})

test('broken form labels such as Parti cipants rejoin, without gluing Power generation', () => {
  assert.equal(rejoinLabelWraps('Parti cipants Customer'), 'Participants Customer')
  assert.equal(rejoinLabelWraps('Reason / Purpose of visit'), 'Reason / Purpose of visit')
  assert.equal(rejoinLabelWraps('Date of Visit'), 'Date of Visit')
  const blocks = parseOriginalBody(readFileSync(fixturePath, 'utf8'))
  const htmlish = JSON.stringify(blocks)
  assert.match(htmlish, /Participants|Customer/)
  assert.doesNotMatch(htmlish, /Parti cipants/)
  const meta = blocks.find((block) => block.type === 'meta')
  const industry = meta.fields.find((field) => field.key === 'industry')
  assert.equal(industry.value, 'Power generation')
  assert.ok(hasPreservedLetterhead(readFileSync(fixturePath, 'utf8')))
})

test('a letterhead and participants table become meta fields and attendee groups', () => {
  const blocks = parseOriginalBody(readFileSync(fixturePath, 'utf8'))
  assert.equal(blocks[0].type, 'heading')
  const meta = blocks.find((block) => block.type === 'meta')
  const attendees = blocks.find((block) => block.type === 'attendees')
  assert.ok(meta)
  assert.ok(attendees)
  const byKey = Object.fromEntries(meta.fields.map((field) => [field.key, field.value]))
  assert.equal(byKey.recipients, 'M. Turner, L. Bennett, Dr. Mornhill, Dr. Brocklane')
  assert.equal(byKey.industry, 'Power generation')
  assert.equal(byKey.machineType, 'Milling machine')
  assert.equal(byKey.quotationNo, '18.0008')
  const customer = attendees.groups.find((group) => /customer/i.test(group.label))
  const workshop = attendees.groups.find((group) => /workshop/i.test(group.label))
  assert.deepEqual(customer.people, [
    'Mr. Xu (Plant manager (Equipment))',
    'Mr. Zhang (Process planner (Equipment))',
    'Mr. Wang Guo Qiang (Head of purchasing dept. (ALPINE))',
    'Mr. Sun Le Ping (Process eng. (ALPINE))',
  ])
  assert.deepEqual(workshop.people, ['Helena Frost'])
  assert.equal(blocks.filter((block) => block.type === 'table').length, 2)
  const md = blocksToMarkdown(blocks)
  assert.match(md, /## Attendees/)
  assert.match(md, /\*\*Customer:\*\*/)
  assert.match(md, /Mr\. Wang Guo Qiang/)
  assert.doesNotMatch(md, /Parti cipants/)
  assert.doesNotMatch(md, /Please select type of report/i)
})

test('leftover Word chrome is dropped on parse and export', () => {
  const blocks = parseOriginalBody('Please select type of report\n\nThe shop reported a drive problem.')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, 'The shop reported a drive problem.')
  assert.doesNotMatch(blocksToMarkdown(blocks), /Please select type of report/i)
})

test('bold underlined labels stay section titles and export keeps the source markers', () => {
  const source = [
    '**[Project briefing:]{.underline}**',
    '',
    'The parent company is ***Example Power Research Institute Co., Ltd.***, a research unit.',
    '',
    '[]',
    '',
    '[] []',
  ].join('\n')
  const blocks = parseOriginalBody(source)
  assert.equal(blocks[0].type, 'heading')
  assert.equal(blocks[0].section, true)
  assert.equal(blocks[0].text, '**[Project briefing:]{.underline}**')
  assert.equal(blocks[1].type, 'paragraph')
  assert.match(blocks[1].text, /\*\*\*Example Power Research Institute Co\., Ltd\.\*\*\*/)
  assert.equal(blocks[2].text, '[]')
  assert.equal(blocks[3].text, '[] []')
  const md = blocksToMarkdown(blocks)
  assert.match(md, /\*\*\[Project briefing:\]\{\.underline\}\*\*/)
  assert.match(md, /\*\*\*Example Power Research Institute Co\., Ltd\.\*\*\*/)
  assert.match(md, /^\[\]$/m)
  assert.match(md, /^\[\] \[\]$/m)
})

const HEADER_GRID = [
  'Telephone Call Report',
  '',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| To                 | A. Example           |     | Fax                | C. Example         |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| CC                 | B. Example           |     | Date               | August 19, 2022    |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Company            | Example Plant        |     | Phone              | 555-0100           |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Place / Country    | Baoji                |     | Industry           | Engines            |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Date of Visit      | August 18, 2022      |     | Quotation No.      |                    |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Machine / Type     | KC 130               |     |                    |                    |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '',
  'The call covered the project briefing.',
].join('\n')

test('a letterhead table fills the six Report Header keys and skips Date and From', () => {
  const meta = letterheadHeaderMeta(HEADER_GRID)
  assert.deepEqual(meta, {
    recipients: 'A. Example',
    cc: 'B. Example',
    location: 'Baoji',
    industry: 'Engines',
    machineType: 'KC 130',
  })
  assert.equal(Object.hasOwn(meta, 'quotationNo'), false)
  assert.equal(HEADER_META_KEYS.includes('letterDate'), false)
  assert.equal(HEADER_META_KEYS.includes('dateOfVisit'), false)
  assert.equal(HEADER_META_KEYS.includes('from'), false)
  assert.doesNotMatch(JSON.stringify(meta), /August 18, 2022|August 19, 2022|555-0100|C\. Example/)
})

test('header meta stays empty when the letterhead has no Report Header fields', () => {
  const body = [
    '+---------+------------------+',
    '| Date    | August 19, 2022  |',
    '+---------+------------------+',
    '| Company | Example Plant    |',
    '+---------+------------------+',
    '',
    'The call covered the project briefing.',
  ].join('\n')
  assert.deepEqual(letterheadHeaderMeta(body), {})
})

test('a recovered header appendix can fill empty Report Header keys', () => {
  const body = [
    'The call covered the project briefing.',
    '',
    'Text recovered from the header',
    '',
    'To',
    '',
    'A. Example',
    '',
    'CC',
    '',
    'B. Example',
    '',
    'Place / Country',
    '',
    'Baoji',
    '',
    'Industry',
    '',
    'Engines',
    '',
    'Machine / Type',
    '',
    'KC 130',
    '',
    'Quotation No.',
    '',
    'Date',
    '',
    'August 19, 2022',
    '',
    'From',
    '',
    'C. Example',
  ].join('\n')
  const meta = letterheadHeaderMeta(body)
  assert.deepEqual(meta, {
    recipients: 'A. Example',
    cc: 'B. Example',
    location: 'Baoji',
    industry: 'Engines',
    machineType: 'KC 130',
  })
  assert.equal(Object.hasOwn(meta, 'quotationNo'), false)
  assert.doesNotMatch(JSON.stringify(meta), /August 19, 2022|C\. Example/)
  assert.equal(letterheadAuthorName(body), 'C. Example')
  assert.equal(mergeLetterheadHeaderMeta({}, body).author, 'C. Example')
})

test('a value already saved in meta wins over a letterhead prefill', () => {
  const saved = mergeLetterheadHeaderMeta(
    { recipients: 'Saved Name', location: '' },
    HEADER_GRID,
  )
  assert.equal(saved.recipients, 'Saved Name')
  assert.equal(saved.location, 'Baoji')
  assert.equal(saved.cc, 'B. Example')
  assert.equal(saved.author, 'C. Example')
  const content = withLetterheadHeaderMeta({
    bodySource: 'original',
    originalBody: HEADER_GRID,
    meta: { industry: 'Already filed' },
  })
  assert.equal(content.meta.industry, 'Already filed')
  assert.equal(content.meta.machineType, 'KC 130')
  assert.equal(content.meta.author, 'C. Example')
  assert.equal(content.originalBody, HEADER_GRID)
})

const FROM_GRID = [
  'Telephone Call Report',
  '',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| To                 | A. Example           |     | From               | Ada North          |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| CC                 | B. Example           |     | Date               | August 19, 2022    |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Company            | Example Plant        |     | Phone              | 555-0100           |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Place / Country    | Baoji                |     | Industry           | Engines            |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Date of Visit      | August 18, 2022      |     | Quotation No.      |                    |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '| Machine / Type     | KC 130               |     | Fax                | 555-0199           |',
  '+--------------------+----------------------+-----+--------------------+--------------------+',
  '',
  'The call covered the project briefing.',
].join('\n')

test('letterhead From is copied into meta.author, and a saved author wins', () => {
  assert.equal(letterheadAuthorName(FROM_GRID), 'Ada North')
  assert.equal(HEADER_META_KEYS.includes('author'), false)
  assert.equal(Object.hasOwn(letterheadHeaderMeta(FROM_GRID), 'author'), false)
  const meta = mergeLetterheadHeaderMeta({}, FROM_GRID)
  assert.equal(meta.author, 'Ada North')
  assert.equal(meta.recipients, 'A. Example')
  assert.doesNotMatch(JSON.stringify(meta), /555-0199|August 18, 2022|August 19, 2022/)
  const saved = mergeLetterheadHeaderMeta({ author: 'Saved Author' }, FROM_GRID)
  assert.equal(saved.author, 'Saved Author')
})

test('a name in the bare Fax slot can be the author when From is missing', () => {
  assert.equal(letterheadAuthorName(HEADER_GRID), 'C. Example')
  assert.equal(mergeLetterheadHeaderMeta({}, HEADER_GRID).author, 'C. Example')
})

test('a fax number, Telefax, Phone, CC, or To is not used as the author', () => {
  const faxNumber = [
    '+--------------------+----------------------+-----+--------------------+--------------------+',
    '| To                 | A. Example           |     | Fax                | 555-0199           |',
    '+--------------------+----------------------+-----+--------------------+--------------------+',
    '| CC                 | B. Example           |     | Date               | August 19, 2022    |',
    '+--------------------+----------------------+-----+--------------------+--------------------+',
    '| Company            | Example Plant        |     | Phone              | 555-0100           |',
    '+--------------------+----------------------+-----+--------------------+--------------------+',
    '| Telefax            | +1 555 010 0199      |     |                    |                    |',
    '+--------------------+----------------------+-----+--------------------+--------------------+',
  ].join('\n')
  assert.equal(letterheadAuthorName(faxNumber), '')
  assert.equal(Object.hasOwn(mergeLetterheadHeaderMeta({}, faxNumber), 'author'), false)
  assert.equal(letterheadAuthorName('To: A. Example\nCC: B. Example\nPhone: 555-0100\n'), '')
})
