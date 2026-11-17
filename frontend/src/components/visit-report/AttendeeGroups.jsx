// Shared attendee chip layout used by structured visit reports and by
// preserved Word bodies that contain a participants table.
//
// Labels sit in a fixed column so CUSTOMER / WALDRICHSIEGEN line up.
// Each person (name + role) is one chip that wraps as a unit; text
// inside a chip does not break mid-word.

export default function AttendeeGroups({ groups, heading = null, className = '' }) {
  const list = (groups || []).filter((group) => group?.people?.length || group?.names?.length)
  if (!list.length) return null

  return (
    <section className={className} data-attendees>
      {heading}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        {list.map((group) => {
          const people = group.people || group.names || []
          return (
            <div key={group.label} className="contents">
              <div className="flex min-h-[1.75rem] items-center">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.label}
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {people.map((person) => (
                  <span
                    key={person}
                    className="inline-flex min-h-[1.75rem] max-w-full items-center rounded-full bg-slate-100 px-2.5 py-1 text-left text-sm leading-5 text-slate-700 hyphens-none break-normal"
                  >
                    {person}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
