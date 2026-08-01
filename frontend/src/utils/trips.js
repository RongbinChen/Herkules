// Order trip stops by their recommended arrival date (earliest first). Stops
// without a date sort to the end; ties fall back to the stored `order`.
//
// This is the single source of truth for stop ordering: both the authenticated
// trip detail map and the public share map render stops in this order, so the
// numbered markers stay consistent between the two views. (The DB `order` field
// reflects the original geographic route and can diverge from the chronological
// plan after the AI assigns arrival dates, so we never display by `order`.)
export function sortStopsByArrival(list) {
  return [...(list || [])].sort((a, b) => {
    const ta = a.plannedArrival ? Date.parse(a.plannedArrival) : Infinity
    const tb = b.plannedArrival ? Date.parse(b.plannedArrival) : Infinity
    if (ta !== tb) return ta - tb
    return (a.order ?? 0) - (b.order ?? 0)
  })
}

// ── Geographic ordering ──────────────────────────────────────────────────────
// Deliberate duplicate of haversine / orderByNearestNeighbour in
// backend/src/routes/trips.js (the `// ── Geographic helpers ──` block). The
// wizard offers "Suggest geographic order" before the trip exists, so there is
// no endpoint to ask. Keep the two in step if either changes — the behaviour is
// identical by construction, including the two quirks below.

function haversine(a, b) {
  const R = 6371 // km
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const hasCoords = (c) =>
  typeof c?.latitude === 'number' && typeof c?.longitude === 'number'

// Nearest-neighbour route, starting from the first located customer. Two known
// limitations, kept because the backend has them and diverging would be worse
// than either: the start point is whatever comes first rather than the best
// starting city, and customers without coordinates are appended at the end
// because they cannot be routed.
export function orderByNearestNeighbour(customers) {
  const located = customers.filter(hasCoords)
  const unlocated = customers.filter((c) => !hasCoords(c))
  if (located.length <= 2) return [...located, ...unlocated]

  const remaining = [...located]
  const ordered = [remaining.shift()]
  while (remaining.length) {
    const current = ordered[ordered.length - 1]
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(current, remaining[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0])
  }
  return [...ordered, ...unlocated]
}
