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
