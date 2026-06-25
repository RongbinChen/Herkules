import { useEffect, useMemo, useRef, useState } from 'react'
import { PROVIDERS, projectForProvider, loadLeaflet, markerIcon } from '../utils/mapTiles'

// Status → marker colour (matches the badges used elsewhere).
const STATUS_COLOR = {
  LEAD: '#f59e0b',
  ACTIVE: '#10b981',
  INACTIVE: '#94a3b8',
  LOST: '#ef4444',
}

export default function CustomerMap({ customers, onSelect }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const tileRef = useRef(null)
  const tileProviderRef = useRef(null)
  const [error, setError] = useState('')

  // Remember the chosen basemap across sessions; default to AMap for China.
  const [provider, setProvider] = useState(() => {
    const stored = localStorage.getItem('customerMapProvider')
    return PROVIDERS[stored] ? stored : 'amap'
  })
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
