const API_BASE = '/api/chinabidding';

export async function getProjects(params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/projects${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function getStatistics() {
  const res = await fetch(`${API_BASE}/statistics`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to fetch statistics');
  return res.json();
}

export async function triggerScrape(type = 'NEW') {
  const res = await fetch(`${API_BASE}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({ type })
  });
  if (!res.ok) throw new Error('Failed to trigger scrape');
  return res.json();
}

export async function getScrapeJob(jobId) {
  const res = await fetch(`${API_BASE}/scrape-jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to fetch scrape job');
  return res.json();
}

export async function listSavedSearches() {
  const res = await fetch(`${API_BASE}/saved-searches`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to fetch saved searches');
  return res.json();
}

export async function createSavedSearch(data) {
  const res = await fetch(`${API_BASE}/saved-searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create saved search');
  return res.json();
}

export async function deleteSavedSearch(id) {
  const res = await fetch(`${API_BASE}/saved-searches/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to delete saved search');
}

export async function runSavedSearch(id) {
  const res = await fetch(`${API_BASE}/saved-searches/${id}/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to run saved search');
  return res.json();
}

export async function searchByKeyword(keyword) {
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({ keyword })
  });
  if (!res.ok) throw new Error('Failed to search');
  return res.json();
}

export async function getUpdates(days = 7) {
  const res = await fetch(`${API_BASE}/updates?days=${days}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to fetch updates');
  return res.json();
}

export async function runDailyJob() {
  const res = await fetch(`${API_BASE}/run-daily`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to start daily job');
  return res.json();
}
// ── Phase 1-4: thread / follows / notifications / trends / report ────────────

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() });

export async function getProjectThread(projectId) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/thread`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch thread');
  return res.json();
}

export async function listFollows() {
  const res = await fetch(`${API_BASE}/follows`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch follows');
  return res.json();
}

export async function followProject(projectId, note = null) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/follow`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ note })
  });
  if (!res.ok) throw new Error('Failed to follow');
  return res.json();
}

export async function unfollowProject(projectId) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/follow`, {
    method: 'DELETE', headers: authHeaders()
  });
  if (!res.ok) throw new Error('Failed to unfollow');
}

export async function listNotifications(unreadOnly = false) {
  const res = await fetch(`${API_BASE}/notifications${unreadOnly ? '?unread=true' : ''}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json();
}

export async function markNotificationRead(id) {
  const res = await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to mark read');
}

export async function markAllNotificationsRead() {
  const res = await fetch(`${API_BASE}/notifications/read-all`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to mark all read');
}

export async function getTrends(months = 12) {
  const res = await fetch(`${API_BASE}/trends?months=${months}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch trends');
  return res.json();
}

export async function generateReport() {
  const res = await fetch(`${API_BASE}/report`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to generate report');
  return res.json();
}

export async function listCompetitors() {
  const res = await fetch(`${API_BASE}/competitors`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch competitors');
  return res.json();
}

// ── Bid Open 子版块 ───────────────────────────────────────────────────────────

async function parseOrThrow(res, fallback) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || fallback);
  return data;
}

export async function uploadBidOpening(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/bidopen/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: form,
  });
  return parseOrThrow(res, 'Failed to upload bid opening record');
}

export async function listBidOpenings() {
  const res = await fetch(`${API_BASE}/bidopen`, { headers: authHeaders() });
  return parseOrThrow(res, 'Failed to list bid openings');
}

export async function deleteBidOpening(id) {
  const res = await fetch(`${API_BASE}/bidopen/${id}`, { method: 'DELETE', headers: authHeaders() });
  return parseOrThrow(res, 'Failed to delete');
}

// 抓取 chinabidding 上该编号的评标/中标公告并返回分组结果
export async function fetchBidResults(biddingNo) {
  const res = await fetch(`${API_BASE}/bidopen/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ biddingNo }),
  });
  return parseOrThrow(res, 'Failed to fetch results from chinabidding');
}

export async function getBidResults(biddingNo) {
  const res = await fetch(`${API_BASE}/bidopen/results?biddingNo=${encodeURIComponent(biddingNo)}`, { headers: authHeaders() });
  return parseOrThrow(res, 'Failed to query results');
}

export async function getEmailStatus() {
  const res = await fetch(`${API_BASE}/bidopen/email-status`, { headers: authHeaders() });
  return parseOrThrow(res, 'Failed to get email status');
}

export async function updateSavedSearch(id, data) {
  const res = await fetch(`${API_BASE}/saved-searches/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return parseOrThrow(res, 'Failed to update subscription');
}
