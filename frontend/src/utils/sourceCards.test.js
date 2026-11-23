import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSafeAppHref,
  reportIdFromHref,
  fmtSourceDate,
  reportOverviewLine,
  reminderOverviewLine,
  reminderDisplayTitle,
  groupSourceCards,
  sourceTypeLabels,
} from './sourceCards.js'

test('report overview uses stored date, location, customer — never invents text', () => {
  assert.equal(
    reportOverviewLine({
      visitDate: '2026-10-28T00:00:00.000Z',
      location: 'Shanghai yard',
      customer: 'COSCO Shipping Heavy Industry (Shanghai)',
    }),
    '2026-10-28 · Shanghai yard · COSCO Shipping Heavy Industry (Shanghai)',
  )
  assert.equal(reportOverviewLine({ title: 'Untitled visit' }), '')
  assert.equal(fmtSourceDate('2026-10-28'), '2026-10-28')
  assert.equal(reportIdFromHref('/visit-reports/57?remindDate=2026-11-30#remind-abc'), 57)
})

test('reminders keep a source-report line and strip the clock prefix', () => {
  assert.equal(reminderDisplayTitle('⏰ Keep contact (WRC)'), 'Keep contact (WRC)')
  const line = reminderOverviewLine({
    start: '2026-11-30T01:00:00.000Z',
    reportTitle: 'COSCO plant visit',
  }, 'en')
  assert.equal(line, '2026-11-30 · from report: COSCO plant visit')
  const zh = reminderOverviewLine({
    start: '2026-11-30T01:00:00.000Z',
    reportTitle: 'COSCO plant visit',
  }, 'zh')
  assert.match(zh, /来源报告：COSCO plant visit/)
})

test('groupSourceCards nests reminders under their visit report and leaves others as cards', () => {
  const grouped = groupSourceCards([
    { type: 'customer', title: 'COSCO Shipping Heavy Industry (Shanghai)', href: '/customers/12' },
    { type: 'hot', title: 'COSCO rotor', href: '/hotprojects?id=3' },
    {
      type: 'report',
      title: 'COSCO Shipping Heavy Industry (Shanghai)',
      href: '/visit-reports/57',
      visitDate: '2026-10-28',
      location: 'Shanghai',
      summary: 'Discussed the Dec 10 contract target and an updated Hengli proposal.',
    },
    {
      type: 'report',
      title: 'Shanghai Hongguang Boiler Reference Visit for COSCO machining',
      href: '/visit-reports/58',
      visitDate: '2026-10-30',
      summary: 'Reference visit to compare machining capacity.',
    },
    {
      type: 'reminder',
      title: '⏰ Keep contact (WRC)',
      href: '/visit-reports/57?remindDate=2026-11-30#remind-abc',
      visitReportId: 57,
      start: '2026-11-30T01:00:00.000Z',
      reportTitle: 'COSCO Shipping Heavy Industry (Shanghai)',
    },
    {
      type: 'reminder',
      title: '⏰ Prepare updated proposal',
      href: '/visit-reports/90?remindDate=2026-12-01#remind-def',
      visitReportId: 90,
      start: '2026-12-01T01:00:00.000Z',
      reportTitle: 'Earlier COSCO discussion',
    },
    { type: 'phishing', title: 'Ignore', href: 'https://evil.example/visit-reports/57' },
  ])
  assert.deepEqual(grouped.others.map((s) => s.type), ['customer', 'hot', 'phishing'])
  assert.equal(grouped.reports.length, 2)
  assert.equal(grouped.remindersByReport.get(57)?.length, 1)
  assert.equal(grouped.remindersByReport.get(57)[0].title, '⏰ Keep contact (WRC)')
  assert.equal(grouped.looseReminders.length, 1)
  assert.equal(grouped.looseReminders[0].visitReportId, 90)
  assert.equal(isSafeAppHref('/visit-reports/57?remindDate=2026-11-30#remind-abc'), true)
  assert.equal(isSafeAppHref('https://evil.example/visit-reports/57'), false)
  assert.equal(sourceTypeLabels('en').report, 'Visit report')
  assert.equal(sourceTypeLabels('zh').report, '拜访报告')
})
