// Read-only proxy for GMT field service on a Herkules customer.
// The browser never sees the service token. GMT PR #44 authenticates with
// X-GMT-Token set to HERKULES_GMT_TOKEN — the same secret GMT already sends
// when it pulls customers. Herkules stores that value as GMT_CUSTOMER_SYNC_TOKEN.
// There is no second token and no Authorization bearer on this call.

const DEFAULT_GMT_ORIGIN = 'https://gmt.herkulesgroup-china.com';
const TOKEN_ENV = 'GMT_CUSTOMER_SYNC_TOKEN';
const MIN_TOKEN_LENGTH = 16;

function text(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function shortText(value, max = 280) {
  const cleaned = text(value);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pick(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

export function parseCustomerId(value) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function gmtFieldConfig(env = process.env) {
  const configuredBase = text(env.GMT_API_BASE) || DEFAULT_GMT_ORIGIN;
  let base;
  try {
    const url = new URL(configuredBase);
    base = url.origin;
  } catch {
    base = DEFAULT_GMT_ORIGIN;
  }
  const token = String(env[TOKEN_ENV] || '');
  return {
    base,
    token,
    configured: token.length >= MIN_TOKEN_LENGTH,
  };
}

export function fieldServiceUrl(customerId, env = process.env) {
  const { base } = gmtFieldConfig(env);
  return `${base}/api/internal/herkules/customers/${encodeURIComponent(customerId)}/field-service`;
}

function allowedOrigins(env) {
  const origins = new Set([DEFAULT_GMT_ORIGIN]);
  origins.add(gmtFieldConfig(env).base);
  return origins;
}

// Keep a GMT-supplied url only when it stays on the GMT origin.
export function safeGmtUrl(value, env = process.env) {
  const raw = text(value);
  if (!raw) return '';
  const origins = allowedOrigins(env);
  let fallbackBase = DEFAULT_GMT_ORIGIN;
  try {
    fallbackBase = gmtFieldConfig(env).base;
  } catch {
    fallbackBase = DEFAULT_GMT_ORIGIN;
  }
  let url;
  try {
    url = new URL(raw, fallbackBase);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (!origins.has(url.origin)) return '';
  return url.toString();
}

function personName(value) {
  if (typeof value === 'string') return text(value);
  if (value && typeof value === 'object') return text(value.name);
  return '';
}

function engineerOf(value) {
  if (typeof value === 'string') {
    const name = text(value);
    return name ? { id: null, name } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const name = text(pick(value, ['name']) || pick(value.engineer, ['name']) || pick(value.user, ['name']));
  if (!name) return null;
  const id = pick(value, ['id']) ?? pick(value.engineer, ['id']) ?? pick(value.user, ['id']) ?? null;
  return { id, name };
}

function siteLabel(site) {
  if (!site) return '';
  return [text(site.customer), text(site.name)].filter(Boolean).join(' · ');
}

// GMT links are query params on the public origin: ?task=10 and ?report=4.
// A supplied url on that origin wins; anything else is rebuilt from the id.
function contractLink(kind, id, given, env) {
  const safe = safeGmtUrl(given, env);
  if (safe) return safe;
  if (id == null || id === '') return '';
  return `${gmtFieldConfig(env).base}/?${kind}=${encodeURIComponent(id)}`;
}

export function mapFieldService(payload, env = process.env) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const sites = asArray(pick(body, ['sites', 'Sites'])).map((site) => ({
    id: pick(site, ['id']) ?? null,
    name: text(pick(site, ['name'])),
    customer: text(pick(site, ['customer'])),
    address: text(pick(site, ['address'])),
  }));
  const sitesById = new Map(sites.filter((site) => site.id != null).map((site) => [String(site.id), site]));

  const tasks = asArray(pick(body, ['tasks', 'Tasks'])).map((task) => {
    const siteId = pick(task, ['siteId', 'site_id']) ?? null;
    const named = text(pick(task, ['siteName', 'site_name']));
    return {
      id: pick(task, ['id']) ?? null,
      title: text(pick(task, ['title'])) || 'Untitled task',
      type: text(pick(task, ['type'])),
      status: text(pick(task, ['status'])),
      start: pick(task, ['start']) ?? null,
      end: pick(task, ['end']) ?? null,
      siteId,
      siteName: named || siteLabel(sitesById.get(String(siteId))),
      equipment: text(pick(task, ['equipment'])),
      engineers: asArray(pick(task, ['engineers'])).map(engineerOf).filter(Boolean),
      url: contractLink('task', pick(task, ['id']), pick(task, ['url']), env),
    };
  });

  const reports = asArray(pick(body, ['serviceReports'])).map((report) => {
    const originalName = text(pick(report, ['originalName']));
    return {
      id: pick(report, ['id']) ?? null,
      taskId: pick(report, ['taskId']) ?? null,
      status: text(pick(report, ['status'])),
      originalName,
      title: originalName || 'Service report',
      siteName: text(pick(report, ['siteName'])),
      siteCustomer: text(pick(report, ['siteCustomer'])),
      machineSerial: text(pick(report, ['machineSerial'])),
      authorName: personName(pick(report, ['authorName'])),
      publishedAt: pick(report, ['publishedAt']) ?? null,
      createdAt: pick(report, ['createdAt']) ?? null,
      summary: shortText(pick(report, ['summary'])),
      url: contractLink('report', pick(report, ['id']), pick(report, ['url']), env),
    };
  });

  return { sites, tasks, serviceReports: reports };
}

function quiet(reason, env) {
  return {
    ok: false,
    reason,
    gmtUrl: gmtFieldConfig(env).base,
    sites: [],
    tasks: [],
    serviceReports: [],
  };
}

export async function loadCustomerFieldService(customerId, options = {}) {
  const env = options.env || process.env;
  const config = gmtFieldConfig(env);
  if (!config.configured) return quiet('unconfigured', env);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const url = fieldServiceUrl(customerId, env);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'X-GMT-Token': config.token,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return quiet('unreachable', env);
    const payload = await response.json();
    return {
      ok: true,
      gmtUrl: config.base,
      ...mapFieldService(payload, env),
    };
  } catch (error) {
    console.warn(`[gmt-field-service] customer ${customerId} unreachable: ${error?.message || 'request failed'}`);
    return quiet('unreachable', env);
  }
}

// Session auth is applied by the route. This handler only checks that the
// customer exists, then proxies. It never reads a contracts PIN.
export async function respondWithFieldService(req, res, deps = {}) {
  const id = parseCustomerId(req.params?.id);
  if (!id) return res.status(400).json({ error: 'Invalid customer id' });

  try {
    if (deps.findCustomer) {
      const customer = await deps.findCustomer(id);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
    }
    const load = deps.load || loadCustomerFieldService;
    const data = await load(id, deps);
    return res.json(data);
  } catch (error) {
    console.warn(`[gmt-field-service] customer ${id} failed: ${error?.message || 'unknown'}`);
    return res.json(quiet('unreachable', deps.env || process.env));
  }
}
