import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { addWeeks, format, isSameDay, parseISO, startOfWeek } from 'date-fns'
import { useAuth } from '../context/AuthContext'
import { agentsAPI, customersAPI, eventsAPI, holidaysAPI, usersAPI } from '../api/api'
import EventModal from './EventModal'
import ProfileModal from './ProfileModal'
import UserManagementModal from './UserManagementModal'

const CATEGORY_LABELS = {
  WORK_SESSION: 'Internal Coordination',
  MEETING: 'Technical Discussion',
  SALES_MEETING: 'Sales Meeting',
  FIELD_WORK: 'Customer Visit',
  BREAK: 'Final Negotiation',
  TRAINING: 'Project Execution',
  LEAVE: 'Holidays',
}

const FIXED_USER_COLOR_THEMES = {
  1: { solid: '#f59e0b', soft: '#fff9c4' },
  4: { solid: '#2563eb', soft: '#e3f2fd' },
  5: { solid: '#fb7185', soft: '#fce4ec' },
  6: { solid: '#8b5cf6', soft: '#f3e5f5' },
  9: { solid: '#14b8a6', soft: '#e0f2f1' },
  10: { solid: '#f97316', soft: '#ffe0b2' },
  15: { solid: '#22c55e', soft: '#f1f8e9' },
}

const USER_CALENDAR_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4338ca',
  '#0f766e',
  '#a16207',
  '#475569',
]

const CATEGORY_COLORS = {
  WORK_SESSION: '#475569',
  MEETING: '#0f766e',
  SALES_MEETING: '#2563eb',
  FIELD_WORK: '#ea580c',
  BREAK: '#dc2626',
  TRAINING: '#7c3aed',
  LEAVE: '#6b7280',
}

const STATUS_LABELS = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace('#', '')
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized

  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function addOneDay(value) {
  const date = new Date(value)
  date.setDate(date.getDate() + 1)
  return date
}

function subtractOneDay(value) {
  const date = new Date(value)
  date.setDate(date.getDate() - 1)
  return date
}

function getCurrentWeekMonthRange(currentDate) {
  const start = startOfWeek(currentDate, { weekStartsOn: 0 })
  return {
    start,
    end: addWeeks(start, 6),
  }
}

function getCalendarViewType(view) {
  return view === 'currentWeekMonth' ? 'dayGridMonth' : view
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#475569'
}

function getUserCalendarColor(userId, users = []) {
  if (!userId) return USER_CALENDAR_COLORS[0]
  const numericUserId = Number(userId)
  if (FIXED_USER_COLOR_THEMES[numericUserId]) {
    return FIXED_USER_COLOR_THEMES[numericUserId].solid
  }
  const index = users.findIndex((user) => user.id === numericUserId)
  if (index === -1) return USER_CALENDAR_COLORS[numericUserId % USER_CALENDAR_COLORS.length]
  return USER_CALENDAR_COLORS[index % USER_CALENDAR_COLORS.length]
}

function getUserCalendarSoftColor(userId, users = []) {
  if (!userId) return hexToRgba(USER_CALENDAR_COLORS[0], 0.12)
  const numericUserId = Number(userId)
  if (FIXED_USER_COLOR_THEMES[numericUserId]) {
    return FIXED_USER_COLOR_THEMES[numericUserId].soft
  }
  return hexToRgba(getUserCalendarColor(numericUserId, users), 0.12)
}

function buildHolidayEvents(calendars) {
  return calendars.flatMap((calendar) => calendar.events.map((holiday) => ({
    id: holiday.id,
    title: holiday.title,
    description: 'Official China public holiday calendar.',
    location: 'China',
    start: `${holiday.start}T00:00:00.000+08:00`,
    end: `${holiday.endExclusive}T00:00:00.000+08:00`,
    allDay: true,
    color: getCategoryColor('LEAVE'),
    originalColor: getCategoryColor('LEAVE'),
    calendarColor: getCategoryColor('LEAVE'),
    backgroundColor: hexToRgba(getCategoryColor('LEAVE'), 0.24),
    borderColor: getCategoryColor('LEAVE'),
    textColor: '#0f172a',
    category: 'LEAVE',
    status: 'PLANNED',
    userId: null,
    userName: calendar.label,
    isSharedHoliday: true,
    holidayCalendarId: calendar.id,
  })))
}

function formatEventTooltip(event) {
  const userName = event.extendedProps.userName || 'Unassigned'
  const title = event.title || 'Untitled activity'
  const notes = event.extendedProps.description?.trim() || 'No notes'
  const customerName = event.extendedProps.customer?.name
  const start = event.start ? format(event.start, event.allDay ? 'MM/dd/yyyy' : 'MM/dd/yyyy hh:mm aa') : 'No start date'
  const end = event.end ? format(event.end, event.allDay ? 'MM/dd/yyyy' : 'MM/dd/yyyy hh:mm aa') : 'No end date'
  const duration = `${start} - ${end}`
  const customerLine = customerName ? `\nCustomer: ${customerName}` : ''

  return `User: ${userName}\nActivity: ${title}${customerLine}\nDuration: ${duration}\nNotes: ${notes}`
}

function MiniMonth({ events, anchorDate, onJump, collapsed, onToggle }) {
  const [month, setMonth] = useState(new Date(anchorDate))

  useEffect(() => {
    setMonth(new Date(anchorDate))
  }, [anchorDate])

  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const leading = start.getDay()
  const days = Array.from({ length: leading + end.getDate() }, (_, index) => {
    if (index < leading) return null
    return new Date(month.getFullYear(), month.getMonth(), index - leading + 1)
  })

  const marked = new Set(events.map((event) => new Date(event.start).toDateString()))

  return (
    <section className="workspace-panel rounded-[28px] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onToggle && (
            <button onClick={onToggle} className="rounded-full border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100">
              <svg className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-100">
            Prev
          </button>
        </div>
        <div className={classNames('text-center', onToggle && 'order-last')}>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Navigator</p>
          <h3 className="text-base font-semibold text-slate-900">{format(month, 'MMMM yyyy')}</h3>
        </div>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-100">
          Next
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label) => <div key={label}>{label}</div>)}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-2">
            {days.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="h-10" />
              }

              const isToday = isSameDay(day, new Date())
              const isMarked = marked.has(day.toDateString())

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => onJump(day)}
                  className={classNames(
                    'relative h-10 rounded-2xl text-sm font-medium transition',
                    isToday ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                  )}
                >
                  {day.getDate()}
                  {isMarked && (
                    <span className={classNames('absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full', isToday ? 'bg-sky-300' : 'bg-sky-600')} />
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function TeamPanel({ summary, users, selectedUserIds, onToggleUser, onSelectAllUsers, holidayCalendars, selectedHolidayCalendarIds, onToggleHolidayCalendar, isAdmin }) {
  if (!summary.length) return null

  const isAllSelected = selectedUserIds === null
  const isNoneSelected = Array.isArray(selectedUserIds) && selectedUserIds.length === 0

  return (
    <section className="workspace-panel rounded-[28px] p-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{isAdmin ? 'Employee activity' : 'Team activity'}</h3>
        </div>
        <button
          onClick={onSelectAllUsers}
          className={classNames(
            'rounded-full px-3 py-1 text-sm font-medium transition',
            isAllSelected ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          {isAllSelected ? 'Clear' : 'All'}
        </button>
      </div>

      {isNoneSelected && (
        <div className="mb-3 rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
          No employees selected.
        </div>
      )}

      <div className="space-y-3">
        {summary.map((member) => {
          const isSelected = isAllSelected || selectedUserIds.includes(member.id)
          const userColor = getUserCalendarColor(member.id, users)

          return (
          <label
            key={member.id}
            className={classNames(
              'flex cursor-pointer gap-3 rounded-3xl border px-4 py-3 text-left transition',
              isSelected ? 'text-slate-950' : 'border-slate-200 bg-slate-50 hover:border-slate-300',
            )}
            style={isSelected ? { borderColor: hexToRgba(userColor, 0.35), backgroundColor: getUserCalendarSoftColor(member.id, users) } : undefined}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleUser(member.id)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: userColor }} />
                    <p className="truncate font-semibold">{member.name}</p>
                  </div>
                  <p className={classNames('truncate text-sm', isSelected ? 'text-slate-700' : 'text-slate-500')}>{member.focusLabel}</p>
                </div>
              </div>
              <div className={classNames('mt-3 flex gap-2 text-xs', isSelected ? 'text-slate-700' : 'text-slate-500')}>
                <span>{member.upcomingCount} upcoming activities</span>
              </div>
            </div>
          </label>
          )
        })}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-slate-900">Holiday calendars</h4>
          <p className="mt-1 text-xs text-slate-500">Overlay shared holiday schedules on every calendar view.</p>
        </div>

        <div className="space-y-3">
          {holidayCalendars.map((calendar) => {
            const isSelected = selectedHolidayCalendarIds.includes(calendar.id)

            return (
              <label
                key={calendar.id}
                className={classNames(
                  'flex gap-3 rounded-3xl border px-4 py-3 text-left transition',
                  calendar.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                  isSelected ? 'border-sky-200 bg-sky-50 text-slate-950' : 'border-slate-200 bg-slate-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => calendar.enabled && onToggleHolidayCalendar(calendar.id)}
                  disabled={!calendar.enabled}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getCategoryColor('LEAVE') }} />
                    <p className="truncate font-semibold">{calendar.label}</p>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-500">{calendar.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FiltersPanel({ selectedCategory, setSelectedCategory }) {
  return (
    <section className="workspace-panel workspace-panel--filter rounded-[22px] border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Filters</span>
        <select
          value={selectedCategory}
          onChange={(event) => setSelectedCategory(event.target.value)}
          className="w-full max-w-[360px] rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-slate-50"
        >
          <option value="ALL">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </section>
  )
}

function ExpandedCalendarModal({ isOpen, activeUser, events, initialDate, initialView, onClose, onEventDoubleClick, onDateDoubleClick, onEventMutation, users, canEditActivities }) {
  if (!isOpen || !activeUser) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex h-[94vh] w-full max-w-[1600px] flex-col overflow-y-auto rounded-[24px] border border-slate-200 bg-white shadow-2xl sm:rounded-[30px]">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Expanded Calendar View</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                <h2 className="truncate text-lg font-semibold text-slate-950 sm:text-xl">{activeUser.name}</h2>
                <p className="truncate text-sm text-slate-500">· {activeUser.email}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 p-2.5 sm:p-4">
          <FullCalendar
            key={`${activeUser.id}-${initialView}-${initialDate.toISOString()}`}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
            initialView={initialView}
            initialDate={initialDate}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'timeGridDay,timeGridWeek,currentWeekMonth,listWeek',
            }}
            buttonText={{
              today: 'Today',
              timeGridDay: 'Day',
              timeGridWeek: 'Week',
              currentWeekMonth: 'Month',
              listWeek: 'Agenda',
            }}
            views={{
              currentWeekMonth: {
                type: 'dayGrid',
                visibleRange: getCurrentWeekMonthRange,
                dateIncrement: { months: 1 },
                titleFormat: { month: 'long', year: 'numeric' },
              },
              listWeek: { buttonText: 'Agenda' },
            }}
            nowIndicator
            noEventsContent="No events to display in the selected period"
            events={events}
            editable={canEditActivities}
            selectable={false}
            slotEventOverlap={false}
            dayMaxEvents={4}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            allDaySlot
            height="calc(100vh - 165px)"
            dateClick={onDateDoubleClick}
            eventClick={onEventDoubleClick}
            eventDrop={canEditActivities ? onEventMutation : undefined}
            eventResize={canEditActivities ? onEventMutation : undefined}
            eventDidMount={(info) => {
              info.el.style.setProperty('--calendar-user-color', info.event.extendedProps.calendarColor || info.event.borderColor || '#0f6cbd')
              info.el.title = formatEventTooltip(info.event)
            }}
            eventContent={(info) => {
              const viewType = info.view.type
              const showStatus = viewType === 'listWeek'
              const isMonthView = viewType === 'dayGridMonth' || viewType === 'currentWeekMonth'
              const isTimeGridView = viewType === 'timeGridWeek' || viewType === 'timeGridDay'
              const startTimeText = !info.event.allDay && info.timeText ? info.timeText.split(' - ')[0] : ''
              const titleWithTime = startTimeText ? `${startTimeText} ${info.event.title}` : info.event.title
              const customerName = info.event.extendedProps.customer?.name

              return (
                <div className="fc-activity-card">
                  <div className="fc-activity-card__header">
                    <span className={classNames('fc-activity-card__title', isTimeGridView && 'fc-activity-card__title--multiline')}>
                      {isMonthView ? titleWithTime : info.event.title}
                    </span>
                    {showStatus && (
                      <span className="fc-activity-card__status">{STATUS_LABELS[info.event.extendedProps.status]}</span>
                    )}
                  </div>
                  {isTimeGridView && info.event.extendedProps.location && (
                    <div className="fc-activity-card__meta">
                      <span>{info.event.extendedProps.location}</span>
                    </div>
                  )}
                  {(isTimeGridView || showStatus) && customerName && (
                    <div className="fc-activity-card__meta">
                      <span className="fc-activity-card__customer">{customerName}</span>
                    </div>
                  )}
                  {showStatus && (
                    <div className="fc-activity-card__meta">
                      <span>{CATEGORY_LABELS[info.event.extendedProps.category]}</span>
                    </div>
                  )}
                </div>
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default function Calendar() {
  const SIDEBAR_COLLAPSE_BREAKPOINT = 1080
  const SPLIT_VIEW_BREAKPOINT = 1220
  const { logout, user, updateUser } = useAuth()
  const navigate = useNavigate()
  const calendarRef = useRef(null)
  const selectedCellElementsRef = useRef([])
  const todayKeyRef = useRef(format(new Date(), 'yyyy-MM-dd'))
  const isAdmin = user?.isAdmin === true
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  const [allEvents, setAllEvents] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [users, setUsers] = useState([])
  const [customers, setCustomers] = useState([])
  const [agents, setAgents] = useState([])
  const [summary, setSummary] = useState([])
  const [holidayCalendars, setHolidayCalendars] = useState([])
  const [adminNotices, setAdminNotices] = useState([])
  const [selectedUserIds, setSelectedUserIds] = useState(null)
  const [selectedHolidayCalendarIds, setSelectedHolidayCalendarIds] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [selectedStatus, setSelectedStatus] = useState('ALL')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [currentView, setCurrentView] = useState('timeGridWeek')
  const [calendarTitle, setCalendarTitle] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [userManagerOpen, setUserManagerOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [expandedCalendarUser, setExpandedCalendarUser] = useState(null)
  const [selectedSlotEvent, setSelectedSlotEvent] = useState(null)
  const [hasInitializedUserSelection, setHasInitializedUserSelection] = useState(false)
  const [hasInitializedHolidaySelection, setHasInitializedHolidaySelection] = useState(false)
  const deferredCategory = useDeferredValue(selectedCategory)
  const deferredStatus = useDeferredValue(selectedStatus)
  const isTablet = viewportWidth < SIDEBAR_COLLAPSE_BREAKPOINT
  const isPhone = viewportWidth < 768
  const showDrawer = isPhone || isTablet
  const canCreateActivities = true
  const canEditActivities = true

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (viewportWidth < SIDEBAR_COLLAPSE_BREAKPOINT) {
      setSidebarCollapsed(true)
    }
  }, [viewportWidth])

  useEffect(() => {
    if (!showDrawer) {
      setMenuOpen(false)
    }
  }, [showDrawer])

  useEffect(() => {
    function syncTodayAnchor() {
      const today = new Date()
      const todayKey = format(today, 'yyyy-MM-dd')
      if (todayKeyRef.current === todayKey) return

      todayKeyRef.current = todayKey
      setCurrentDate(today)
      calendarRef.current?.getApi()?.gotoDate(today)
    }

    window.addEventListener('focus', syncTodayAnchor)
    document.addEventListener('visibilitychange', syncTodayAnchor)

    return () => {
      window.removeEventListener('focus', syncTodayAnchor)
      document.removeEventListener('visibilitychange', syncTodayAnchor)
    }
  }, [])

  async function loadEvents() {
    const response = await eventsAPI.getAll()
    const mappedEvents = response.data.map((item) => ({
      ...item,
      start: item.start,
      end: item.allDay ? addOneDay(item.end).toISOString() : item.end,
      rawStart: item.start,
      rawEnd: item.end,
      userId: item.user?.id ?? item.userId,
      userName: item.user?.name,
      originalColor: item.color,
      calendarColor: getUserCalendarColor(item.user?.id ?? item.userId, users),
      backgroundColor: hexToRgba(getUserCalendarColor(item.user?.id ?? item.userId, users), 0.24),
      borderColor: getUserCalendarColor(item.user?.id ?? item.userId, users),
      textColor: '#0f172a',
    }))

    setAllEvents(mappedEvents)
  }

  async function loadUsers() {
    const response = isAdmin ? await usersAPI.getAll() : await usersAPI.getVisible()
    setUsers(response.data)
  }

  async function loadCustomers() {
    const response = await customersAPI.getAll()
    setCustomers(response.data)
  }

  async function loadAgents() {
    const response = await agentsAPI.getAll()
    setAgents(response.data)
  }

  async function loadHolidayCalendars() {
    const response = await holidaysAPI.getCalendars()
    setHolidayCalendars(response.data)
  }

  async function loadAdminNotices() {
    if (!isAdmin) {
      setAdminNotices([])
      return
    }

    const response = await usersAPI.getAdminNotices()
    setAdminNotices(response.data)
  }

  async function loadSummary() {
    if (!isAdmin) return
    const response = await usersAPI.getActivitySummary()
    setSummary(response.data)
  }

  async function loadInitialData() {
    setIsLoading(true)
    setLoadError(false)
    try {
      await Promise.all([
        loadEvents(),
        loadUsers(),
        loadCustomers(),
        loadAgents(),
        loadHolidayCalendars(),
        loadAdminNotices(),
        loadSummary(),
      ])
    } catch (error) {
      console.error('Failed to load calendar data', error)
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadInitialData()
  }, [isAdmin])

  useEffect(() => {
    if (users.length === 0) return

    setAllEvents((prev) => prev.map((item) => {
      const userColor = getUserCalendarColor(item.userId, users)
      return {
        ...item,
        calendarColor: userColor,
        backgroundColor: hexToRgba(userColor, 0.24),
        borderColor: userColor,
      }
    }))
  }, [users])

  const holidayEvents = useMemo(
    () => buildHolidayEvents(
      holidayCalendars.filter((calendar) => calendar.enabled && selectedHolidayCalendarIds.includes(calendar.id))
    ),
    [holidayCalendars, selectedHolidayCalendarIds],
  )

  const visibleEvents = useMemo(() => {
    const filteredUserEvents = allEvents.filter((event) => {
      if (selectedUserIds !== null && !selectedUserIds.includes(event.userId)) return false
      if (deferredCategory !== 'ALL' && event.category !== deferredCategory) return false
      if (deferredStatus !== 'ALL' && event.status !== deferredStatus) return false
      return true
    })

    const filteredHolidayEvents = holidayEvents.filter((event) => {
      if (deferredCategory !== 'ALL' && event.category !== deferredCategory) return false
      if (deferredStatus !== 'ALL' && event.status !== deferredStatus) return false
      return true
    })

    return [...filteredUserEvents, ...filteredHolidayEvents]
  }, [allEvents, holidayEvents, selectedUserIds, deferredCategory, deferredStatus])

  const todayActivities = useMemo(
    () => visibleEvents.filter((event) => isSameDay(parseISO(event.start), currentDate)).slice(0, 5),
    [visibleEvents, currentDate],
  )

  const teamSummary = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    return users.map((member) => {
      const memberEvents = allEvents.filter((event) => (
        event.userId === member.id
        && !event.isSharedHoliday
        && event.category !== 'LEAVE'
      ))
      const upcomingEvents = memberEvents
        .filter((event) => {
          const endDate = parseISO(event.rawEnd || event.rawStart || event.end || event.start)
          return endDate >= todayStart
        })
        .sort((left, right) => parseISO(left.start).getTime() - parseISO(right.start).getTime())
      const active = upcomingEvents.find((event) => event.status === 'IN_PROGRESS')
      const blockedCount = memberEvents.filter((event) => event.status === 'BLOCKED').length
      const plannedCount = memberEvents.filter((event) => event.status === 'PLANNED').length
      const doneCount = memberEvents.filter((event) => event.status === 'DONE').length
      const nextEvent = active || upcomingEvents[0]

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        activeStatus: nextEvent?.status || (blockedCount > 0 ? 'BLOCKED' : plannedCount > 0 ? 'PLANNED' : 'DONE'),
        focusLabel: nextEvent?.title || 'No upcoming activity',
        blockedCount,
        plannedCount,
        doneCount,
        upcomingCount: upcomingEvents.length,
      }
    }).sort((left, right) => {
      if (left.id === user?.id) return -1
      if (right.id === user?.id) return 1
      return left.name.localeCompare(right.name)
    })
  }, [allEvents, user?.id, users])

  const activeUsers = useMemo(() => {
    if (selectedUserIds === null) {
      return users
    }

    return users.filter((member) => selectedUserIds.includes(member.id))
  }, [selectedUserIds, users])

  const splitCalendarView = viewportWidth >= SPLIT_VIEW_BREAKPOINT && (currentView === 'timeGridWeek' || currentView === 'timeGridDay') && activeUsers.length > 0
  const expandedCalendarEvents = useMemo(
    () => expandedCalendarUser ? visibleEvents.filter((event) => event.userId === expandedCalendarUser.id) : [],
    [expandedCalendarUser, visibleEvents],
  )
  const calendarEventsWithSelection = useMemo(
    () => selectedSlotEvent ? [...visibleEvents, selectedSlotEvent] : visibleEvents,
    [visibleEvents, selectedSlotEvent],
  )
  const expandedCalendarEventsWithSelection = useMemo(
    () => selectedSlotEvent ? [...expandedCalendarEvents, selectedSlotEvent] : expandedCalendarEvents,
    [expandedCalendarEvents, selectedSlotEvent],
  )
  const singleCalendarHeight = isPhone ? 'calc(100vh - 145px)' : 'calc(100vh - 90px)'
  const splitCalendarHeight = isPhone ? 'calc(100vh - 175px)' : 'calc(100vh - 105px)'

  useEffect(() => {
    if (!splitCalendarView) {
      setExpandedCalendarUser(null)
    }
  }, [splitCalendarView])

  useEffect(() => {
    if (isAdmin) return
    if (hasInitializedUserSelection) return
    if (!user?.id) return
    if (users.length === 0) return

    setSelectedUserIds([user.id])
    setHasInitializedUserSelection(true)
  }, [hasInitializedUserSelection, isAdmin, user, users])

  useEffect(() => {
    if (hasInitializedHolidaySelection) return
    if (holidayCalendars.length === 0) return

    setSelectedHolidayCalendarIds(holidayCalendars.filter((calendar) => calendar.enabled).map((calendar) => calendar.id))
    setHasInitializedHolidaySelection(true)
  }, [hasInitializedHolidaySelection, holidayCalendars])

  function openNewActivity(dateInfo) {
    if (!canCreateActivities) return
    const startDate = dateInfo.date ? dateInfo.date : dateInfo
    const endDate = new Date(startDate)
    if (dateInfo.allDay) {
      endDate.setDate(endDate.getDate() + 1)
    } else {
      endDate.setHours(endDate.getHours() + 1)
    }

    const targetUserId = Array.isArray(selectedUserIds) && selectedUserIds.length === 1 ? selectedUserIds[0] : user?.id
    setSelectedEvent({
      title: '',
      description: '',
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      allDay: Boolean(dateInfo.allDay),
      color: getUserCalendarColor(targetUserId, users),
      category: 'WORK_SESSION',
      status: 'PLANNED',
      userId: targetUserId,
    })
    setModalOpen(true)
  }

  function openExistingActivity(clickInfo) {
    if (clickInfo?.jsEvent?.detail && clickInfo.jsEvent.detail < 2) return
    const event = clickInfo.event
    const targetUserId = event.extendedProps.userId
    const canEditTargetEvent = isAdmin || targetUserId === user?.id
    setSelectedEvent({
      id: Number(event.id),
      title: event.title,
      description: event.extendedProps.description || '',
      location: event.extendedProps.location || '',
      start: event.startStr,
      end: event.allDay
        ? subtractOneDay(event.endStr || event.startStr).toISOString()
        : (event.endStr || event.startStr),
      allDay: event.allDay,
      color: getUserCalendarColor(event.extendedProps.userId, users),
      category: event.extendedProps.category,
      status: event.extendedProps.status,
      userId: event.extendedProps.userId,
      customerId: event.extendedProps.customerId ?? null,
      agentId: event.extendedProps.agentId ?? null,
      readOnly: !canEditTargetEvent,
    })
    setModalOpen(true)
  }

  async function handleSaveActivity(payload) {
    if (payload.id && payload.userId !== user?.id && !isAdmin) return
    const userColor = getUserCalendarColor(payload.userId, users)
    const payloadWithCategoryColor = {
      ...payload,
      color: userColor,
    }
    try {
      if (payload.id) {
        await eventsAPI.update(payload.id, payloadWithCategoryColor)
      } else {
        await eventsAPI.create(payloadWithCategoryColor)
      }
      await Promise.all([loadEvents(), loadSummary()])
      setModalOpen(false)
      setSelectedEvent(null)
    } catch (error) {
      console.error('Failed to save activity', error)
      alert('Failed to save activity')
    }
  }

  async function handleCalendarMutation(changeInfo) {
    const event = changeInfo.event
    if (!isAdmin && event.extendedProps.userId !== user?.id) {
      changeInfo.revert()
      return
    }
    try {
      await eventsAPI.update(event.id, {
        title: event.title,
        description: event.extendedProps.description || '',
        location: event.extendedProps.location || '',
        start: event.start?.toISOString(),
        end: event.allDay
          ? subtractOneDay(event.end || event.start).toISOString()
          : (event.end || event.start)?.toISOString(),
        allDay: event.allDay,
        color: getUserCalendarColor(event.extendedProps.userId, users),
        category: event.extendedProps.category,
        status: event.extendedProps.status,
        userId: event.extendedProps.userId,
        customerId: event.extendedProps.customerId ?? null,
        agentId: event.extendedProps.agentId ?? null,
      })
      await Promise.all([loadEvents(), loadSummary()])
    } catch (error) {
      console.error('Failed to update activity timing', error)
      changeInfo.revert()
    }
  }

  async function handleDeleteActivity() {
    if (!selectedEvent?.id) return
    if (selectedEvent.userId !== user?.id && !isAdmin) return
    if (!window.confirm('Delete this activity record?')) return

    try {
      await eventsAPI.delete(selectedEvent.id)
      await Promise.all([loadEvents(), loadSummary()])
      setModalOpen(false)
      setSelectedEvent(null)
    } catch (error) {
      console.error('Failed to delete activity', error)
      alert('Failed to delete activity')
    }
  }

  function clearSelectedCellHighlight() {
    selectedCellElementsRef.current.forEach((element) => {
      element.classList.remove('fc-slot-selection-cell')
    })
    selectedCellElementsRef.current = []
  }

  function applySelectedCellHighlight(dateInfo) {
    clearSelectedCellHighlight()

    const pointerTarget = (() => {
      const mouseEvent = dateInfo?.jsEvent
      if (!mouseEvent || typeof document === 'undefined') return null
      const elements = document.elementsFromPoint(mouseEvent.clientX, mouseEvent.clientY)
      return elements.find((element) => element instanceof HTMLElement && element.matches('td.fc-daygrid-day')) || null
    })()

    const gridCell = pointerTarget || dateInfo?.dayEl
    if (gridCell instanceof HTMLElement) {
      gridCell.classList.add('fc-slot-selection-cell')
      selectedCellElementsRef.current = [gridCell]
    }
  }

  function applyTimeGridCellHighlight(dateInfo) {
    clearSelectedCellHighlight()

    const mouseEvent = dateInfo?.jsEvent
    const slotLane = mouseEvent && typeof document !== 'undefined'
      ? document.elementsFromPoint(mouseEvent.clientX, mouseEvent.clientY)
        .find((element) => element instanceof HTMLElement && element.matches('td.fc-timegrid-slot-lane'))
      : null
    if (slotLane instanceof HTMLElement) {
      slotLane.classList.add('fc-slot-selection-cell')
      selectedCellElementsRef.current = [slotLane]
    }
  }

  function jumpToDate(date) {
    clearSelectedCellHighlight()
    setSelectedSlotEvent(null)
    setCurrentDate(date)
    setCurrentView('timeGridDay')
    const api = calendarRef.current?.getApi()
    if (!api) return
    api.gotoDate(date)
    api.changeView('timeGridDay')
  }

  async function handleCreateUser(payload) {
    await usersAPI.create(payload)
    await Promise.all([loadUsers(), loadSummary()])
  }

  async function handleUpdateUser(userId, payload) {
    const response = await usersAPI.update(userId, payload)
    await Promise.all([loadUsers(), loadSummary(), loadEvents()])

    if (user?.id === userId) {
      updateUser({
        ...user,
        name: response.data.name,
        email: response.data.email,
        isAdmin: response.data.isAdmin,
      })
    }
  }

  async function handleDeleteUser(targetUser) {
    await usersAPI.delete(targetUser.id)
    await Promise.all([loadUsers(), loadSummary(), loadEvents()])

    setSelectedUserIds((prev) => {
      if (prev === null) return null
      return prev.filter((userId) => userId !== targetUser.id)
    })
  }

  function handleToggleUser(userId) {
    setSelectedUserIds((prev) => {
      if (prev === null) {
        const allOtherIds = teamSummary.map((member) => member.id).filter((id) => id !== userId)
        return allOtherIds
      }

      if (prev.includes(userId)) {
        const next = prev.filter((id) => id !== userId)
        return next.length === 0 ? [] : next
      }

      return [...prev, userId]
    })
  }

  function handleSelectAllUsers() {
    setSelectedUserIds((prev) => (prev === null ? [] : null))
  }

  function handleToggleHolidayCalendar(calendarId) {
    setSelectedHolidayCalendarIds((prev) => (
      prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId]
    ))
  }

  async function handleUpdateProfile(payload) {
    const response = await usersAPI.updateMe(payload)
    updateUser({
      ...user,
      name: response.data.name,
      email: response.data.email,
      isAdmin: response.data.isAdmin,
    })
    await Promise.all([loadUsers(), loadSummary(), loadEvents()])
  }

  async function handleDismissAdminNotice(noticeId) {
    try {
      await usersAPI.dismissAdminNotice(noticeId)
      setAdminNotices((prev) => prev.filter((notice) => notice.id !== noticeId))
    } catch (error) {
      console.error('Failed to dismiss admin notice', error)
    }
  }

  function handleConfirmLogout() {
    setLogoutConfirmOpen(false)
    logout()
  }

  function navigateCalendar(action) {
    if (!splitCalendarView) {
      const api = calendarRef.current?.getApi()
      if (!api) return

      if (action === 'today') {
        const today = new Date()
        api.today()
        setCurrentDate(today)
      }
      if (action === 'prev') api.prev()
      if (action === 'next') api.next()
      return
    }

    if (action === 'today') {
      setCurrentDate(new Date())
      return
    }

    setCurrentDate((prev) => {
      const next = new Date(prev)
      if (currentView === 'currentWeekMonth') {
        next.setMonth(next.getMonth() + (action === 'next' ? 1 : -1))
        return next
      }

      const delta = currentView === 'timeGridDay' ? 1 : 7
      next.setDate(next.getDate() + (action === 'next' ? delta : -delta))
      return next
    })
  }

  function changeCalendarView(view) {
    setCurrentView(view)

    if (splitCalendarView && (view === 'timeGridWeek' || view === 'timeGridDay')) {
      return
    }

    const api = calendarRef.current?.getApi()
    if (!api) return
    api.changeView(view)
  }

  function handleDateDoubleClick(dateInfo) {
    const viewType = getCalendarViewType(dateInfo?.view?.type || currentView)
    const isTimeGridSlot = Boolean(dateInfo?.date && !dateInfo?.allDay && (viewType === 'timeGridWeek' || viewType === 'timeGridDay'))

    if (isTimeGridSlot) {
      setSelectedSlotEvent(null)
      applyTimeGridCellHighlight(dateInfo)
    } else {
      setSelectedSlotEvent(null)
      applySelectedCellHighlight(dateInfo)
    }

    if (dateInfo?.jsEvent?.detail && dateInfo.jsEvent.detail < 2) return
    openNewActivity(dateInfo)
  }

  const sidebarContent = (
    <>
      <MiniMonth events={visibleEvents} anchorDate={currentDate} onJump={jumpToDate} collapsed={navigatorCollapsed} onToggle={() => setNavigatorCollapsed(!navigatorCollapsed)} />
      <TeamPanel
        summary={teamSummary}
        users={users}
        selectedUserIds={selectedUserIds}
        onToggleUser={handleToggleUser}
        onSelectAllUsers={handleSelectAllUsers}
        holidayCalendars={holidayCalendars}
        selectedHolidayCalendarIds={selectedHolidayCalendarIds}
        onToggleHolidayCalendar={handleToggleHolidayCalendar}
        isAdmin={isAdmin}
      />

      <section className="workspace-panel workspace-panel--compact rounded-[28px] p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Today</p>
            <h3 className="text-lg font-semibold text-slate-900">{format(currentDate, 'EEEE, MMM d')}</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{todayActivities.length} items</span>
        </div>

        <div className="mt-4 space-y-3">
          {todayActivities.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
              No activity records for the selected day.
            </div>
          )}
          {todayActivities.map((event) => (
            <button
              key={event.id}
              onClick={() => {
                setSelectedEvent(event)
                setModalOpen(true)
                if (showDrawer) {
                  setMenuOpen(false)
                }
              }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{event.title}</p>
              </div>
              <p className="mt-1 text-sm text-slate-500">{event.userName || user?.name} · {CATEGORY_LABELS[event.category]}</p>
            </button>
          ))}
        </div>
      </section>
    </>
  )

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-5">
        <header className="banner-simple relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-900 shadow-sm sm:rounded-2xl sm:px-6 sm:py-4 md:px-7">
          <div className="relative flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl min-w-0">
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-slate-400">Activity Tracker</p>
                <p className="max-w-3xl text-[1rem] font-medium leading-6 text-slate-700 sm:text-[1.08rem] sm:leading-7 xl:text-[1.15rem]">
                  Shared planning workspace for sales teams and project execution staff.
                </p>
              </div>
            </div>

            <div className="flex w-full flex-wrap gap-2 sm:gap-3 xl:w-auto xl:max-w-[620px] xl:justify-end">
              {showDrawer && (
                <button
                  onClick={() => setMenuOpen(true)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-50"
                  title="Show menu"
                >
                  <svg className="h-5 w-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
                title="Back to module selection"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Modules
              </button>
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                {user?.name || user?.email || 'User'}
              </button>
              {isAdmin && (
                <button
                  onClick={() => setUserManagerOpen(true)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 sm:px-5 sm:py-2.5"
                >
                  Manage staff
                </button>
              )}
              {canCreateActivities && (
                <button
                  onClick={() => openNewActivity(new Date())}
                  className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 sm:px-5 sm:py-2.5"
                >
                  New activity
                </button>
              )}
              <button
                onClick={() => setLogoutConfirmOpen(true)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 sm:px-5 sm:py-2.5"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {isAdmin && adminNotices.length > 0 && (
          <section className="space-y-3">
            {adminNotices.map((notice) => (
              <div
                key={notice.id}
                className="rounded-[24px] border border-sky-200 bg-[linear-gradient(135deg,_rgba(224,242,254,0.96),_rgba(239,246,255,0.92))] px-4 py-4 shadow-[0_14px_34px_rgba(14,116,144,0.08)] sm:px-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white">
                        Admin Notice
                      </span>
                      {notice.publishedAt && (
                        <span className="text-xs font-medium text-slate-500">
                          Published {notice.publishedAt}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">{notice.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">{notice.message}</p>
                    {notice.sourceUrl && (
                      <a
                        href={notice.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex text-sm font-semibold text-sky-700 transition hover:text-sky-800"
                      >
                        View official notice
                      </a>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDismissAdminNotice(notice.id)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {showDrawer && (
          <div
            className={classNames(
              'fixed inset-0 z-50 transition-all duration-300 ease-out',
              menuOpen ? 'pointer-events-auto bg-slate-950/35 backdrop-blur-[2px]' : 'pointer-events-none bg-transparent backdrop-blur-0',
            )}
            onClick={() => setMenuOpen(false)}
          >
            <aside
              className={classNames(
                'h-full w-[min(360px,88vw)] overflow-y-auto border-r border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out',
                menuOpen ? 'translate-x-0' : '-translate-x-full',
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
                <span className="text-sm font-semibold text-slate-700">Menu</span>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-50"
                >
                  <svg className="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-5 p-4">
                {sidebarContent}
              </div>
            </aside>
          </div>
        )}

        <div className={classNames('grid gap-4', sidebarCollapsed ? 'lg:grid-cols-[8px,minmax(0,1fr)]' : 'lg:grid-cols-[340px,8px,minmax(0,1fr)]')}>
          {!sidebarCollapsed && !showDrawer && (
            <aside className="space-y-5 lg:min-w-0">
              {sidebarContent}
            </aside>
          )}

          {!sidebarCollapsed && !showDrawer && (
            <div className="hidden lg:flex items-start justify-center pt-8">
              <div
                onClick={() => setSidebarCollapsed(true)}
                className="group flex h-28 w-6 cursor-pointer flex-col items-center justify-center gap-2 rounded-r-lg bg-slate-100 transition-all hover:bg-slate-200"
                title="Hide sidebar"
              >
                <span className="text-lg font-bold text-slate-500 transition-transform group-hover:translate-x-1">«</span>
              </div>
            </div>
          )}

          {sidebarCollapsed && !showDrawer && (
            <div className="hidden lg:flex items-start justify-center pt-2">
              <div
                onClick={() => setSidebarCollapsed(false)}
                className="group flex h-28 w-6 cursor-pointer flex-col items-center justify-center gap-2 rounded-r-lg bg-slate-100 transition-all hover:bg-slate-200"
                title="Show sidebar"
              >
                <span className="text-lg font-bold text-slate-500 transition-transform group-hover:-translate-x-1">»</span>
              </div>
            </div>
          )}

          <main className="workspace-shell min-w-0 rounded-[24px] p-3 sm:rounded-[32px] sm:p-4">
            <div className="mb-4">
              <FiltersPanel
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
              />
            </div>

            {loadError ? (
              <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                <p className="text-base font-semibold text-slate-700">Unable to load calendar data</p>
                <p className="max-w-sm text-sm text-slate-500">Something went wrong while fetching activities. Check your connection and try again.</p>
                <button
                  type="button"
                  onClick={loadInitialData}
                  className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Retry
                </button>
              </div>
            ) : isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
                <p className="text-sm font-medium text-slate-500">Loading activities…</p>
              </div>
            ) : splitCalendarView ? (
              <div className="space-y-4">
                <div className="workspace-toolbar flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigateCalendar('prev')}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold text-slate-700 transition hover:bg-slate-50"
                      aria-label="Previous"
                    >
                      &lt;
                    </button>
                    <button onClick={() => navigateCalendar('next')} className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold text-slate-700 transition hover:bg-slate-50" aria-label="Next">
                      &gt;
                    </button>
                    <button onClick={() => navigateCalendar('today')} className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
                      Today
                    </button>
                  </div>

                  <h2 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{calendarTitle}</h2>

                  <div className="flex overflow-x-auto rounded-full border border-slate-200">
                    {[
                      ['timeGridDay', 'Day'],
                      ['timeGridWeek', 'Week'],
                      ['currentWeekMonth', 'Month'],
                      ['listWeek', 'Agenda'],
                    ].map(([view, label]) => (
                      <button
                        key={view}
                        onClick={() => changeCalendarView(view)}
                        className={classNames(
                          'px-4 py-2 text-sm font-semibold transition',
                          currentView === view || (view === 'currentWeekMonth' && currentView === 'dayGridMonth') ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="grid min-w-max gap-4" style={{ gridTemplateColumns: `repeat(${activeUsers.length}, minmax(${isTablet ? 280 : 320}px, 1fr))` }}>
                    {activeUsers.map((activeUser, index) => {
                      const userEvents = visibleEvents.filter((event) => event.isSharedHoliday || event.userId === activeUser.id)
                      const userColor = getUserCalendarColor(activeUser.id, users)

                      return (
                        <section
                          key={activeUser.id}
                          onClick={() => setExpandedCalendarUser(activeUser)}
                          className="workspace-user-calendar overflow-hidden rounded-[26px] transition"
                        >
                          <div className="workspace-user-calendar__header flex items-center justify-between gap-3 px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: userColor }} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">{activeUser.name}</p>
                              <p className="truncate text-xs text-slate-500">{activeUser.email}</p>
                            </div>
                            </div>
                            <span className="workspace-user-calendar__badge rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                              Open
                            </span>
                          </div>

                          <FullCalendar
                            key={`${activeUser.id}-${currentView}-${currentDate.toISOString()}`}
                            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                            initialView={currentView}
                            initialDate={currentDate}
                            headerToolbar={false}
                            nowIndicator
                            events={expandedCalendarUser?.id === activeUser.id ? expandedCalendarEventsWithSelection : userEvents}
                            editable={false}
                            selectable={false}
                            slotEventOverlap={false}
                            dayMaxEvents={4}
                            slotMinTime="00:00:00"
                            slotMaxTime="24:00:00"
                            allDaySlot
                            height={splitCalendarHeight}
                            views={{
                              currentWeekMonth: {
                                type: 'dayGrid',
                                visibleRange: getCurrentWeekMonthRange,
                                dateIncrement: { months: 1 },
                                titleFormat: { month: 'long', year: 'numeric' },
                              },
                            }}
                            eventDidMount={(info) => {
                              info.el.style.setProperty('--calendar-user-color', info.event.extendedProps.calendarColor || info.event.borderColor || '#0f6cbd')
                              info.el.title = formatEventTooltip(info.event)
                            }}
                            datesSet={(info) => {
                              if (index !== 0) return
                              const anchorDate = info.view.calendar.getDate()
                              setCurrentDate(anchorDate)
                              setCurrentView(info.view.type)
                              setCalendarTitle(info.view.title)
                            }}
                            eventContent={(info) => {
                              return (
                                <div className="fc-activity-card">
                                  <div className="fc-activity-card__header">
                                    <span className="fc-activity-card__title fc-activity-card__title--multiline">{info.event.title}</span>
                                  </div>
                                  {info.event.extendedProps.location && (
                                    <div className="fc-activity-card__meta">
                                      <span>{info.event.extendedProps.location}</span>
                                    </div>
                                  )}
                                  {info.event.extendedProps.customer?.name && (
                                    <div className="fc-activity-card__meta">
                                      <span className="fc-activity-card__customer">{info.event.extendedProps.customer.name}</span>
                                    </div>
                                  )}
                                </div>
                              )
                            }}
                          />
                        </section>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                initialView={currentView}
                initialDate={currentDate}
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'timeGridDay,timeGridWeek,currentWeekMonth,listWeek',
                }}
                buttonText={{
                  today: 'Today',
                  timeGridDay: 'Day',
                  timeGridWeek: 'Week',
                  currentWeekMonth: 'Month',
                  listWeek: 'Agenda',
                }}
                views={{
                  currentWeekMonth: {
                    type: 'dayGrid',
                    visibleRange: getCurrentWeekMonthRange,
                    dateIncrement: { months: 1 },
                    titleFormat: { month: 'long', year: 'numeric' },
                  },
                  listWeek: { buttonText: 'Agenda' },
                }}
                nowIndicator
                noEventsContent="No events to display in the selected period"
                events={calendarEventsWithSelection}
                editable={canEditActivities}
                selectable={false}
                dayMaxEvents={4}
                slotMinTime="00:00:00"
                slotMaxTime="24:00:00"
                allDaySlot
                height={singleCalendarHeight}
                dateClick={canCreateActivities ? handleDateDoubleClick : undefined}
                eventClick={openExistingActivity}
                eventDrop={canEditActivities ? handleCalendarMutation : undefined}
                eventResize={canEditActivities ? handleCalendarMutation : undefined}
                eventDidMount={(info) => {
                  info.el.style.setProperty('--calendar-user-color', info.event.extendedProps.calendarColor || info.event.borderColor || '#0f6cbd')
                  info.el.title = formatEventTooltip(info.event)
                }}
                datesSet={(info) => {
                  const anchorDate = info.view.calendar.getDate()
                  setCurrentDate(anchorDate)
                  setCurrentView(info.view.type)
                  setCalendarTitle(info.view.title)
                }}
                eventContent={(info) => {
                  const showStatus = currentView === 'listWeek'
                  const normalizedView = getCalendarViewType(currentView)
                  const isMonthView = normalizedView === 'dayGridMonth'
                  const isTimeGridView = normalizedView === 'timeGridWeek' || normalizedView === 'timeGridDay'
                  const startTimeText = !info.event.allDay && info.timeText ? info.timeText.split(' - ')[0] : ''
                  const titleWithTime = startTimeText ? `${startTimeText} ${info.event.title}` : info.event.title
                  const customerName = info.event.extendedProps.customer?.name

                  return (
                    <div className="fc-activity-card">
                      <div className="fc-activity-card__header">
                        <span className={classNames('fc-activity-card__title', isTimeGridView && 'fc-activity-card__title--multiline')}>
                          {isMonthView ? titleWithTime : info.event.title}
                        </span>
                        {showStatus && (
                          <span className="fc-activity-card__status">{STATUS_LABELS[info.event.extendedProps.status]}</span>
                        )}
                      </div>
                      {isTimeGridView && info.event.extendedProps.location && (
                        <div className="fc-activity-card__meta">
                          <span>{info.event.extendedProps.location}</span>
                        </div>
                      )}
                      {(isTimeGridView || showStatus) && customerName && (
                        <div className="fc-activity-card__meta">
                          <span className="fc-activity-card__customer">{customerName}</span>
                        </div>
                      )}
                      {showStatus && (
                        <div className="fc-activity-card__meta">
                          <span>{CATEGORY_LABELS[info.event.extendedProps.category]}</span>
                        </div>
                      )}
                    </div>
                  )
                }}
              />
            )}
          </main>
        </div>
      </div>

      <EventModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedEvent(null)
        }}
        onSave={handleSaveActivity}
        onDelete={handleDeleteActivity}
        event={selectedEvent}
        users={users}
        customers={customers}
        onCustomersChanged={loadCustomers}
        agents={agents}
        onAgentsChanged={loadAgents}
        isAdmin={isAdmin}
        currentUser={user}
        readOnly={Boolean(selectedEvent?.readOnly)}
      />

      <ExpandedCalendarModal
        isOpen={Boolean(expandedCalendarUser)}
        activeUser={expandedCalendarUser}
        events={expandedCalendarEventsWithSelection}
        initialDate={currentDate}
        initialView={currentView}
        onClose={() => setExpandedCalendarUser(null)}
        onEventDoubleClick={openExistingActivity}
        onDateDoubleClick={handleDateDoubleClick}
        onEventMutation={handleCalendarMutation}
        users={users}
        canEditActivities={canEditActivities}
      />

      <UserManagementModal
        isOpen={userManagerOpen}
        onClose={() => setUserManagerOpen(false)}
        users={users}
        currentUser={user}
        onCreateUser={handleCreateUser}
        onUpdateUser={handleUpdateUser}
        onDeleteUser={handleDeleteUser}
      />

      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        user={user}
        onSave={handleUpdateProfile}
      />

      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
          <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Confirm Logout</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Log out of the calendar?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Your current session will be closed and you will return to the login page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <span className="text-2xl leading-none">&times;</span>
              </button>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
