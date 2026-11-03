import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignRemindDomIds,
  remindAnchors,
  remindKey,
  reminderDueDay,
  targetTitleFromReminder,
  visitReportRemindLocation,
} from './remindAnchor.js'

// Mirrors backend/src/routes/visitReports.js when it creates the calendar row.
const eventTitleFromTarget = (title) => `⏰ ${String(title).slice(0, 180)}`

test('reminder title maps back to the target title, including the 180-char slice', () => {
  const title = '6月30日前提交方案'
  assert.equal(targetTitleFromReminder(eventTitleFromTarget(title)), title)
  assert.equal(remindKey(targetTitleFromReminder(eventTitleFromTarget(title))), remindKey(title))

  const long = `提交报价-${'甲'.repeat(200)}`
  const stored = eventTitleFromTarget(long)
  assert.equal(stored.startsWith('⏰ '), true)
  assert.equal(remindKey(targetTitleFromReminder(stored)), remindKey(long))
  assert.equal(remindKey(long), remindKey(long.slice(0, 180)))
})

test('keys are url-safe and differ for different titles', () => {
  const a = remindKey('Confirm roll diameter')
  const b = remindKey('确认轧辊直径')
  assert.match(a, /^[A-Za-z0-9_-]+$/)
  assert.match(b, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(a, b)
  assert.equal(remindKey('   '), null)
  assert.equal(remindKey(''), null)
})

test('due day follows the stored 09:00 Asia/Shanghai instant', () => {
  assert.equal(reminderDueDay('2026-06-30T09:00:00+08:00'), '2026-06-30')
  assert.equal(reminderDueDay('not-a-date'), null)
})

test('deep link keeps the title anchor when the reminder was postponed', () => {
  const original = 'Submit the quotation before the tender closes'
  const loc = visitReportRemindLocation({
    visitReportId: 7,
    title: eventTitleFromTarget(original),
    start: '2026-12-01T01:00:00.000Z',
  })
  assert.deepEqual(loc, {
    pathname: '/visit-reports/7',
    hash: `#remind-${remindKey(original)}`,
    search: '?remindDate=2026-12-01',
  })

  const targets = [
    { title: 'Send the revised layout', date: '2026-05-20' },
    { title: original, date: '2026-06-30' },
  ]
  const { ids, focusId } = remindAnchors(targets, loc)
  assert.equal(focusId, ids[1])
  assert.equal(focusId, `remind-${remindKey(original)}`)
})

test('identical titles: the dated row owns the canonical id, otherwise the first', () => {
  const title = 'Follow up with purchasing'
  const targets = [
    { title, date: '2026-05-01' },
    { title: 'Something else', date: '2026-06-01' },
    { title, date: '2026-11-02' },
    { title, date: '2026-12-15' },
  ]
  const key = remindKey(title)
  const dated = assignRemindDomIds(targets, '2026-11-02')
  assert.equal(dated[2], `remind-${key}`)
  assert.equal(dated[0], `remind-${key}-2`)
  assert.equal(dated[3], `remind-${key}-3`)
  assert.notEqual(dated[1], dated[0])

  const first = assignRemindDomIds(targets, '2026-12-01')
  assert.equal(first[0], `remind-${key}`)
  assert.equal(first[2], `remind-${key}-2`)

  const fromEvent = visitReportRemindLocation({
    visitReportId: 7,
    title: eventTitleFromTarget(title),
    start: '2026-11-02T01:00:00.000Z',
  })
  const { focusId } = remindAnchors(targets, fromEvent)
  assert.equal(focusId, `remind-${key}`)
  assert.equal(assignRemindDomIds(targets, '2026-11-02')[2], focusId)
})

test('unknown or malformed remind hash does not resolve to a row', () => {
  const targets = [{ title: 'Send the revised layout', date: '2026-05-20' }]
  assert.equal(remindAnchors(targets, { hash: '', search: '' }).focusId, null)
  assert.equal(remindAnchors(targets, { hash: '#summary', search: '' }).focusId, null)
  assert.equal(remindAnchors(targets, { hash: '#remind-not-a-real-target', search: '' }).focusId, null)
  assert.equal(remindAnchors(targets, { hash: '#remind-%E0%A4%A', search: '' }).focusId, null)
})

test('a reminder with no usable title opens the report without a hash', () => {
  assert.deepEqual(
    visitReportRemindLocation({ visitReportId: 4, title: '⏰   ', start: 'nope' }),
    { pathname: '/visit-reports/4' },
  )
})
