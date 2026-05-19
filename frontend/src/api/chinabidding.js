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