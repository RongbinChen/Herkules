// Shared Leaflet basemap helpers used by the customer map and trip map.
// Provides China-accessible tile sources (AMap/高德) plus the WGS-84 → GCJ-02
// coordinate conversion needed so GPS coordinates line up on Chinese basemaps.

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'

// Tile providers. AMap (高德) is the China-accessible default; OSM is the
// international fallback. `crs` says which datum the tiles are drawn in.
// Two basemaps for users to choose: Google (English labels, for international
// viewers) and AMap/高德 (China-accessible). Both render China roadmaps in
// GCJ-02, so the shared WGS-84→GCJ-02 conversion aligns markers in both
// (and leaves non-China points untouched).
//
// NOTE: Google here uses the keyless public tile endpoint for now. When a
// Google Maps API key is available, swap this to the official Maps JavaScript
// API (e.g. via leaflet.gridlayer.googlemutant) for ToS compliance + reliability.
export const PROVIDERS = {
  google: {
    label: 'Google Maps',
    url: 'https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google',
    crs: 'gcj02',
  },
  amap: {
    label: 'AMap (高德)',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; AMap AutoNavi',
    crs: 'gcj02',
  },
}

// ── WGS-84 → GCJ-02 ("Mars coordinates") conversion ──────────────────────────
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
export function projectForProvider(lat, lng, crs) {
  return crs === 'gcj02' ? wgs84ToGcj02(lat, lng) : [lat, lng]
}

// Lazily inject Leaflet from CDN once; resolve when window.L is available.
let leafletPromise = null
export function loadLeaflet() {
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

// A teardrop pin marker in the given colour.
export function markerIcon(L, color) {
  return L.divIcon({
    className: 'map-pin-marker',
    html: `<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
    popupAnchor: [0, -18],
  })
}

// A numbered circular marker for ordered trip stops.
export function numberedIcon(L, color, n) {
  return L.divIcon({
    className: 'map-number-marker',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font-size:13px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${n}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}
