import { useEffect, useMemo, useRef, useState } from 'react'
import { PROVIDERS, projectForProvider, loadLeaflet, numberedIcon } from '../utils/mapTiles'

const ROUTE_COLOR = '#0ea5e9'

// Renders an ordered trip itinerary: numbered stop markers connected by a route
// line. Shared by the authenticated trip detail and the public share page.
// `stops` are pre-ordered (order asc); each has a `customer` with lat/long.
export default function TripMap({ stops, height = 460 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const tileRef = useRef(null)
  const tileProviderRef = useRef(null)
  const [error, setError] = useState('')

  const [provider, setProvider] = useState(
    () => localStorage.getItem('tripMapProvider') || 'esri',
  )
  useEffect(() => {
    localStorage.setItem('tripMapProvider', provider)
  }, [provider])

  const located = useMemo(
    () =>
      (stops || []).filter(
        (s) =>
          typeof s.customer?.latitude === 'number' &&
          typeof s.customer?.longitude === 'number',
      ),
    [stops],
  )

  const locatedKey = useMemo(
    () =>
      located
        .map((s) => `${s.id}:${s.customer.latitude},${s.customer.longitude}:${s.order}`)
        .join('|'),
    [located],
  )

  useEffect(() => {
    let cancelled = false
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return
        if (!mapRef.current) {
          mapRef.current = L.map(containerRef.current, { scrollWheelZoom: true }).setView([35, 110], 4)
          layerRef.current = L.layerGroup().addTo(mapRef.current)
        }
        const cfg = PROVIDERS[provider] || PROVIDERS.esri
        if (tileProviderRef.current !== provider) {
          if (tileRef.current) tileRef.current.remove()
          tileRef.current = L.tileLayer(cfg.url, {
            subdomains: cfg.subdomains,
            attribution: cfg.attribution,
            maxZoom: 18,
          }).addTo(mapRef.current)
          tileProviderRef.current = provider
        }
        layerRef.current.clearLayers()
        const path = []
        located.forEach((s, i) => {
          const [mlat, mlng] = projectForProvider(
            s.customer.latitude,
            s.customer.longitude,
            cfg.crs,
          )
          path.push([mlat, mlng])
          const marker = L.marker([mlat, mlng], { icon: numberedIcon(L, ROUTE_COLOR, i + 1) })
          const when = s.plannedArrival
            ? new Date(s.plannedArrival).toLocaleString('en-US')
            : ''
          marker.bindPopup(
            `<strong>${i + 1}. ${s.customer.name}</strong>` +
              (s.customer.address ? `<br/>${s.customer.address}` : '') +
              (s.customer.contactName ? `<br/>${s.customer.contactName}` : '') +
              (s.customer.contactPhone ? ` · ${s.customer.contactPhone}` : '') +
              (when ? `<br/><span style="color:#64748b">${when}</span>` : ''),
          )
          marker.addTo(layerRef.current)
        })
        if (path.length > 1) {
          L.polyline(path, { color: ROUTE_COLOR, weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(
            layerRef.current,
          )
          mapRef.current.fitBounds(path, { padding: [40, 40] })
        } else if (path.length === 1) {
          mapRef.current.setView(path[0], 9)
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
      <div className="absolute right-3 top-3 z-[10]">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-500"
          title="Map source"
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
      <div
        ref={containerRef}
        style={{ height: `${height}px` }}
        className="w-full rounded-2xl border border-slate-200"
      />
      {located.length === 0 && (
        <p className="mt-3 text-center text-sm text-slate-500">
          No stops have coordinates yet. Add an address to each customer to plot them here.
        </p>
      )}
    </div>
  )
}
