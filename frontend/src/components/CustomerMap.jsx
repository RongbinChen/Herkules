import { useEffect, useMemo, useRef, useState } from 'react'

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'

// Status → marker colour (matches the badges used elsewhere).
const STATUS_COLOR = {
  LEAD: '#f59e0b',
  ACTIVE: '#10b981',
  INACTIVE: '#94a3b8',
  LOST: '#ef4444',
}

// Tile providers. AMap (高德) is the China-accessible default; OSM is the
// international fallback. `crs` says which datum the tiles are drawn in so we
// can convert the (WGS-84) customer coordinates to match — without this the
// markers would be offset by hundreds of metres on the AMap basemap.
const PROVIDERS = {
  amap: {
    label: '高德地图',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图 AutoNavi',
    crs: 'gcj02',
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap contributors',
    crs: 'wgs84',
  },
}

// ── WGS-84 → GCJ-02 ("Mars coordinates") conversion ──────────────────────────
// Chinese basemaps (AMap/高德, Baidu) use GCJ-02, offset from raw GPS/WGS-84.
const GCJ_PI = Math.PI
const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}
function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2) / 3
  ret += ((20 * Math.sin(y * GCJ_PI) + 40 * Math.sin((y / 3) * GCJ_PI)) * 2) / 3
  ret += ((160 * Math.sin((y / 12) * GCJ_PI) + 320 * Math.sin((y * GCJ_PI) / 30)) * 2) / 3
  return ret
}
function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2) / 3
  ret += ((20 * Math.sin(x * GCJ_PI) + 40 * Math.sin((x / 3) * GCJ_PI)) * 2) / 3
  ret += ((150 * Math.sin((x / 12) * GCJ_PI) + 300 * Math.sin((x / 30) * GCJ_PI)) * 2) / 3
  return ret
}
function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng]
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * GCJ_PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * GCJ_PI)
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * GCJ_PI)
  return [lat + dLat, lng + dLng]
}

// Project a WGS-84 coordinate into the datum the active basemap uses.
function projectForProvider(lat, lng, crs) {
  return crs === 'gcj02' ? wgs84ToGcj02(lat, lng) : [lat, lng]
}

// Lazily inject Leaflet from CDN once; resolve when window.L is available.
let leafletPromise = null
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = LEAFLET_CSS
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.src = LEAFLET_JS
    script.async = true
    script.onload = () => resolve(window.L)
    script.onerror = () => reject(new Error('Failed to load Leaflet'))
    document.body.appendChild(script)
  })
  return leafletPromise
}

function markerIcon(L, color) {
  return L.divIcon({
    className: 'customer-map-marker',
    html: `<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
    popupAnchor: [0, -18],
  })
}

export default function CustomerMap({ customers, onSelect }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const tileRef = useRef(null)
  const tileProviderRef = useRef(null)
  const [error, setError] = useState('')

  // Remember the chosen basemap across sessions; default to AMap for China.
  const [provider, setProvider] = useState(
    () => localStorage.getItem('customerMapProvider') || 'amap',
  )
  useEffect(() => {
    localStorage.setItem('customerMapProvider', provider)
  }, [provider])

  const located = useMemo(
    () =>
      customers.filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      ),
    [customers],
  )

  // A stable signature of what the markers actually depend on, so the redraw
  // effect only re-runs when coordinates/status change — not on every parent
  // render (which would reset the user's pan/zoom via fitBounds).
  const locatedKey = useMemo(
    () => located.map((c) => `${c.id}:${c.latitude},${c.longitude}:${c.status}`).join('|'),
    [located],
  )

  // Keep onSelect in a ref so marker handlers call the latest callback without
  // making the (possibly inline) prop a redraw dependency.
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    let cancelled = false
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return
        if (!mapRef.current) {
          mapRef.current = L.map(containerRef.current, { scrollWheelZoom: true }).setView([35, 110], 4)
          layerRef.current = L.layerGroup().addTo(mapRef.current)
        }
        const cfg = PROVIDERS[provider] || PROVIDERS.amap
        // Swap the basemap only when the provider actually changes, to avoid a
        // tile reload flicker on plain marker-data updates.
        if (tileProviderRef.current !== provider) {
          if (tileRef.current) tileRef.current.remove()
          tileRef.current = L.tileLayer(cfg.url, {
            subdomains: cfg.subdomains,
            attribution: cfg.attribution,
            maxZoom: 18,
          }).addTo(mapRef.current)
          tileProviderRef.current = provider
        }
        // Redraw markers in the active basemap's datum.
        layerRef.current.clearLayers()
        const bounds = []
        located.forEach((c) => {
          const [mlat, mlng] = projectForProvider(c.latitude, c.longitude, cfg.crs)
          const color = STATUS_COLOR[c.status] || STATUS_COLOR.LEAD
          const marker = L.marker([mlat, mlng], { icon: markerIcon(L, color) })
          const visits = c._count?.events ?? 0
          marker.bindPopup(
            `<strong>${c.name}</strong><br/>${c.status} · Tier ${c.tier}<br/>${visits} visit(s)` +
              (c.contactName ? `<br/>${c.contactName}` : ''),
          )
          marker.on('click', () => onSelectRef.current?.(c))
          marker.addTo(layerRef.current)
          bounds.push([mlat, mlng])
        })
        if (bounds.length === 1) {
          mapRef.current.setView(bounds[0], 7)
        } else if (bounds.length > 1) {
          mapRef.current.fitBounds(bounds, { padding: [40, 40] })
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load map')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatedKey, provider])

  // Tear down the map on unmount.
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  return (
    <div className="relative">
      {/* Basemap source switcher */}
      <div className="absolute right-3 top-3 z-[10]">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-500"
          title="选择地图源"
        >
          {Object.entries(PROVIDERS).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div className="absolute inset-x-0 top-0 z-[5] m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}
      <div ref={containerRef} className="h-[600px] w-full rounded-2xl border border-slate-200" />
      {located.length === 0 && (
        <p className="mt-3 text-center text-sm text-slate-500">
          No customers have coordinates yet. Add latitude/longitude on a customer to plot it here.
        </p>
      )}
    </div>
  )
}
