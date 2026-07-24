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
  // Admin-only: provisions a new account (requires an admin token). Public
  // self-registration is disabled server-side.
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
  geocode: (address) => api.post('/customers/geocode', { address }),
  // Cross-reference: link / unlink a tender-project thread to a customer.
  linkProject: (id, data) => api.post(`/customers/${id}/projects`, data),
  unlinkProject: (id, linkId) => api.delete(`/customers/${id}/projects/${linkId}`),
  createShare: (data) => api.post('/customers/share', data),
  // Public — no auth required (interceptor omits the header when logged out).
  getShared: (token) => api.get(`/customers/share/${token}`),
}

export const visitReportsAPI = {
  list: (params = {}) => api.get('/visit-reports', { params }),
  get: (id) => api.get(`/visit-reports/${id}`),
  create: (data) => api.post('/visit-reports', data),
  update: (id, data) => api.put(`/visit-reports/${id}`, data),
  delete: (id) => api.delete(`/visit-reports/${id}`),
  // AI-structure raw notes (+ optional photos) into a draft — multipart, not saved.
  generate: (formData) => api.post('/visit-reports/generate', formData),
  // Concise AI summary of report text — keeps the body original, fills the summary field.
  summarize: (text) => api.post('/visit-reports/summarize', { text }),
  // Download the report as a .docx (pandoc-rendered on the server).
  exportDocx: (id) => api.get(`/visit-reports/${id}/export`, { responseType: 'blob' }),
}

// Unified command search (/customer /project /report).
export const searchAPI = {
  query: (type, q) => api.get('/search', { params: { type, q } }),
}

// Workspace AI assistant (DeepSeek tool loop over module data). Multi-step
// queries can take a while — give it a generous timeout.
export const assistantAPI = {
  chat: (messages) => api.post('/assistant/chat', { messages }, { timeout: 120000 }),
}

// Hot projects — internal sales open/potential projects tracking (sensitive).
export const hotProjectsAPI = {
  list: (params = {}) => api.get('/hotprojects', { params }),
  get: (id) => api.get(`/hotprojects/${id}`),
  create: (data) => api.post('/hotprojects', data),
  update: (id, data) => api.put(`/hotprojects/${id}`, data),
  delete: (id) => api.delete(`/hotprojects/${id}`),
  addUpdate: (id, data) => api.post(`/hotprojects/${id}/updates`, data),
  deleteUpdate: (id, updateId) => api.delete(`/hotprojects/${id}/updates/${updateId}`),
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
