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
  // Owner-driven resolution of auto-created report reminders.
  dueReminders: () => api.get('/events/due-reminders'),
  resolveReminder: (id, data) => api.post(`/events/due-reminders/${id}/resolve`, data),
}

export const customersAPI = {
  getAll: () => api.get('/customers'),
  get: (id) => api.get(`/customers/${id}`),
  create: (data) => api.post('/customers', data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  delete: (id) => api.delete(`/customers/${id}`),
  geocode: (address) => api.post('/customers/geocode', { address }),
  addNote: (id, content) => api.post(`/customers/${id}/notes`, { content }),
  updateNote: (id, noteId, content) => api.put(`/customers/${id}/notes/${noteId}`, { content }),
  deleteNote: (id, noteId) => api.delete(`/customers/${id}/notes/${noteId}`),
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
  chat: (messages, lang) => api.post('/assistant/chat', { messages, lang }, { timeout: 120000 }),
}

// Hot projects — internal sales open/potential projects tracking (sensitive).
export const hotProjectsAPI = {
  list: (params = {}) => api.get('/hotprojects', { params }),
  get: (id) => api.get(`/hotprojects/${id}`),
  create: (data) => api.post('/hotprojects', data),
  update: (id, data) => api.put(`/hotprojects/${id}`, data),
  delete: (id) => api.delete(`/hotprojects/${id}`),
  addUpdate: (id, data) => api.post(`/hotprojects/${id}/updates`, data),
  summarize: (id) => api.post(`/hotprojects/${id}/summarize`),
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
  // planItinerary tries v4-pro then v4-flash, each with a 150s abort, so the
  // worst case is ~300s. Say so rather than relying on axios' default of none.
  plan: (id) => api.post(`/trips/${id}/plan`, null, { timeout: 300000 }),
  // Wizard step 3: constraint-gathering interview, and the pass that condenses
  // it into `constraints`.
  planChat: (payload) => api.post('/trips/plan-chat', payload, { timeout: 90000 }),
  planChatSummary: (payload) => api.post('/trips/plan-chat/summary', payload, { timeout: 90000 }),
  // Public — no auth required (interceptor simply omits the header when logged out).
  getShared: (token) => api.get(`/trips/share/${token}`),
}

// Contract files. Every call except unlock/pin carries the short-lived token
// minted by unlock — the server rejects the request without it, so this is not
// a UI convenience but the actual gate.
const withUnlock = (token, extra = {}) => ({
  ...extra,
  headers: { ...(extra.headers || {}), 'X-Contract-Token': token },
})

export const contractsAPI = {
  unlock: (team, pin) => api.post('/contracts/unlock', { team, pin }),
  pinStatus: () => api.get('/contracts/pin-status'),
  setPin: (team, pin) => api.put('/contracts/pin', { team, pin }),
  list: (customerId, token) => api.get(`/contracts/customer/${customerId}`, withUnlock(token)),
  upload: (customerId, token, formData, onUploadProgress) =>
    api.post(`/contracts/customer/${customerId}`, formData, withUnlock(token, { onUploadProgress })),
  download: (fileId, token) =>
    api.get(`/contracts/files/${fileId}/download`, withUnlock(token, { responseType: 'blob' })),
  remove: (fileId, token) => api.delete(`/contracts/files/${fileId}`, withUnlock(token)),
  // Cross-customer list for the standalone Contracts module. `params` takes
  // docType / customerId / q / limit / offset; team is never sent — the server
  // takes it from the unlock token and ignores anything the client claims.
  listAll: (params, token) => api.get('/contracts/files', withUnlock(token, { params })),
  summary: (token) => api.get('/contracts/files/summary', withUnlock(token)),
  // Customers that have contracts on file for the unlocked team — feeds the
  // Ask-AI picker so it only offers customers a question can be answered from.
  askCustomers: (token) => api.get('/contracts/customers', withUnlock(token)),
  patch: (fileId, data, token) => api.patch(`/contracts/files/${fileId}`, data, withUnlock(token)),
  // Key-terms summary of one file. Uncached it spends a minute in the local
  // model, so the timeout is generous — but bounded, since a wedged DGX must
  // not hold the tab open forever. `refresh` re-runs it instead of reading the
  // stored copy, and the server only lets the uploader or an admin do that.
  summarize: (fileId, token, refresh = false) =>
    api.post(`/contracts/files/${fileId}/summary`, { refresh }, withUnlock(token, { timeout: 180000 })),
  // Ask AI about one customer's contracts. A local model on the DGX reads the
  // transcribed pages, so this can take a few seconds — override the client's
  // default timeout. `history` carries prior turns for follow-up questions.
  ask: (customerId, question, token, history = []) =>
    api.post('/contracts/ask', { customerId, question, history }, withUnlock(token, { timeout: 180000 })),
  // Transcription pause control — owner-gated server-side, no unlock token. GET
  // reads {paused, draining, online}; POST {action:'pause'|'resume'} toggles it.
  ocrControlStatus: () => api.get('/contracts/ocr/control'),
  ocrControl: (action) => api.post('/contracts/ocr/control', { action }),
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
