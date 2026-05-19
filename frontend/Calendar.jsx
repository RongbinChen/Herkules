import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { useAuth } from '../context/AuthContext'
import { eventsAPI, usersAPI } from '../api/api'
import EventModal from './EventModal'

function MiniCalendar({ events, currentDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date(currentDate))

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const startingDay = firstDayOfMonth.getDay()
  const daysInMonth = lastDayOfMonth.getDate()

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const eventDates = useMemo(() => {
    const dates = new Set()
    events.forEach(event => {
      const start = new Date(event.start)
      const end = new Date(event.end)
      const current = new Date(start)
      while (current <= end) {
        dates.add(current.toDateString())
        current.setDate(current.getDate() + 1)
      }
    })
    return dates
  }, [events])

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1))
  }

  const days = []
  for (let i = 0; i < startingDay; i++) {
    days.push(null)
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i)
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={handlePrevMonth} className="p-1 hover:bg-gray-100 rounded">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium">{monthNames[month]} {year}</span>
        <button onClick={handleNextMonth} className="p-1 hover:bg-gray-100 rounded">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {dayNames.map(day => (
          <div key={day} className="text-xs text-gray-500 py-1">{day}</div>
        ))}
        {days.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="h-7" />
          }
          const dateStr = new Date(year, month, day).toDateString()
          const hasEvent = eventDates.has(dateStr)
          const isToday = new Date().toDateString() === dateStr

          return (
            <button
              key={day}
              onClick={() => onSelectDate(new Date(year, month, day))}
              className={`h-7 text-xs rounded-full flex flex-col items-center justify-center hover:bg-gray-50
                ${isToday ? 'bg-blue-500 text-white hover:bg-blue-600' : ''}`}
            >
              <span>{day}</span>
              {hasEvent && !isToday && (
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-0.5" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CalendarList({ users, selectedUserId, onSelectUser, onCreateCalendar, isAdmin }) {
  const [newCalendarName, setNewCalendarName] = useState('')
  const [showInput, setShowInput] = useState(false)

  const handleCreate = () => {
    if (newCalendarName.trim()) {
      onCreateCalendar(newCalendarName.trim())
      setNewCalendarName('')
      setShowInput(false)
    }
  }

  return (
    <div className="p-3 border-t">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">My Calendars</h3>
        <button
          onClick={() => setShowInput(!showInput)}
          className="p-1 hover:bg-gray-100 rounded text-gray-500"
          title="New calendar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {showInput && (
        <div className="mb-2 flex gap-1">
          <input
            type="text"
            value={newCalendarName}
            onChange={(e) => setNewCalendarName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Calendar name"
            className="flex-1 text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
          >
            Add
          </button>
        </div>
      )}

      <div className="space-y-1">
        <button
          onClick={() => onSelectUser(null)}
          className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2
            ${selectedUserId === null ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}
        >
          <span className="w-3 h-3 bg-blue-500 rounded-full" />
          <span>All Events</span>
        </button>

        {users.map(user => (
          <button
            key={user.id}
            onClick={() => onSelectUser(user.id)}
            className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2
              ${selectedUserId === user.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}
          >
            <span className="w-3 h-3 bg-purple-500 rounded-full" />
            <span className="truncate">{user.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Calendar() {
  const { logout, user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const [events, setEvents] = useState([])
  const [allEvents, setAllEvents] = useState([])
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [currentView, setCurrentView] = useState('dayGridMonth')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const calendarRef = useRef(null)

  const fetchEvents = useCallback(async () => {
    try {
      const res = await eventsAPI.getAll()
      const mapped = res.data.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        userId: e.user?.id,
        userName: e.user?.name,
      }))
      setAllEvents(mapped)
      setEvents(mapped)
    } catch (err) {
      console.error('Failed to fetch events:', err)
    }
  }, [])

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await usersAPI.getAll()
      setUsers(res.data)
    } catch (err) {
      console.error('Failed to fetch users:', err)
    }
  }, [isAdmin])

  useEffect(() => {
    fetchEvents()
    fetchUsers()
  }, [fetchEvents, fetchUsers])

  useEffect(() => {
    if (selectedUserId === null) {
      setEvents(allEvents)
    } else {
      setEvents(allEvents.filter(e => e.userId === selectedUserId))
    }
  }, [selectedUserId, allEvents])

  // Handle clicking a date on the mini calendar - switch to day view with time axis
  const handleMiniCalendarSelect = (date) => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi()
      calendarApi.changeView('timeGridDay')
      calendarApi.gotoDate(date)
      // Scroll to top of the day to ensure time axis is visible
      setTimeout(() => {
        const scrollContainer = document.querySelector('.fc-scroller')
        if (scrollContainer) scrollContainer.scrollTop = 0
      }, 100)
    }
  }

  // Handle clicking on the FullCalendar itself - open event creation modal
  const handleDateClick = (dateOrInfo) => {
    const dateStr = dateOrInfo instanceof Date
      ? dateOrInfo.toISOString().split('T')[0]
      : dateOrInfo.dateStr

    setSelectedEvent({
      title: '',
      description: '',
      start: dateStr,
      end: dateStr,
      allDay: true,
    })
    setModalOpen(true)
  }

  const handleEventClick = (arg) => {
    const event = arg.event
    setSelectedEvent({
      id: event.id,
      title: event.title,
      description: event.extendedProps.description || '',
      start: event.startStr,
      end: event.endStr || event.startStr,
      allDay: event.allDay,
    })
    setModalOpen(true)
  }

  const handleSaveEvent = async (data) => {
    try {
      if (data.id) {
        await eventsAPI.update(data.id, data)
      } else {
        await eventsAPI.create(data)
      }
      await fetchEvents()
      setModalOpen(false)
      setSelectedEvent(null)
    } catch (err) {
      console.error('Failed to save event:', err)
      alert('Failed to save event')
    }
  }

  const handleDeleteEvent = async () => {
    if (!selectedEvent?.id) return
    if (!confirm('Are you sure you want to delete this event?')) return

    try {
      await eventsAPI.delete(selectedEvent.id)
      await fetchEvents()
      setModalOpen(false)
      setSelectedEvent(null)
    } catch (err) {
      console.error('Failed to delete event:', err)
      alert('Failed to delete event')
    }
  }

  const handleCreateCalendar = (name) => {
    console.log('Create calendar:', name)
  }

  return (
    <div className="relative flex h-screen bg-gray-50">
      {/* Left Sidebar */}
      <aside className={`bg-white border-r flex flex-col transition-all duration-300 ${sidebarVisible ? 'w-52' : 'w-0 overflow-hidden'}`}>
        {/* Header */}
        <div className="p-4 border-b min-h-[64px]">
          <h1 className="text-lg font-semibold text-gray-800">Calendar</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {user?.name}{isAdmin ? ' (Admin)' : ''}
          </p>
        </div>

        {/* Mini Calendar */}
        <div className="border-b">
          <MiniCalendar
            events={allEvents}
            currentDate={new Date()}
            onSelectDate={handleMiniCalendarSelect}
          />
        </div>

        {/* Calendar List */}
        <div className="flex-1 overflow-y-auto">
          <CalendarList
            users={isAdmin ? users : []}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
            onCreateCalendar={handleCreateCalendar}
            isAdmin={isAdmin}
          />
        </div>

        {/* Logout */}
        <div className="p-3 border-t">
          <button
            onClick={logout}
            className="w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Toggle Sidebar Button */}
      <button
        onClick={() => setSidebarVisible(!sidebarVisible)}
        className="absolute left-0 top-1/2 transform -translate-y-1/2 z-10 bg-white border border-l-0 rounded-r-lg shadow-md hover:bg-gray-50 transition-colors"
        style={{ left: sidebarVisible ? '208px' : '0' }}
      >
        <svg className={`w-5 h-5 text-gray-600 transition-transform ${sidebarVisible ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden p-4">
        <div className="bg-white rounded-lg shadow flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView={currentView}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
              }}
              views={{
                listWeek: { buttonText: 'List' },
              }}
              events={events}
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              editable={true}
              selectable={true}
              selectMirror={true}
              dayMaxEvents={true}
              weekends={true}
              height="100%"
              eventContent={(arg) => (
                <div className="flex flex-col overflow-hidden">
                  <span className="font-medium">{arg.event.title}</span>
                  {isAdmin && arg.event.extendedProps.userName && (
                    <span className="text-xs opacity-75">@{arg.event.extendedProps.userName}</span>
                  )}
                </div>
              )}
            />
          </div>
        </div>
      </main>

      <EventModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedEvent(null)
        }}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
        event={selectedEvent}
      />
    </div>
  )
}