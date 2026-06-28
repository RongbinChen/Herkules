// Renders the planned itinerary (flights + day-by-day + planning notes) in a
// mobile-friendly layout. Shared by the trip detail and the public share page.
export default function TripPlanView({ trip }) {
  const flights = Array.isArray(trip.flights) ? trip.flights : []
  const days = trip.itinerary?.days || []
  const notes = trip.itinerary?.notes || []

  return (
    <div className="space-y-6">
      {flights.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Flights</h3>
          <ul className="space-y-2">
            {flights.map((f, i) => (
              <li key={i} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {f.date && <span className="font-semibold text-slate-800">{f.date}</span>}
                  {f.flightNo && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-sky-700">{f.flightNo}</span>}
                  {f.routing && <span className="text-slate-700">{f.routing}</span>}
                  {f.time && <span className="text-slate-500">{f.time}</span>}
                </div>
                {f.notes && <p className="mt-1 text-xs text-slate-500">{f.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Day-by-day itinerary</h3>
        {days.length === 0 ? (
          <p className="text-sm text-slate-400">No itinerary generated yet.</p>
        ) : (
          <ol className="space-y-2">
            {days.map((d, i) => (
              <li key={i} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-slate-800">{d.date}</span>
                  {d.day && <span className="text-xs font-medium text-slate-400">{d.day}</span>}
                  {d.location && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{d.location}</span>
                  )}
                </div>
                {d.program && <p className="mt-1 text-sm text-slate-700">{d.program}</p>}
                {d.logistics && <p className="mt-1 text-xs text-slate-500">🚗 {d.logistics}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {notes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Planning notes</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
