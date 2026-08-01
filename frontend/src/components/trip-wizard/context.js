// Pure helpers shared by the wizard steps: validation, and the two shapes we
// hand to the backend.

export const STEPS = ['Customers', 'Order', 'Constraints', 'Generate']

// Per-step blocking problems. Step 3 → 4 is deliberately absent: constraints
// may be empty and the planning assistant may be down, neither of which should
// trap the user in the interview.
export function stepErrors(draft) {
  const errors = { 1: [], 2: [], 3: [], 4: [] }
  const { title, startTime, endTime } = draft.meta

  if (!title.trim()) errors[1].push('Trip title is required')
  if (!startTime || !endTime) errors[1].push('Start and end dates are required')
  else if (new Date(endTime) <= new Date(startTime)) errors[1].push('End must be after start')
  if (!draft.stops.length) {
    errors[1].push('Select at least one customer')
    errors[2].push('Select at least one customer')
  }
  return errors
}

export const canLeave = (draft, step) => stepErrors(draft)[step].length === 0

// Highest step the user may jump to. Editing an existing trip usually means
// changing one thing, so a fully valid draft unlocks the whole stepper.
export function maxReachable(draft) {
  for (const step of [1, 2, 3]) if (!canLeave(draft, step)) return step
  return 4
}

// The trip shape POST /api/trips/plan-chat expects. Joins the draft's stop
// records against the live customer list — see utils/tripDraft for why the
// draft stores ids only.
export function buildChatContext(draft, customerById) {
  return {
    startTime: new Date(draft.meta.startTime).toISOString(),
    endTime: new Date(draft.meta.endTime).toISOString(),
    flights: draft.meta.flights.filter((f) => f.flightNo || f.routing || f.date),
    constraints: draft.constraints || null,
    stops: draft.stops
      .map((s) => {
        const c = customerById.get(s.customerId)
        if (!c) return null
        return {
          customer: {
            name: c.name,
            address: c.address ?? null,
            latitude: c.latitude ?? null,
            longitude: c.longitude ?? null,
          },
          priority: s.priority || null,
          visitDuration: s.visitDuration || null,
          notes: s.notes || null,
        }
      })
      .filter(Boolean),
  }
}

export function buildTripPayload(draft) {
  return {
    title: draft.meta.title.trim(),
    notes: draft.meta.notes.trim() || undefined,
    assigneeIds: draft.meta.assigneeIds,
    hidePhoneOnShare: draft.meta.hidePhoneOnShare,
    flights: draft.meta.flights.filter((f) => f.flightNo || f.routing || f.date),
    constraints: draft.constraints.trim() || null,
    startTime: new Date(draft.meta.startTime).toISOString(),
    endTime: new Date(draft.meta.endTime).toISOString(),
    // ALWAYS `stops`, NEVER `customerIds` — in both create and edit mode.
    //
    // Sending customerIds routes the backend into buildAutoStops(), which only
    // writes customerId/order/plannedArrival: priority, visitDuration and notes
    // fall back to defaults and the arrival times the planner computed get
    // overwritten with an even split. That was TripModal's bug — editing a
    // trip's title silently destroyed its schedule.
    //
    // The array index IS the order, and that ordering is not decorative: it
    // becomes TripStop.order → stopInclude's `orderBy: { order: 'asc' }` →
    // the numbered customer list in buildUserPrompt → the 1-based `index` the
    // model returns → the stop whose plannedArrival POST /:id/plan writes back.
    stops: draft.stops.map((s, i) => ({
      customerId: s.customerId,
      order: i,
      plannedArrival: s.plannedArrival ?? null,
      priority: s.priority || 'NORMAL',
      visitDuration: s.visitDuration?.trim() || null,
      notes: s.notes?.trim() || null,
    })),
  }
}
