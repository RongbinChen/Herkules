// Best-effort forward geocoding via OpenStreetMap Nominatim (no API key needed,
// matches the OSM tiles the customer map already uses). Returns { latitude,
// longitude } or null. Never throws — geocoding must not block saving a customer.
//
// Nominatim usage policy: <=1 request/second and a descriptive User-Agent.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'calendar-app/1.0 (customer-map geocoding)';

// A country/continent-level hit is a misleading pin (e.g. an address that only
// resolves to "China" would drop the marker in the wrong city), so reject it
// and prefer returning null.
const TOO_COARSE = new Set(['country', 'continent']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normalize common Chinese-address noise that confuses Nominatim.
function normalize(address) {
  return address
    .replace(/\bP\.?\s*R\.?\s*China\b/gi, 'China')
    .replace(/\bPRC\b/gi, 'China')
    .replace(/\bProvince\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function queryNominatim(q) {
  const params = new URLSearchParams({ q, format: 'json', limit: '1' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const hit = data[0];
    if (TOO_COARSE.has(hit.addresstype)) return null;
    const latitude = Number(hit.lat);
    const longitude = Number(hit.lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    return { latitude, longitude };
  } catch (err) {
    console.error('[geocode] query failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Build progressively coarser queries: the full address first, then drop the
// most-specific leading parts (building/floor/street) and fall back toward
// "City, Province, Country", which Nominatim resolves reliably.
function candidateQueries(address) {
  const parts = normalize(address).split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = [];
  for (let start = 0; start < parts.length; start++) {
    candidates.push(parts.slice(start).join(', '));
  }
  return [...new Set(candidates)];
}

export async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  const candidates = candidateQueries(address);
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await sleep(1100); // respect Nominatim rate limit between retries
    const coords = await queryNominatim(candidates[i]);
    if (coords) return coords;
  }
  return null;
}
