// Presentational ordered stop list, shared by the trip detail and the public
// share page so both render the itinerary identically.
export default function TripItinerary({ stops }) {
  if (!stops || stops.length === 0) {
    return <p className="text-sm text-slate-400">This trip has no stops.</p>
  }
  return (
    <ol className="space-y-3">
      {stops.map((s, i) => (
        <li key={s.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800">{s.customer.name}</p>
            {s.customer.address && <p className="mt-0.5 text-sm text-slate-500">{s.customer.address}</p>}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
              {s.customer.contactName && (
                <span>
                  Contact: {s.customer.contactName}
                  {s.customer.contactPhone ? ` · ${s.customer.contactPhone}` : ''}
                </span>
              )}
              {s.plannedArrival && <span>Arrival: {new Date(s.plannedArrival).toLocaleString('en-US')}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
