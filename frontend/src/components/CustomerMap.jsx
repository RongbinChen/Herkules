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
  const [error, setError] = useState('')

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
          mapRef.current = L.map(containerRef.current, { scrollWheelZoom: true }).setView([32, 110], 4)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
          }).addTo(mapRef.current)
          layerRef.current = L.layerGroup().addTo(mapRef.current)
        }
        // Redraw markers.
        layerRef.current.clearLayers()
        const bounds = []
        located.forEach((c) => {
          const color = STATUS_COLOR[c.status] || STATUS_COLOR.LEAD
          const marker = L.marker([c.latitude, c.longitude], { icon: markerIcon(L, color) })
          const visits = c._count?.events ?? 0
          marker.bindPopup(
            `<strong>${c.name}</strong><br/>${c.status} · Tier ${c.tier}<br/>${visits} visit(s)` +
              (c.contactName ? `<br/>${c.contactName}` : ''),
          )
          marker.on('click', () => onSelectRef.current?.(c))
          marker.addTo(layerRef.current)
          bounds.push([c.latitude, c.longitude])
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
  }, [locatedKey])

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
