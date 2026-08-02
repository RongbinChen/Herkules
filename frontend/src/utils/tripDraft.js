// Draft persistence for the trip wizard.
//
// A trip is only created in the database when the user reaches the last step
// and presses Generate — everything before that lives here. localStorage rather
// than a DRAFT row on the server keeps prisma/schema.prisma untouched (a schema
// change halts the auto-deploy and needs a manual migration on the VPS), at the
// cost of drafts not following the user across devices. For a wizard you finish
// in one sitting that is the right trade.

export const DRAFT_VERSION = 1
const PREFIX = 'tripDraft:'
// A trip you started planning a week ago is not a draft any more.
const TTL_MS = 7 * 24 * 3600 * 1000
// localStorage is ~5 MB per origin; a long interview must not be able to fill it.
const MAX_CHAT = 30

export const draftKey = (mode, tripId) =>
  mode === 'edit' ? `${PREFIX}v${DRAFT_VERSION}:edit:${tripId}` : `${PREFIX}v${DRAFT_VERSION}:new`

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time.
export function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function emptyDraft(mode = 'create', tripId = null) {
  const now = new Date()
  const plus3 = new Date(Date.now() + 3 * 86400000)
  return {
    v: DRAFT_VERSION,
    mode,
    tripId,
    updatedAt: Date.now(),
    // edit mode: the trip.updatedAt this draft was seeded from, so we can spot
    // the trip changing underneath us.
    baseUpdatedAt: null,
    meta: {
      title: '',
      startTime: toLocalInput(now),
      endTime: toLocalInput(plus3),
      assigneeIds: [],
      notes: '',
      hidePhoneOnShare: false,
      flights: [],
    },
    // Only customerId + the fields the user edits. Names/addresses/coordinates
    // are joined in from the live customer list at render time, so a draft can
    // never show a stale address, and a customer deleted meanwhile just drops
    // out (same semantics as the backend's buildManualStops filter).
    stops: [],
    chat: [],
    constraints: '',
    // Once the user edits the constraints by hand, the AI summary stops
    // overwriting them.
    constraintsEdited: false,
    // Interview state: whether the assistant says it has enough, which
    // checklist items it still wants, and how long the transcript was when we
    // last condensed it (so re-entering step 3 doesn't re-summarise for free).
    ready: false,
    missing: [],
    summarisedChatLen: 0,
    // Set the moment POST /trips succeeds. This is what stops a retry after a
    // failed plan from creating a second trip.
    createdTripId: null,
  }
}

export function loadDraft(mode, tripId) {
  try {
    const raw = localStorage.getItem(draftKey(mode, tripId))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || d.v !== DRAFT_VERSION) return null
    if (Date.now() - (d.updatedAt || 0) > TTL_MS) return null
    return d
  } catch {
    return null
  }
}

export function saveDraft(draft) {
  try {
    localStorage.setItem(
      draftKey(draft.mode, draft.tripId),
      JSON.stringify({ ...draft, updatedAt: Date.now(), chat: (draft.chat || []).slice(-MAX_CHAT) }),
    )
  } catch (err) {
    // Quota exceeded / private mode. Losing the draft is bad; breaking the
    // wizard the user is in the middle of is worse.
    console.warn('[tripDraft] could not persist draft', err)
  }
}

export function clearDraft(mode, tripId) {
  try {
    localStorage.removeItem(draftKey(mode, tripId))
  } catch {
    /* nothing useful to do */
  }
}

// Drop drafts from other schema versions and expired ones. Called once when the
// wizard mounts — which makes bumping DRAFT_VERSION a safe way to ship a
// breaking change to the draft shape.
export function purgeStaleDrafts() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PREFIX)) continue
      if (!key.startsWith(`${PREFIX}v${DRAFT_VERSION}:`)) {
        localStorage.removeItem(key)
        continue
      }
      try {
        const d = JSON.parse(localStorage.getItem(key))
        if (!d || Date.now() - (d.updatedAt || 0) > TTL_MS) localStorage.removeItem(key)
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* localStorage unavailable — nothing to purge */
  }
}

// Seed an edit-mode draft from a saved trip.
export function draftFromTrip(trip, sortedStops) {
  return {
    ...emptyDraft('edit', trip.id),
    baseUpdatedAt: trip.updatedAt || null,
    meta: {
      title: trip.title || '',
      startTime: toLocalInput(trip.startTime),
      endTime: toLocalInput(trip.endTime),
      assigneeIds: (trip.assignees || []).map((a) => a.id),
      notes: trip.notes || '',
      hidePhoneOnShare: trip.hidePhoneOnShare === true,
      flights: Array.isArray(trip.flights) ? trip.flights : [],
    },
    stops: (sortedStops || []).map((s) => ({
      customerId: s.customer.id,
      priority: s.priority || 'NORMAL',
      visitDuration: s.visitDuration || '',
      notes: s.notes || '',
      // Carried through so a metadata-only edit does not throw away the times
      // the planner worked out.
      plannedArrival: s.plannedArrival || null,
    })),
    constraints: trip.constraints || '',
    constraintsEdited: Boolean(trip.constraints),
  }
}
