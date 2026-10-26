import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('team panel still renders when a member has a next activity', async () => {
  const { TeamPanel } = await loadJsxModule(path.join(here, 'Calendar.jsx'))
  const html = renderToString(createElement(TeamPanel, {
    summary: [{
      id: 7,
      name: 'Boldoo',
      email: 'boldoo@example.com',
      focusLabel: 'Afternoon customer visit',
      nextEventStart: '2026-10-26T05:00:00.000Z',
      upcomingCount: 2,
    }],
    users: [{ id: 7, name: 'Boldoo', email: 'boldoo@example.com' }],
    selectedUserIds: [7],
    onToggleUser: () => {},
    onJumpToMemberNextEvent: () => {},
    onSelectAllUsers: () => {},
    holidayCalendars: [],
    selectedHolidayCalendarIds: [],
    onToggleHolidayCalendar: () => {},
    isAdmin: false,
  }))

  assert.match(html, /Boldoo/)
  assert.match(html, /Afternoon customer visit/)
  assert.match(html, /Oct 26/)
  assert.match(html, /title="Jump to Oct 26"/)
  assert.match(html, /2(?:<!-- -->)? upcoming activities<\/button>/)
})

test('team panel renders members who have no upcoming activity', async () => {
  const { TeamPanel } = await loadJsxModule(path.join(here, 'Calendar.jsx'))
  const html = renderToString(createElement(TeamPanel, {
    summary: [{
      id: 7,
      name: 'Boldoo',
      email: 'boldoo@example.com',
      focusLabel: 'No upcoming activity',
      nextEventStart: null,
      upcomingCount: 0,
    }],
    users: [{ id: 7, name: 'Boldoo', email: 'boldoo@example.com' }],
    selectedUserIds: [7],
    onToggleUser: () => {},
    onJumpToMemberNextEvent: () => {},
    onSelectAllUsers: () => {},
    holidayCalendars: [],
    selectedHolidayCalendarIds: [],
    onToggleHolidayCalendar: () => {},
    isAdmin: false,
  }))

  assert.match(html, /<span>0(?:<!-- -->)? upcoming activities<\/span>/)
  assert.doesNotMatch(html, /upcoming activities<\/button>/)
})

test('a calendar render error leaves a visible fallback instead of an empty page', async () => {
  const { default: CalendarErrorBoundary } = await loadJsxModule(path.join(here, 'CalendarErrorBoundary.jsx'))
  const boundary = new CalendarErrorBoundary({ children: 'calendar' })
  assert.equal(boundary.state.error, null)

  const nextState = CalendarErrorBoundary.getDerivedStateFromError(new Error('nextEventDate is not defined'))
  boundary.state = nextState
  const html = renderToString(boundary.render())

  assert.match(html, /This view couldn&#x27;t be displayed/)
  assert.match(html, /Dashboard/)
  assert.match(html, /Try again/)
  assert.doesNotMatch(html.trim(), /^$/)
})
