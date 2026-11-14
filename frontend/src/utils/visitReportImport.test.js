import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseImportedCustomer, chooseImportedDate, warningMessages } from './visitReportImport.js'

test('a Word date fills only a new untouched form, and never invents today', () => {
  assert.equal(chooseImportedDate({
    suggested: '2026-07-14', current: '2026-11-13',
  }), '2026-07-14')
  assert.equal(chooseImportedDate({
    touched: true, suggested: '2026-07-14', current: '2026-11-12',
  }), '2026-11-12')
  assert.equal(chooseImportedDate({
    existingReport: true, suggested: '2026-07-14', current: '2026-11-12',
  }), '2026-11-12')
  assert.equal(chooseImportedDate({
    suggested: null, current: '2026-11-13',
  }), '2026-11-13')
})

test('a matched customer does not replace one the user already chose', () => {
  assert.equal(chooseImportedCustomer({ currentId: '', matchedId: 9 }), 9)
  assert.equal(chooseImportedCustomer({ touched: true, currentId: '', matchedId: 9 }), '')
  assert.equal(chooseImportedCustomer({ currentId: 4, matchedId: 9 }), 4)
})

test('caption and extraction warnings stay distinct and do not invent a caption', () => {
  const lines = warningMessages([
    { code: 'caption-unavailable', count: 2 },
    { code: 'caption-failed', count: 1 },
    { code: 'text-box', count: 1 },
  ], {
    captionUnavailable: 'No captions',
    captionFailed: 'Caption failed',
    extractionWarning: 'Text recovered',
  })
  assert.deepEqual(lines, ['No captions', 'Caption failed', 'Text recovered'])
})
