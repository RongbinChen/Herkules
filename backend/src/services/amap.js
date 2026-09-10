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

// Airports the trips actually use, by IATA code. The table supplies the name;
// AMap supplies the coordinate — hardcoding latitudes would be inventing the
// one kind of number this whole file exists to stop inventing.
//
// "Airport to the first customer" is the leg people ask about most and the one
// the stop list cannot answer, because an airport is not a customer.
const AIRPORTS = {
  PEK: '北京首都国际机场', PKX: '北京大兴国际机场', TSN: '天津滨海国际机场',
  SHA: '上海虹桥国际机场', PVG: '上海浦东国际机场', NKG: '南京禄口国际机场',
  HGH: '杭州萧山国际机场', CAN: '广州白云国际机场', SZX: '深圳宝安国际机场',
  CTU: '成都双流国际机场', TFU: '成都天府国际机场', CKG: '重庆江北国际机场',
  XIY: '西安咸阳国际机场', TAO: '青岛胶东国际机场', DLC: '大连周水子国际机场',
  SHE: '沈阳桃仙国际机场', HRB: '哈尔滨太平国际机场', WUH: '武汉天河国际机场',
  CSX: '长沙黄花国际机场', KMG: '昆明长水国际机场', XMN: '厦门高崎国际机场',
  FOC: '福州长乐国际机场', TNA: '济南遥墙国际机场', CGO: '郑州新郑国际机场',
  HFE: '合肥新桥国际机场', NNG: '南宁吴圩国际机场', URC: '乌鲁木齐地窝堡国际机场',
};

const airportCache = new Map();

/**
 * IATA codes mentioned in a flight's routing → [{ key, name, latitude, longitude }].
 * Unknown codes are skipped rather than guessed at.
 */
export async function airportPoints(routings) {
  if (!KEY) return [];
  const codes = new Set();
  for (const r of routings || []) {
    for (const m of String(r || '').toUpperCase().matchAll(/\b([A-Z]{3})\b/g)) {
      if (AIRPORTS[m[1]]) codes.add(m[1]);
    }
  }
  const out = [];
  for (const code of codes) {
    if (!airportCache.has(code)) {
      const hit = await amapGeocode(AIRPORTS[code]);
      airportCache.set(code, hit || null);
    }
    const hit = airportCache.get(code);
    if (hit) {
      out.push({
        key: `apt:${code}`,
        name: `${AIRPORTS[code]} (${code})`,
        latitude: hit.latitude,
        longitude: hit.longitude,
      });
    }
  }
  return out;
}
