import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

function parseJwtPayload(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function isTokenExpired(token) {
  if (!token) return true
  const payload = parseJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 <= Date.now()
}

const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api` : '/api',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && !isTokenExpired(token)) {
    config.headers.Authorization = `Bearer ${token}`
  } else if (token) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }
  return config
})

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
}

export const eventsAPI = {
  getAll: () => api.get('/events'),
  create: (data) => api.post('/events', data),
  update: (id, data) => api.put(`/events/${id}`, data),
  delete: (id) => api.delete(`/events/${id}`),
  exportIcs: () => api.get('/events/export.ics', { responseType: 'blob' }),
}

export const customersAPI = {
  getAll: () => api.get('/customers'),
  get: (id) => api.get(`/customers/${id}`),
  create: (data) => api.post('/customers', data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  delete: (id) => api.delete(`/customers/${id}`),
}

export const agentsAPI = {
  getAll: () => api.get('/agents'),
  get: (id) => api.get(`/agents/${id}`),
  create: (data) => api.post('/agents', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: (id) => api.delete(`/agents/${id}`),
}

export const tripsAPI = {
  getAll: () => api.get('/trips'),
  get: (id) => api.get(`/trips/${id}`),
  create: (data) => api.post('/trips', data),
  update: (id, data) => api.put(`/trips/${id}`, data),
  delete: (id) => api.delete(`/trips/${id}`),
  plan: (id) => api.post(`/trips/${id}/plan`),
  // Public — no auth required (interceptor simply omits the header when logged out).
  getShared: (token) => api.get(`/trips/share/${token}`),
}

export const usersAPI = {
  getAll: () => api.get('/users'),
  getVisible: () => api.get('/users/visible'),
  getActivitySummary: () => api.get('/users/activity-summary'),
  updateMe: (data) => api.put('/users/me', data),
  getAdminNotices: () => api.get('/users/me/admin-notices'),
  dismissAdminNotice: (noticeId) => api.post(`/users/me/admin-notices/${noticeId}/dismiss`),
  getCalendarFeed: () => api.get('/users/me/calendar-feed'),
  getAllCalendarFeeds: () => api.get('/users/calendar-feeds'),
  rotateCalendarFeed: () => api.post('/users/me/calendar-feed/rotate'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
}

export const holidaysAPI = {
  getCalendars: () => api.get('/holidays/calendars'),
}

export default api
