import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  blocksToMarkdown,
  collapseProseSpaces,
  hasPreservedLetterhead,
  isChromeParagraph,
  HEADER_META_KEYS,
  letterheadAuthorName,
  letterheadHeaderMeta,
  mergeLetterheadHeaderMeta,
  isRecoveredAppendixHeading,
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
  assert.equal(isChromeParagraph('Please select type of report'), true)
  assert.equal(isChromeParagraph('Visit Report'), true)
  assert.equal(isChromeParagraph('拜访报告'), true)
  assert.equal(isChromeParagraph('Telephone Call Report'), false)
  const bare = parseOriginalBody('Visit Report\n\nThe shop reported a drive problem.')
  assert.equal(bare[0].text, 'The shop reported a drive problem.')
  assert.doesNotMatch(blocksToMarkdown(bare), /^Visit Report$/m)
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

test('recovered appendix sections are hidden from the parsed body, and letterhead keys are still read', () => {
  const body = [
    'The mill walk-through covered the new grinders.',
    '',
    'Text recovered from the document body',
    '',
    'Workpiece material: alloy steel.',
    '',
    'The customer budget is still under review.',
    '',
    'Text recovered from text boxes',
    '',
    'A note from a text box.',
    '',
    'Text recovered from the header',
    '',
    'To',
    '',
    'A. Example',
  ].join('\n')
  const blocks = parseOriginalBody(body)
  const text = blocks.map((block) => block.text || '').join('\n')
  assert.match(text, /The mill walk-through covered the new grinders/)
  assert.equal(isRecoveredAppendixHeading('Text recovered from the document body'), true)
  assert.equal(isRecoveredAppendixHeading('# Text recovered from the footer'), true)
  assert.equal(isRecoveredAppendixHeading('从文档正文中恢复的文字'), true)
  assert.equal(isRecoveredAppendixHeading('The mill walk-through covered the new grinders.'), false)
  assert.doesNotMatch(text, /Text recovered from the document body/)
  assert.doesNotMatch(text, /Workpiece material/)
  assert.doesNotMatch(text, /customer budget/)
  assert.doesNotMatch(text, /A note from a text box/)
  assert.doesNotMatch(text, /Text recovered from the header/)
  assert.doesNotMatch(text, /A\. Example/)
  assert.equal(letterheadHeaderMeta(body).recipients, 'A. Example')
  const md = blocksToMarkdown(blocks)
  assert.doesNotMatch(md, /Text recovered from/)
  assert.doesNotMatch(md, /Workpiece material/)
  const zh = '会谈记录。\n\n从文档正文中恢复的文字\n\n这段不应显示。'
  const zhText = parseOriginalBody(zh).map((block) => block.text || '').join('\n')
  assert.match(zhText, /会谈记录/)
  assert.doesNotMatch(zhText, /不应显示/)
  assert.doesNotMatch(zhText, /从文档正文中恢复的文字/)
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

const TODO_SIMPLE_TABLE = [
  '  ---------------------------------------------------- --------------------------- --------------------',
  '  [To do:]{.underline}                                 [Responsible]{.underline}   [Date]{.underline}',
  '',
  '  Update the quotation by replacing the milling head   F. Example/WAV               Dec.. 9',
  '',
  '  to do                                                responsible                 date',
  '  ---------------------------------------------------- --------------------------- --------------------',
  '',
  '  -----------------------------------------------------------------------',
  '  [Mill Status / Plant Status]{.underline}',
  '',
  '  mill status / plant status',
  '  -----------------------------------------------------------------------',
].join('\n')

test('a leftover To-do header row is hidden and the real item is kept', () => {
  const blocks = parseOriginalBody(TODO_SIMPLE_TABLE)
  const table = blocks.find((block) => block.type === 'table')
  assert.ok(table)
  assert.equal(table.header.length, 3)
  assert.match(table.header[0], /To do:/)
  assert.match(table.header[1], /Responsible/)
  assert.match(table.header[2], /\[Date\]/)
  assert.equal(table.rows.length, 1)
  assert.match(table.rows[0][0], /Update the quotation by replacing the milling head/)
  assert.equal(table.rows[0][1], 'F. Example/WAV')
  assert.equal(table.rows[0][2], 'Dec.. 9')
  const flat = [table.header, ...table.rows].flat().join('\n')
  assert.doesNotMatch(flat, /^to do$/m)
  assert.doesNotMatch(flat, /^responsible$/m)
  assert.doesNotMatch(flat, /^date$/m)
  const md = blocksToMarkdown(blocks)
  assert.match(md, /Update the quotation by replacing the milling head/)
  assert.doesNotMatch(md, /\| to do \|/i)
  const text = blocks.map((block) => block.text || '').join('\n')
  assert.match(text, /Mill Status \/ Plant Status/)
  assert.doesNotMatch(text, /mill status \/ plant status/)
})

test('a leftover header row is also dropped from pipe and grid tables, but a real item is kept', () => {
  const pipe = [
    '| [To do:]{.underline} | [Responsible]{.underline} | [Date]{.underline} |',
    '| --- | --- | --- |',
    '| Update the quotation by replacing the milling head | F. Example/WAV | Dec.. 9 |',
    '| to do | responsible | date |',
  ].join('\n')
  const pipeTable = parseOriginalBody(pipe).find((block) => block.type === 'table')
  assert.equal(pipeTable.rows.length, 1)
  assert.match(pipeTable.rows[0][0], /Update the quotation/)
  assert.equal(pipeTable.rows[0][1], 'F. Example/WAV')

  const kept = parseOriginalBody([
    '| [To do:]{.underline} | [Responsible]{.underline} | [Date]{.underline} |',
    '| --- | --- | --- |',
    '| to do | F. Example/WAV | Dec. 9 |',
  ].join('\n')).find((block) => block.type === 'table')
  assert.equal(kept.rows.length, 1)
  assert.equal(kept.rows[0][0], 'to do')
  assert.equal(kept.rows[0][1], 'F. Example/WAV')

  const grid = [
    '+--------------------------+----------------------------+----------------------+',
    '| [To do:]{.underline}     | [Responsible]{.underline}  | [Date]{.underline}   |',
    '+--------------------------+----------------------------+----------------------+',
    '| Update the quotation     | F. Example/WAV             | Dec.. 9              |',
    '+--------------------------+----------------------------+----------------------+',
    '| to do                    | responsible                | date                 |',
    '+--------------------------+----------------------------+----------------------+',
  ].join('\n')
  const gridTable = parseOriginalBody(grid).find((block) => block.type === 'table')
  assert.equal(gridTable.header, null)
  assert.equal(gridTable.rows.length, 2)
  assert.match(gridTable.rows[0][0], /To do:/)
  assert.match(gridTable.rows[1][0], /Update the quotation/)
  assert.equal(gridTable.rows.some((row) => row.map((cell) => String(cell).trim().toLowerCase()).join('|') === 'to do|responsible|date'), false)
})
