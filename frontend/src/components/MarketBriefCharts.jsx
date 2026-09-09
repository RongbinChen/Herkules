/**
 * Charts and prose rendering for the AI Market Brief.
 *
 * The charts are drawn from the aggregates the backend hands over — the same
 * numbers the model was shown when it wrote the text. Nothing here is model
 * output: the model writes the reading, the database supplies the figures.
 *
 * Inline SVG, no chart library. The page already hand-rolls its bar chart the
 * same way, and a 200-line dependency for three small figures would be the
 * larger cost.
 */
import { useState } from 'react';

// Categorical slots, brand blue first so the brief sits inside the app's
// palette. Validated (lightness band / chroma / CVD separation / normal-vision
// separation) before use — the pairs that fall under 3:1 against the surface
// are why every segment below carries a visible label rather than relying on
// its colour to be identified.
const SERIES = ['#1c6cb0', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const REST = '#94a3b8';
const INK = '#334155';
const MUTED = '#94a3b8';
const GRID = '#e2e8f0';

const nf = (n) => new Intl.NumberFormat('en-US').format(n);

// The brief has a language toggle, so the few words the charts own follow it.
const T = {
  en: { other: 'Other', peak: 'Peak', tenders: 'tenders', none: 'No awards recorded in this period',
        ownNone: 'Our own group: no recorded awards this period' },
  zh: { other: '其他', peak: '峰值', tenders: '个招标', none: '本期没有中标记录',
        ownNone: '本集团本期没有中标记录' },
};
const t = (lang) => T[lang === 'zh' ? 'zh' : 'en'];

// ── Prose ───────────────────────────────────────────────────────────────────
// The model returns Markdown. It used to be printed raw, so readers saw the
// literal "## 1. Market Overview" and "**Reporting Period:**". This renders the
// subset the prompt actually produces — headings, bold, bullets, rules — and
// leaves anything else as plain text rather than pretending to be a full
// Markdown engine.
function inline(text, keyBase) {
  // Split on **bold**; odd indices are the bold runs.
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (
    i % 2 === 1
      ? <strong key={`${keyBase}-${i}`} className="font-semibold text-slate-900">{part}</strong>
      : <span key={`${keyBase}-${i}`}>{part}</span>
  ));
}

export function BriefProse({ text }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const blocks = [];
  let list = null;

  const flush = () => {
    if (list) { blocks.push(<ul key={`ul-${blocks.length}`} className="my-2 space-y-1.5">{list}</ul>); list = null; }
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={`hr-${i}`} className="my-4 border-slate-200" />);
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const depth = heading[1].length;
      // The model's own h1 repeats the panel title, so it is stepped down to
      // sit under it rather than competing with it.
      const cls = depth <= 2
        ? 'mt-5 text-sm font-bold text-slate-900 first:mt-0'
        : 'mt-4 text-[13px] font-semibold text-slate-800';
      blocks.push(<p key={`h-${i}`} className={cls}>{inline(heading[2], `h-${i}`)}</p>);
      return;
    }
    const bullet = line.match(/^\s*[-*·]\s+(.*)$/);
    if (bullet) {
      list ??= [];
      list.push(
        <li key={`li-${i}`} className="relative pl-4 text-[13px] leading-relaxed text-slate-600">
          <span className="absolute left-0 top-[0.55em] h-1 w-1 rounded-full bg-slate-300" />
          {inline(bullet[1], `li-${i}`)}
        </li>,
      );
      return;
    }
    flush();
    if (!line.trim()) return;
    blocks.push(
      <p key={`p-${i}`} className="mt-2 text-[13px] leading-relaxed text-slate-600 first:mt-0">
        {inline(line, `p-${i}`)}
      </p>,
    );
  });
  flush();
  return <div className="max-w-3xl">{blocks}</div>;
}

// ── Trend over time: one series, so an area in a single hue and no legend ────
export function TrendArea({ monthly, lang = 'en' }) {
  const w = t(lang);
  const [hover, setHover] = useState(null);
  if (!monthly?.length) return null;

  // Right padding leaves room for the end-point label to sit inside the frame
  // instead of hanging off it.
  const W = 320, H = 128, L = 26, R = 18, T = 16, B = 18;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(...monthly.map((m) => m.total), 1);
  const x = (i) => L + (monthly.length === 1 ? iw / 2 : (i / (monthly.length - 1)) * iw);
  const y = (v) => T + ih - (v / max) * ih;

  const line = monthly.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(m.total)}`).join(' ');
  const area = `${line} L${x(monthly.length - 1)},${T + ih} L${x(0)},${T + ih} Z`;
  const peak = monthly.reduce((a, b) => (b.total > a.total ? b : a), monthly[0]);
  const last = monthly[monthly.length - 1];
  // Only the two points that carry the story get a number; the rest are the
  // shape, and the hover layer answers anything else.
  const labelled = new Set([peak.month, last.month]);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Monthly tender count, ${monthly[0].month} to ${last.month}, peak ${peak.total} in ${peak.month}`}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={L} x2={W - R} y1={T + ih * f} y2={T + ih * f} stroke={GRID} strokeWidth="1" />
        ))}
        <text x={L - 6} y={T + 4} textAnchor="end" fill={MUTED} fontSize="9">{max}</text>
        <text x={L - 6} y={T + ih + 3} textAnchor="end" fill={MUTED} fontSize="9">0</text>

        <defs>
          <linearGradient id="brief-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.20" />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#brief-trend-fill)" />
        <path d={line} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {monthly.map((m, i) => (
          <g key={m.month}>
            {labelled.has(m.month) && (
              <>
                <circle cx={x(i)} cy={y(m.total)} r="3.5" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
                {/* The end point's label is pulled inside the frame; at the
                    right edge a centred label would hang over the border. */}
                {/* A label on a low point goes underneath it — above, it lands
                    on the line running into the point. */}
                <text
                  x={i === monthly.length - 1 ? x(i) + 2 : x(i)}
                  y={m.total < max * 0.5 ? y(m.total) + 13 : y(m.total) - 9}
                  textAnchor={i === monthly.length - 1 ? 'end' : 'middle'}
                  fill={INK} fontSize="10" fontWeight="600"
                >{m.total}</text>
              </>
            )}
            <text x={x(i)} y={H - 6} textAnchor="middle" fill={MUTED} fontSize="9">
              {m.month.slice(5)}
            </text>
            {/* Hit target wider than the mark. */}
            <rect x={x(i) - iw / (monthly.length * 2 || 1)} y={T} width={iw / (monthly.length || 1)} height={ih}
              fill="transparent" onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
        {hover && (
          <g pointerEvents="none">
            <line x1={x(monthly.indexOf(hover))} x2={x(monthly.indexOf(hover))} y1={T} y2={T + ih}
              stroke={SERIES[0]} strokeWidth="1" strokeOpacity="0.35" />
            <circle cx={x(monthly.indexOf(hover))} cy={y(hover.total)} r="4" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      <figcaption className="mt-1 h-4 text-[11px] text-slate-500">
        {hover ? `${hover.month} · ${nf(hover.total)} ${w.tenders}` : `${w.peak} ${peak.month} · ${nf(peak.total)}`}
      </figcaption>
    </figure>
  );
}

// ── Part-to-whole: a share bar, not a pie ───────────────────────────────────
// The top three equipment types run close together (132 / 127 / 108). Sliced
// into a pie those three arcs are indistinguishable, which is the one thing a
// pie is worst at; laid end to end on a single bar they stay comparable, and
// long category names get a legend line each instead of a leader line.
export function ShareBar({ items, total, lang = 'en' }) {
  const w = t(lang);
  const [hover, setHover] = useState(null);
  if (!items?.length || !total) return null;
  const shown = items.slice(0, 5);
  const rest = Math.max(total - shown.reduce((s, i) => s + i.count, 0), 0);
  const segs = [
    ...shown.map((it, i) => ({ ...it, color: SERIES[i] })),
    ...(rest > 0 ? [{ name: w.other, count: rest, color: REST }] : []),
  ];
  const pct = (n) => (n / total) * 100;

  return (
    <figure className="m-0">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
        {segs.map((s, i) => (
          <div
            key={s.name}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(null)}
            title={`${s.name}: ${nf(s.count)} (${pct(s.count).toFixed(1)}%)`}
            style={{ width: `${pct(s.count)}%`, background: s.color }}
            className={`h-full transition-opacity ${i === 0 ? 'rounded-l' : ''} ${i === segs.length - 1 ? 'rounded-r' : ''} ${
              hover && hover.name !== s.name ? 'opacity-45' : ''
            }`}
          />
        ))}
      </div>
      {/* The legend is not optional: several of these hues sit under 3:1
          against a white card, so identity is carried by the label, not the
          colour. */}
      <ul className="mt-2.5 space-y-1">
        {segs.map((s) => (
          <li key={s.name} className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600" title={s.name}>{s.name}</span>
            <span className="shrink-0 font-semibold text-slate-700">{nf(s.count)}</span>
            <span className="w-9 shrink-0 text-right text-slate-400">{pct(s.count).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ── Competitor wins: emphasis, not eight more hues ──────────────────────────
// Our own group is the series that matters and everyone else is context, so
// the group is painted and the rest are grey. When the group has no wins at
// all the chart says so in words — an absent bar is not a readable zero.
export function WinsBar({ competitors, lang = 'en' }) {
  const w = t(lang);
  if (!competitors?.length) {
    return <p className="text-[11px] text-slate-400">{w.none}</p>;
  }
  const max = Math.max(...competitors.map((c) => c.winCount), 1);
  const ours = competitors.filter((c) => c.watchType === 'OWN');
  return (
    <figure className="m-0">
      <ul className="space-y-1.5">
        {competitors.map((c) => {
          const own = c.watchType === 'OWN';
          return (
            <li key={c.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 shrink-0 truncate text-slate-600" title={c.name}>{c.name}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-100">
                <span className="block h-full rounded-sm"
                  style={{ width: `${(c.winCount / max) * 100}%`, background: own ? SERIES[0] : REST }} />
              </span>
              <span className={`w-5 shrink-0 text-right font-semibold ${own ? 'text-slate-900' : 'text-slate-600'}`}>
                {c.winCount}
              </span>
            </li>
          );
        })}
      </ul>
      {/* Which companies count as "ours" is a database flag, so the note does
          not name them — naming can contradict the bars right above. */}
      {ours.length === 0 && (
        <p className="mt-2 text-[11px] font-medium text-slate-500">{w.ownNone}</p>
      )}
    </figure>
  );
}
