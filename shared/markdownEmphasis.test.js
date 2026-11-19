import test from 'node:test'
import assert from 'node:assert/strict'
import { displayTitle, parseEmphasis, stripEmphasis } from './markdownEmphasis.js'

function plain(text) {
  return [{ text, bold: false, italic: false, underline: false, mark: false, strike: false }]
}

test('strips wrapping bold from a report title', () => {
  assert.equal(stripEmphasis('**Telephone Call Report**'), 'Telephone Call Report')
  assert.equal(displayTitle('**Telephone Call Report**'), 'Telephone Call Report')
  assert.equal(displayTitle('  **Telephone Call Report**  '), 'Telephone Call Report')
})

test('renders bold plus underline headings, including a curly apostrophe', () => {
  const heading = '**[Project briefing:]{.underline}**'
  assert.equal(stripEmphasis(heading), 'Project briefing:')
  assert.deepEqual(parseEmphasis(heading), [{
    text: 'Project briefing:',
    bold: true,
    italic: false,
    underline: true,
    mark: false,
    strike: false,
  }])

  const profile = '**[Customer’s profile:]{.underline}**'
  assert.equal(stripEmphasis(profile), 'Customer’s profile:')
  const parsed = parseEmphasis(profile)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].text, 'Customer’s profile:')
  assert.equal(parsed[0].bold, true)
  assert.equal(parsed[0].underline, true)
  assert.equal(stripEmphasis('**[Meeting:]{.underline}**'), 'Meeting:')
})

test('renders triple-asterisk bold italic in mixed prose', () => {
  const prose = 'The parent company is ***Example Power Research Institute Co., Ltd.***, a research unit.'
  assert.equal(
    stripEmphasis(prose),
    'The parent company is Example Power Research Institute Co., Ltd., a research unit.',
  )
  const parts = parseEmphasis(prose)
  assert.deepEqual(parts, [
    { text: 'The parent company is ', bold: false, italic: false, underline: false, mark: false, strike: false },
    { text: 'Example Power Research Institute Co., Ltd.', bold: true, italic: true, underline: false, mark: false, strike: false },
    { text: ', a research unit.', bold: false, italic: false, underline: false, mark: false, strike: false },
  ])
})

test('photo placeholder lines are left unchanged', () => {
  assert.deepEqual(parseEmphasis('[]'), plain('[]'))
  assert.deepEqual(parseEmphasis('[] []'), plain('[] []'))
  assert.equal(stripEmphasis('[]'), '[]')
  assert.equal(stripEmphasis('[] []'), '[] []')
  assert.equal(stripEmphasis('See also [] in the annex.'), 'See also [] in the annex.')
})

test('simple class spans such as mark are interpreted, and unknown classes only drop the wrapper', () => {
  const marked = parseEmphasis('[noted]{.mark}')
  assert.deepEqual(marked, [{
    text: 'noted',
    bold: false,
    italic: false,
    underline: false,
    mark: true,
    strike: false,
  }])
  assert.equal(stripEmphasis('[aside]{.smallcaps}'), 'aside')
  assert.equal(stripEmphasis('[keep]{width=14cm}'), '[keep]{width=14cm}')
})

test('unmatched or spaced markers, links, and mid-word underscores stay literal', () => {
  assert.equal(stripEmphasis('**not closed'), '**not closed')
  assert.equal(stripEmphasis('** padded **'), '** padded **')
  assert.equal(stripEmphasis('2 * 3 = 6'), '2 * 3 = 6')
  assert.equal(stripEmphasis('See the [notes](https://example.com) file.'), 'See the [notes](https://example.com) file.')
  assert.equal(stripEmphasis('use snake_case_names in text'), 'use snake_case_names in text')
  assert.equal(stripEmphasis('_italic_ and __bold__'), 'italic and bold')
})

test('displayTitle leaves plain titles alone and does not invent a value', () => {
  assert.equal(displayTitle('Northline visit'), 'Northline visit')
  assert.equal(displayTitle(''), '')
  assert.equal(displayTitle(null), '')
})
