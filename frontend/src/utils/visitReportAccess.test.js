import test from 'node:test'
import assert from 'node:assert/strict'
import { showDeleteVisitReport } from './visitReportAccess.js'
import { STRINGS } from '../i18n/visitReports.js'

const report = { id: 10, title: 'COSCO visit', authorId: 7, author: { id: 7, name: 'Ada' } }
const uploader = { id: 7, isAdmin: false, name: 'Ada' }
const admin = { id: 1, isAdmin: true, name: 'Admin' }
const coordinator = { id: 3, isAdmin: false, name: 'Coord' }
const dispatcher = { id: 4, isAdmin: false, name: 'Disp' }
const engineer = { id: 9, isAdmin: false, name: 'Eng' }

test('Delete is offered to the uploader and an admin only', () => {
  assert.equal(showDeleteVisitReport({ ...report, canDelete: true }, uploader), true)
  assert.equal(showDeleteVisitReport({ ...report, canDelete: true }, admin), true)
  assert.equal(showDeleteVisitReport({ ...report, canDelete: false }, coordinator), false)
  assert.equal(showDeleteVisitReport({ ...report, canDelete: false }, dispatcher), false)
  assert.equal(showDeleteVisitReport({ ...report, canDelete: false }, engineer), false)
  // The server flag wins over a client-side guess, including a forged admin.
  assert.equal(showDeleteVisitReport({ ...report, canDelete: false }, admin), false)
  assert.equal(showDeleteVisitReport({ ...report, canDelete: false }, uploader), false)
  assert.equal(showDeleteVisitReport({ ...report, authorId: 3, canDelete: true }, coordinator), true)
})

test('without a server flag, the same author-or-admin rule applies', () => {
  assert.equal(showDeleteVisitReport(report, uploader), true)
  assert.equal(showDeleteVisitReport(report, admin), true)
  assert.equal(showDeleteVisitReport(report, coordinator), false)
  assert.equal(showDeleteVisitReport(report, dispatcher), false)
  assert.equal(showDeleteVisitReport(report, engineer), false)
  assert.equal(showDeleteVisitReport({ id: 10, author: { id: 7, name: 'Ada' } }, uploader), true)
  assert.equal(showDeleteVisitReport(report, null), false)
  assert.equal(showDeleteVisitReport(null, admin), false)
  assert.equal(showDeleteVisitReport(report, { id: 7, isAdmin: 'true' }), true)
  assert.equal(showDeleteVisitReport(report, { id: 3, isAdmin: 'true' }), false)
})

test('delete copy exists in English and Chinese', () => {
  for (const lang of ['en', 'zh']) {
    const t = STRINGS[lang]
    assert.equal(typeof t.delete, 'string')
    assert.equal(typeof t.deleting, 'string')
    assert.equal(typeof t.deleteFailed, 'string')
    assert.equal(typeof t.deleteConfirm, 'function')
    const message = t.deleteConfirm('COSCO visit')
    assert.match(message, /COSCO visit/)
    assert.notEqual(message, STRINGS[lang === 'en' ? 'zh' : 'en'].deleteConfirm('COSCO visit'))
  }
})
