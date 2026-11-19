import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chooseImportedCustomer, chooseImportedDate, missingSaveFields, saveValidationMessage, shouldWarnMissingImportedDate, warningMessages } from './visitReportImport.js'
import { HEADER_META_KEYS } from '../../../shared/originalBodyBlocks.js'

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
  }), '')
  assert.equal(chooseImportedDate({
    touched: true, suggested: null, current: '2026-11-13',
  }), '2026-11-13')
  assert.equal(chooseImportedDate({
    existingReport: true, suggested: null, current: '2026-11-13',
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
    extractionWarningDownload: 'Text recovered and the Word file can be downloaded',
  })
  assert.deepEqual(lines, ['No captions', 'Caption failed', 'Text recovered'])
})

test('the extraction warning only promises a download when a stored Word file exists', () => {
  const t = {
    extractionWarning: 'Text recovered',
    extractionWarningDownload: 'Text recovered and the Word file can be downloaded',
  }
  const warnings = [{ code: 'text-box', count: 1 }]
  const withoutFile = warningMessages(warnings, t, { hasOriginalFile: false })
  assert.deepEqual(withoutFile, ['Text recovered'])
  assert.doesNotMatch(withoutFile[0], /download|Word file/i)

  const withFile = warningMessages(warnings, t, { hasOriginalFile: true })
  assert.deepEqual(withFile, ['Text recovered and the Word file can be downloaded'])
  assert.match(withFile[0], /download/)
})

test('the edit form prefills empty Report Header fields from a preserved letterhead', () => {
  const modal = readFileSync(new URL('../components/VisitReportModal.jsx', import.meta.url), 'utf8')
  assert.match(modal, /withLetterheadHeaderMeta\(report\?\.content \|\| \{\}\)/)
  assert.match(modal, /withLetterheadHeaderMeta\(data\.content \|\| \{\}\)/)
  const i18n = readFileSync(new URL('../i18n/visitReports.js', import.meta.url), 'utf8')
  const blockStart = i18n.indexOf('export const META_FIELDS_I18N')
  const block = i18n.slice(blockStart, i18n.indexOf(']', blockStart) + 1)
  const keys = [...block.matchAll(/key: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(keys, HEADER_META_KEYS)
})

const SAVE_T = {
  errTitleRequired: 'Title is required',
  errVisitDateRequired: 'Visit date is required',
  errTitleAndVisitDateRequired: 'Title and visit date are required',
}

test('save validation names the missing field in plain language, never raw identifiers', () => {
  assert.deepEqual(missingSaveFields({ title: 'Plant visit', visitDate: '2022-08-18' }), {
    missingTitle: false, missingDate: false,
  })
  assert.equal(saveValidationMessage({ title: 'Plant visit', visitDate: '2022-08-18' }, SAVE_T), '')
  assert.equal(saveValidationMessage({ title: '  ', visitDate: '2022-08-18' }, SAVE_T), 'Title is required')
  assert.equal(saveValidationMessage({ title: 'Plant visit', visitDate: '' }, SAVE_T), 'Visit date is required')
  assert.equal(saveValidationMessage({ title: '', visitDate: '' }, SAVE_T), 'Title and visit date are required')
  assert.equal(saveValidationMessage({ title: 'Plant visit', visitDate: '18/08/2022' }, SAVE_T), 'Visit date is required')
  const message = saveValidationMessage({ title: 'Plant visit', visitDate: '' }, SAVE_T)
  assert.doesNotMatch(message, /visitDate/)
  assert.doesNotMatch(message, /\btitle\b/)
})

test('a preserved import with no letterhead date warns only when the form date is empty', () => {
  assert.equal(shouldWarnMissingImportedDate({
    preserved: true, current: '2026-11-18', suggested: null,
  }), true)
  assert.equal(shouldWarnMissingImportedDate({
    preserved: true, suggested: '2022-08-18', current: '2026-11-18',
  }), false)
  assert.equal(shouldWarnMissingImportedDate({
    preserved: true, touched: true, current: '2026-11-18', suggested: null,
  }), false)
  assert.equal(shouldWarnMissingImportedDate({
    preserved: true, existingReport: true, current: '2022-08-18', suggested: null,
  }), false)
  assert.equal(shouldWarnMissingImportedDate({
    preserved: false, current: '2026-11-18', suggested: null,
  }), false)
})

test('the edit form checks visit date before save and scrolls the empty field into view', () => {
  const modal = readFileSync(new URL('../components/VisitReportModal.jsx', import.meta.url), 'utf8')
  assert.match(modal, /saveValidationMessage\(form, t\)/)
  assert.match(modal, /focusRequiredField\(missingDate \? visitDateFieldRef : titleFieldRef\)/)
  assert.match(modal, /scrollIntoView/)
  assert.match(modal, /shouldWarnMissingImportedDate/)
  assert.match(modal, /t\.importDateUnrecognized/)
  assert.doesNotMatch(modal, /title 与 visitDate 必填/)
  const i18n = readFileSync(new URL('../i18n/visitReports.js', import.meta.url), 'utf8')
  assert.match(i18n, /errVisitDateRequired: 'Visit date is required'/)
  assert.match(i18n, /errVisitDateRequired: '请填写拜访日期'/)
  assert.match(i18n, /importDateUnrecognized: 'The letterhead Date of Visit was not recognized/)
  assert.match(i18n, /importDateUnrecognized: '信头中的拜访日期未能识别/)
  assert.doesNotMatch(i18n, /visitDate 必填/)
})
