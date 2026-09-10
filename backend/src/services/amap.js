// AMap (高德) web-service client: geocoding and driving times.
//
// Two things this exists to fix. The coordinates behind the customer map used
// to come from asking a language model for a latitude and longitude, which is
// a guess dressed as data. And the itinerary's travel times were the planning
// model's invention — "45 minutes by taxi" with nothing behind it.
//
// Both are now looked up. Where the key is missing the callers fall back to
// saying nothing rather than to guessing again: an absent number is a smaller
// problem than a wrong one somebody plans a day around.
//
// IPv4 is forced. The VPS has both an IPv4 and an IPv6 address, Node prefers
// IPv6, and AMap's key whitelist holds the IPv4 one — so every request went out
// over v6 and came back INVALID_USER_IP. Pinning the family per request (rather
// than dns.setDefaultResultOrder, which would change every outbound call this
// process makes) keeps the workaround where the problem is. node:https is used
// instead of fetch because fetch has no way to say "v4 only" without pulling in
// undici as a direct dependency.
import https from 'https';

const HOST = 'restapi.amap.com';
const KEY = process.env.AMAP_KEY;
const TIMEOUT_MS = 8000;

export const isAmapConfigured = () => Boolean(KEY);

function getJson(path) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: HOST, path, method: 'GET', family: 4, timeout: TIMEOUT_MS },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.warn(`[amap] HTTP ${res.statusCode} for ${path.split('?')[0]}`);
            return resolve(null);
          }
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => {
      console.warn(`[amap] request failed: ${err.message}`);
      resolve(null);
    });
    req.end();
  });
}

async function get(route, params) {
  if (!KEY) return null;
  const qs = new URLSearchParams({ key: KEY, ...params }).toString();
  const data = await getJson(`/v3${route}?${qs}`);
  if (!data) return null;
  // AMap answers 200 with status:"0" for its own errors, so the body is the
  // only place a failure shows up.
  if (data.status !== '1') {
    console.warn(`[amap] ${route} ${data.info} (${data.infocode})`);
    return null;
  }
  return data;
}

/** Address → { latitude, longitude, formatted, level } or null. */
export async function amapGeocode(address) {
  const a = String(address || '').trim();
  if (!a) return null;
  const data = await get('/geocode/geo', { address: a });
  const hit = data?.geocodes?.[0];
  if (!hit?.location) return null;
  const [lng, lat] = String(hit.location).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    formatted: hit.formatted_address || a,
    // "省"/"市" means it only resolved to a province or city — the pin is the
    // city centre, not the address, and callers should say so rather than
    // present it as a street-level fix.
    level: hit.level || '',
  };
}

const fmtDuration = (seconds) => {
  const m = Math.round(Number(seconds) / 60);
  if (!Number.isFinite(m) || m <= 0) return null;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};

/**
 * Driving time between two coordinates.
 * Returns { km, minutes, text } or null when unavailable.
 *
 * `strategy: 32` is AMap's "fastest route accounting for current traffic". A
 * business visit is planned days ahead, so live traffic is the wrong question —
 * but AMap has no historical-average option on this endpoint, and its answer is
 * still grounded in the real road network, which is the part that matters.
 */
export async function amapDriving(from, to) {
  if (!from || !to) return null;
  const data = await get('/direction/driving', {
    origin: `${from.longitude},${from.latitude}`,
    destination: `${to.longitude},${to.latitude}`,
    strategy: '32',
    extensions: 'base',
  });
  const path = data?.route?.paths?.[0];
  if (!path) return null;
  const km = Math.round((Number(path.distance) / 1000) * 10) / 10;
  const minutes = Math.round(Number(path.duration) / 60);
  const text = fmtDuration(path.duration);
  if (!text) return null;
  return { km, minutes, text };
}

/**
 * Driving time between every pair of points, as a flat list.
 *
 * Uses /distance rather than n² calls to /direction/driving: that endpoint
 * takes up to 100 origins against one destination, so a trip with n stops
 * costs n requests instead of n×(n−1).
 *
 * `points` is [{ key, latitude, longitude }]. Pairs that AMap cannot answer
 * are simply absent from the result — the caller says nothing about them
 * rather than filling the gap.
 */
export async function drivingMatrix(points) {
  const usable = (points || []).filter(
    (p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude),
  );
  // Two is the minimum for a leg to exist; past a dozen stops this is a lot of
  // requests for a plan nobody reads that far into, and the planner manages
  // without.
  if (!KEY || usable.length < 2 || usable.length > 12) return [];

  const legs = [];
  for (const dest of usable) {
    const origins = usable.filter((p) => p.key !== dest.key);
    if (!origins.length) continue;
    const data = await get('/distance', {
      origins: origins.map((p) => `${p.longitude},${p.latitude}`).join('|'),
      destination: `${dest.longitude},${dest.latitude}`,
      type: '1', // driving
    });
    for (const r of data?.results || []) {
      const origin = origins[Number(r.origin_id) - 1];
      const minutes = Math.round(Number(r.duration) / 60);
      const km = Math.round((Number(r.distance) / 1000) * 10) / 10;
      // AMap returns 1 m / 1 s for two points it considers the same place.
      if (!origin || !Number.isFinite(minutes) || minutes < 1) continue;
      legs.push({ from: origin.key, to: dest.key, km, minutes, text: fmtDuration(r.duration) });
    }
  }
  return legs;
}
