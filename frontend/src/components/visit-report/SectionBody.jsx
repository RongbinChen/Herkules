// Renders one visit-report section.
//
// The sections are stored as free text, but a lot of that text is already a
// list — the model writes "1. Wanli to provide… 2. Based on these details…
// 3. Keep in close contact…" and it arrives as one run-on paragraph. The
// structure is there; only the rendering was missing.
//
// Deliberately conservative. Every rule below needs positive evidence before it
// changes anything, and anything ambiguous stays a paragraph: a formatter that
// guesses wrong mangles a report somebody has to send to a customer, which is
// worse than a paragraph that was a bit long.

// "1. x 2. y 3. z" or "(1) x (2) y" — run together inside one paragraph.
// The markers must start at 1 and ascend, so a stray "2 units" or a dimension
// like "1. 5m" cannot split a sentence in half.
function inlineOrdered(text) {
  const marks = [...text.matchAll(/(?:^|\s)\(?(\d{1,2})[.)）]\s+/g)];
  if (marks.length < 2) return null;
  const nums = marks.map((m) => Number(m[1]));
  if (!nums.every((n, i) => n === i + 1)) return null;
  const items = marks.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : text.length;
    return text.slice(from, to).trim().replace(/[.;]$/, '');
  });
  if (!items.every(Boolean)) return null;
  // A sentence before "1." is context, not an item.
  return { lead: text.slice(0, marks[0].index).trim(), items };
}

// Lines the writer already bulleted or numbered themselves.
function lineList(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const marker = /^([-•*]|\d{1,2}[.)）])\s+/;
  const bulleted = lines.filter((l) => marker.test(l));
  if (bulleted.length < 2 || bulleted.length < lines.length - 1) return null;
  return {
    ordered: /^\d/.test(bulleted[0]),
    lead: marker.test(lines[0]) ? '' : lines[0],
    items: bulleted.map((l) => l.replace(marker, '')),
  };
}

// "Customer: A, B, C. WaldrichSiegen: D, E" — who was in the room, by side.
function namedGroups(text) {
  const hits = [...text.matchAll(/(?:^|[.;；]\s*)([A-Za-z][\w\s&'.-]{1,28}?)\s*[:：]\s*/g)];
  if (hits.length < 2) return null;
  const groups = hits.map((h, i) => {
    const from = h.index + h[0].length;
    const to = i + 1 < hits.length ? hits[i + 1].index : text.length;
    const names = text.slice(from, to)
      .replace(/[.;；]\s*$/, '')
      .split(/[,，、]/)
      .map((n) => n.trim())
      .filter(Boolean);
    return { label: h[1].trim(), names };
  });
  // Every group needs at least one name, or it was not a list of people.
  return groups.every((g) => g.names.length) ? groups : null;
}

function List({ ordered, items }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`mt-1 space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 ${ordered ? 'list-decimal' : 'list-disc'}`}>
      {items.map((it, i) => <li key={i} className="pl-0.5">{it}</li>)}
    </Tag>
  );
}

export default function SectionBody({ sectionKey, text }) {
  const body = String(text || '').trim();
  if (!body) return null;

  // Attendees is the one section whose shape is known in advance, so the
  // people-specific rule is tried there and only there.
  if (sectionKey === 'attendees') {
    const groups = namedGroups(body);
    if (groups) {
      return (
        <div className="mt-1 space-y-2">
          {groups.map((g) => (
            <div key={g.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</span>
              {g.names.map((n) => (
                <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-sm text-slate-700">{n}</span>
              ))}
            </div>
          ))}
        </div>
      );
    }
  }

  const byLine = lineList(body);
  if (byLine) {
    return (
      <>
        {byLine.lead && <p className="text-sm leading-relaxed text-slate-700">{byLine.lead}</p>}
        <List ordered={byLine.ordered} items={byLine.items} />
      </>
    );
  }

  const inline = inlineOrdered(body);
  if (inline) {
    return (
      <>
        {inline.lead && <p className="text-sm leading-relaxed text-slate-700">{inline.lead}</p>}
        <List ordered items={inline.items} />
      </>
    );
  }

  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>;
}
