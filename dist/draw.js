/* The shared drawing parts of the pages: icons, hints, rings, chart grids, readouts, the month picker and the
   day line. Each returns markup as text; none reads the clock or the page. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
const { clamp01, pct, say, cap, yearKeys, daysIn } = await import(`./core.js${v}`);

// Icons drawn as lines: most are Lucide's (lucide.dev, ISC and MIT licences, at the end of this file) on its
// 24 x 24 grid; the moon with its phase and craters, the battery with its level, the house and the "fine"
// tick are this page's own. The sun, house, grid and battery keep their colours.
// The sky icon: the sun by day, the moon in its phase by night, each behind a cloud when it is partly
// cloudy; a cloud alone when overcast, with slanted drops when it rains, dots when it snows.
const SUN_ICON = `<circle class="ray" cx="12" cy="12" r="4" fill="var(--sun)"/><path class="ray" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`;
const CLOUD = `<path class="cloud" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>`;
// Lucide's cloud-sun: the sun (or the moon) at 12 12, a small cloud in front of it.
const PEEK_RAYS = `<path class="ray" d="M12 2v2m-7.07.93l1.41 1.41M20 12h2m-2.93-7.07l-1.41 1.41"/>`;
const PEEK_CLOUD = `<path class="cloud" d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>`;
// The lit part is a half disc closed by the terminator, an ellipse as wide as the cosine of the phase
// angle: bulging into the lit half before the quarter, out of it after. Waning is waxing mirrored.
function moonSvg({ phase, south }, r) {
  const w = phase > 4 ? 8 - phase : phase, rx = (r * Math.abs(Math.cos((w * Math.PI) / 4))).toFixed(1);
  const lit = !w ? "" : w === 4 ? `<circle class="ink moon-lit" r="${r}"/>`
    : `<path class="ink moon-lit" d="M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx} ${r} 0 0 ${w < 2 ? 0 : 1} 0 ${-r}Z"/>`;
  // A few flat craters over both halves, fixed on the disc whatever the phase.
  const craters = [[-2.6, -2.4, 1.7], [2.4, 1.6, 1.2], [-1.2, 3.6, 1.1], [3.1, -3.3, 0.7]]
    .map(([x, y, c]) => `<circle class="crater" cx="${(x * r / 7.5).toFixed(2)}" cy="${(y * r / 7.5).toFixed(2)}" r="${(c * r / 7.5).toFixed(2)}"/>`).join("");
  return `<g transform="translate(12 12)"><g${(phase > 4) !== south ? ' transform="scale(-1 1)"' : ""}><circle class="ink moon-dark" r="${r}"/>${lit}</g>${craters}</g>`;
}
function skyIcon(night, cover, moon) {
  const name = night ? `moon ${moon.phase}` : "sun";
  if (cover === "partly") return [`${name} cloud`, `${night ? moonSvg(moon, 4.5) : `${PEEK_RAYS}<circle class="ray" cx="12" cy="12" r="4" fill="var(--sun)"/>`}${PEEK_CLOUD}`];
  if (cover === "overcast") return ["cloud", CLOUD];
  if (cover === "snow") return ["snow", `<path class="cloud rainy" d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path class="drop" d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>`];
  if (cover === "rain") return ["rain", `<path class="cloud rainy" d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path class="drop" d="M16 14l-2 6m-6-6l-2 6m6-4l-2 6"/>`];
  return [name, night ? moonSvg(moon, 7.5) : SUN_ICON];
}
// The house (centred on 0 0) and Lucide's plug, on the flow and at the ends of the prices' arrows.
const HOUSE = `<path d="M-1.24 -14.99Q0 -16 1.24 -14.99L14.76 -4.01Q16 -3 14.4 -3L12.6 -3Q11 -3 11 -1.4L11 12.4Q11 14 9.4 14L5.6 14Q4 14 4 12.4L4 5.6Q4 4 2.4 4L-2.4 4Q-4 4 -4 5.6L-4 12.4Q-4 14 -5.6 14L-9.4 14Q-11 14 -11 12.4L-11 -1.4Q-11 -3 -12.6 -3L-14.4 -3Q-16 -3 -14.76 -4.01Z"/>`;
const PLUG = `<path d="M12 22v-5m3-9V2m2 6a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1zM9 8V2"/>`;
const line = (body) => `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
const ADVICE_ICON = {
  go: line(`<path d="M3 6h3m11 0h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5a2.5 2.5 0 0 1 0-5"/>`),
  low: line(`<path d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>`),
  ok: `<path d="M5.5 12.6l4.3 4.3 8.7-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  wait: line(`<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`),
};
ADVICE_ICON.soon = ADVICE_ICON.later = ADVICE_ICON.short = ADVICE_ICON.fills = ADVICE_ICON.wait;
ADVICE_ICON.okLasts = ADVICE_ICON.ok;
const HELP_ICON = `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"/>`;
// The colour of a sun mark, for the dot in its hint.
const SUN_DOT = "var(--sun-mark,var(--sun))";
// A hint target: its sentence shows on hover, tap or focus, and is its name for screen readers.
// `role` is "img" except where the element already has one (list items).
const hint = (text, role = "img") => `data-hint="${text}" aria-label="${text}" tabindex="0"${role ? ` role="${role}"` : ""}`;
// A grey bar of about the size of an SVG text, for the skeleton (see .sk): at baseline y, starting at x
// or centred on it. x may be a percentage, so centring is a shift.
const skBar = (x, y, text, size, middle = true) => {
  const w = Math.round(String(text).length * size * 0.5), h = Math.round(size * 1.2);
  return `<rect class="sk" x="${x}" y="${Math.round(y - size)}" width="${w}" height="${h}" rx="${Math.round(h / 3)}"${middle ? ` transform="translate(${-w / 2} 0)"` : ""}/>`;
};
const big = (v) => `<span class="big">${v}<small>%</small></span>`;
// Marks on charts and rings take the theme colour made for them (darker in the light theme, so they
// reach 3:1 on the sky), else the plain one. "--sent" exists only as a mark: the grid colour, faded.
const markOf = (color) => `var(${color}-mark,var(${color}))`;
// A card's "?": opens its "How to read this" (see READ).
const helpButton = (t, card) => `<button type="button" class="help" data-card="${card}" aria-label="${t.helpTitle}" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true">${HELP_ICON}</svg></button>`;
// The small drawings in the help dialogs, 30 x 16, in the colour --c, one per kind of mark; buy and sell
// are the prices' arrows, Grid to Home (left) and Home to Grid (right).
const SW = {
  solid: `<rect x="9" y="1" width="12" height="15" rx="2" stroke="none"/>`,
  ghost: `<rect x="9.75" y="1.75" width="10.5" height="13.5" rx="2" class="faded"/>`,
  usual: `<path d="M1 8H29" fill="none" stroke-dasharray="4 3"/>`,
  pill: `<rect x="1" y="5" width="28" height="6" rx="3" class="track" stroke="none"/><rect x="1" y="5" width="17" height="6" rx="3" stroke="none"/><path d="M13 8H24" fill="none" stroke="var(--range)" stroke-width="3" stroke-linecap="round"/>`,
  mark: `<path d="M15 1V15" fill="none"/>`,
  arc: `<path d="M3 8H27" fill="none" stroke-width="8"/>`,
  line: `<path d="M1 13L9 8L17 10L29 3" fill="none" stroke-linejoin="round"/>`,
  lineAhead: `<path d="M1 13L9 8L17 10L29 3" fill="none" stroke-dasharray="4 3"/>`,
  hollow: `<circle cx="15" cy="8" r="4" class="hollow"/>`,
  buy: `<path d="M27 8H3M9 2L3 8L9 14" fill="none"/>`,
  sell: `<path d="M3 8H27M21 2L27 8L21 14" fill="none"/>`,
  dotPick: `<circle cx="15" cy="5" r="4.5" stroke="none"/><rect x="6" y="12" width="18" height="4" rx="2" class="ink" stroke="none"/>`,
};
const sw = (shape, color) => `<svg class="sw" viewBox="0 0 30 16" style="--c:${markOf(color)}" aria-hidden="true">${SW[shape]}</svg>`;
// The weather icons of the coming days (see skyIcon), on one box.
const wxIcon = (cover) => `<svg class="wx" viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cover === null ? "" : skyIcon(false, cover, null)[1]}</svg>`;
// A three-quarter ring, open at the bottom like a car gauge, from 0 at the lower left to 1 at the lower
// right: ringAt is the point at u, ringArc the arc on to u1. ring() is solid to `frac` (a fraction of the
// whole ring; NaN reads as an empty ring).
const ringAt = (u, r) => {
  const a = (135 + 270 * clamp01(u)) * Math.PI / 180;
  return `${(100 + r * Math.cos(a)).toFixed(1)} ${(103 + r * Math.sin(a)).toFixed(1)}`;
};
const ringArc = (u0, u1, r, back = false) =>
  `A${r} ${r} 0 ${Math.abs(clamp01(u1) - clamp01(u0)) > 2 / 3 ? 1 : 0} ${back ? 0 : 1} ${ringAt(u1, r)}`;
// The whole ring, as its grey track.
const TRACK = `M${ringAt(0, 80)} ${ringArc(0, 1, 80)}`;
function ring(frac, color, label, size) {
  return `<svg class="ring" viewBox="0 0 200 176" style="--c:${markOf(color)}" ${hint(label)}>
    <path class="track" d="${TRACK}"/>
    <path class="val" d="${TRACK}" pathLength="100" stroke-dasharray="${pct(clamp01(frac) || 0)} 100"/>
    ${ringSize(size)}
  </svg>`;
}
// The battery ring, in percent: solid to `soc` in `color`. With `soon` (the battery in an hour, or null)
// a faded piece of the track between the two: past the solid end in --batt when rising; when falling
// the solid end draws back to `soon` and the piece up to now is --low. `range` ([low, high], or null) is
// a thin arc outside in the faded piece's colour. `size` (text, or "") sits in the gap between the ends.
// Without `label` the ring is a picture only (the help sheet's examples).
function battRing(soc, soon, range, color, label, size) {
  const u = clamp01(soc / 100) || 0, s = soon === null ? u : clamp01(soon / 100);
  const arc = (a, b, r) => `M${ringAt(a, r)} ${ringArc(a, b, r)}`;
  const c = `style="--c:${markOf(s > u ? "--batt" : "--low")}"`;
  return `<svg class="ring" viewBox="0 0 200 176" style="--c:${markOf(color)}" ${label ? hint(label) : 'aria-hidden="true"'}>
    <path class="track" d="${TRACK}"/>
    ${s === u ? "" : `<path class="soon" ${c} d="${arc(Math.min(u, s), Math.max(u, s), 80)}"/>`}
    <path class="val" d="${TRACK}" pathLength="100" stroke-dasharray="${Math.round(Math.min(u, s) * 1000) / 10} 100"/>
    ${range && s !== u ? `<path class="range" ${c} d="${arc(clamp01(range[0] / 100), clamp01(range[1] / 100), 97)}"/>` : ""}
    ${ringSize(size)}
  </svg>`;
}
// A line at the bottom of a ring's gap: the battery's size, the energy used today.
const ringSize = (size) => (size ? `${skBar(100, 166, size, 14)}<text class="size" x="100" y="166" text-anchor="middle">${size}</text>` : "");
// The same ring split into `parts` ({ frac, color, side }, in ring order, fractions adding up to 1). Parts
// meet with a small gap; one too short for its round ends is a dot. A thin line leads from each part's
// label (beside the ring on the left or right, or above it; see .part) round the outside of the ring
// to the middle of its part, so no line crosses the ring whatever the shares.
// The top line runs further out than the side ones, so with a tiny part at an end the two never merge.
// No line runs past another label's point while the middle part is the largest (see shareRing).
const SIDES = { left: [1 / 6, "-16 103", 98], top: [0.5, "100 -8", 106], right: [5 / 6, "216 103", 98] }; // where the line meets the ring, its label, its radius
function splitRing(parts, label, size) {
  const END = 0.022, GAP = 0.012; // a round end (8 of the 377 units round the ring), the room between parts
  // Every part that is there takes at least MIN of the ring, so two tiny ones never sit on one spot; the
  // labels carry the exact values.
  const MIN = 0.05, shown = parts.filter((p) => p.frac > 0).length;
  let at = 0;
  const marks = parts.map((p) => {
    const frac = p.frac > 0 ? MIN + (1 - shown * MIN) * p.frac : 0;
    const a = at, b = (at += frac), mid = (a + b) / 2, [side, start, r] = SIDES[p.side];
    if (!(frac > 0)) return "";
    const s = a > 1e-9 ? a + END + GAP / 2 : 0, e = b < 1 - 1e-9 ? b - END - GAP / 2 : 1, c = `style="--c:${markOf(p.color)}"`;
    const [cx, cy] = ringAt(mid, 80).split(" ");
    return `<path class="lead" d="M${start} L${ringAt(side, r)} ${ringArc(side, mid, r, mid < side)} L${ringAt(mid, 90)}"/>${e > s
      ? `<path class="val" ${c} d="M${ringAt(s, 80)} ${ringArc(s, e, 80)}"/>` : `<circle class="val" ${c} cx="${cx}" cy="${cy}" r="8"/>`}`;
  }).join("");
  return `<svg class="ring" viewBox="0 0 200 176" ${hint(label)}><path class="track" d="${TRACK}"/>${marks}${ringSize(size)}</svg>`;
}
// Round steps for chart gridlines (see lineGrid).
const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const legendHtml = (list) => `<ul class="legend" style="--n:${list.length}">${list.map((l) =>
  `<li><i style="--c:${markOf(l.color)}"></i><span>${l.label}</span></li>`).join("")}</ul>`;
// A line chart's scale up to `top`, on a box 0 to 100 high stretched to its place (see .socline): its top
// at a round step, the gridlines at each step, and their values beside them (`fmt`), in HTML so they keep
// their size. Down to `bottom` below 0 when a value is (money: a day that cost more than it brought).
function lineGrid(top, fmt, bottom = 0) {
  const step = STEPS.find((s) => (top - bottom) / s <= 2) ?? STEPS.at(-1), max = Math.ceil(top / step) * step || step;
  const min = Math.floor(bottom / step) * step, span = max - min;
  const at = Array.from({ length: Math.round(span / step) }, (_, i) => min + (i + 1) * step), pos = (v) => ((v - min) / span) * 100;
  return { min, max, span, lines: at.map((v) => `<line class="grid" x1="0" x2="100" y1="${(100 - pos(v)).toFixed(2)}" y2="${(100 - pos(v)).toFixed(2)}"/>`).join(""),
    ticks: at.map((v) => `<span class="tick" style="bottom:${pos(v).toFixed(2)}%">${fmt(v)}</span>`).join("") };
}
// Figures under a chart, each a label over its value, centred: `caption` (the picked hour, day or month)
// over them, then each [label, value, colour, below 0, an estimate] (null: left out), the label with a dot
// in its colour, faded for an estimate.
function readout(caption, items) {
  const rows = items.filter(Boolean);
  return `<div class="readout">${caption ? `<div class="period">${caption}</div>` : ""}<dl data-n="${rows.length}">${rows.map(([label, value, color, neg, est]) =>
    `<div${est ? ' class="est"' : ""}${color ? ` style="--c:${markOf(color)}"` : ""}><dt>${color ? "<i></i>" : ""}<span>${label}</span></dt><dd${neg ? ' class="neg"' : ""}>${value}</dd></div>`).join("")}</dl></div>`;
}
// ‹ and › at the two ends of a picked hour's, day's or month's caption (see .stepped): a target a finger can
// hit, where the chart gives each hour or day only a thin slice. A day or an hour steps to its neighbour on the
// chart (see _wireWeek), from `at` up to `last`; a month to the month button beside it on screen, as the arrow
// keys go, and is named by it (`named`). One with nowhere to go stays, greyed.
const CHEVRON = { "-1": "m14.5 6-6 6 6 6", 1: "m9.5 6 6 6-6 6" };
const stepButton = (by, kind, label, attrs) => `<button type="button" class="step ${by < 0 ? "step-prev" : "step-next"}" data-focus-key="step:${kind}:${by}" aria-label="${label}"${attrs}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON[by]}"/></svg></button>`;
const steps = (t, kind, at, last) => [-1, 1].map((by) => stepButton(by, kind, t[`${by < 0 ? "prev" : "next"}${kind}`],
  ` data-step="${by}"${(by < 0 ? at <= 0 : at >= last) ? ' aria-disabled="true"' : ""}`)).join("");
const monthSteps = (t, cur, at, named) => {
  const keys = yearKeys(cur), i = keys.indexOf(at);
  return [-1, 1].map((by) => { const k = keys[i + by]; return stepButton(by, "Month", k ? named(k) : t[`${by < 0 ? "prev" : "next"}Month`], k ? ` data-month="${k}"` : ' aria-disabled="true"'); }).join("");
};
// A month's days (`key`, "2026-10") as a line, a dot a day over its date, every date to the month's end, the
// last on record picked at first with its figures; for this month (`live`) that is today, a hollow dot.
// Another day picked by a tap, a drag, the arrow keys or focus (see the element's _wireWeek) gets the big
// dot, its figures under the chart. `v(d)` is a day's figure (null: none on record), `name(d, v)` its hint,
// `line(d, v, lead)` its figures under `lead` ("Today so far", "On Monday, 5 October", in bold). Dates show
// every 3 days and on the picked day; a day with no numbers keeps its place, without a dot, and breaks the
// line; the days to come stay empty. `between` goes between the chart and the figures.
// `ahead` holds the days to come after the last one of `list` as [kWh, hint, sentence] (see monthAhead): a
// dashed line on from the last day's dot, a faded dot each, picked like a day on record, with the sentence
// in place of figures.
function dayLine(t, f, key, list, v, name, line, at, { live = true, between = "", ahead = [] } = {}) {
  const last = list.length - 1, n = daysIn(key), end = last + ahead.length;
  // A pick kept from a longer month (the 31st, now the 1st of the next) falls back to the last day.
  if (!(at >= 0 && at <= end)) at = last;
  const vals = Array.from({ length: n }, (_, i) => (list[i] ? v(list[i]) : ahead[i - list.length]?.[0] ?? null));
  const g = lineGrid(Math.max(...vals.map((x) => x ?? 0), 0.01), f.num, Math.min(...vals.map((x) => x ?? 0), 0)), h = (x) => ((x - g.min) / g.span) * 100;
  const pt = (x, i) => `${(((i + 0.5) / n) * 100).toFixed(2)} ${(100 - h(x)).toFixed(2)}`;
  const d = vals.map((x, i) => (x === null || i > last ? "" : `${i && vals[i - 1] !== null ? "L" : "M"}${pt(x, i)}`)).join("");
  const later = ahead.length ? vals.map((x, i) => (x === null || i < last || i > end ? "" : `${i > last && vals[i - 1] !== null ? "L" : "M"}${pt(x, i)}`)).join("") : "";
  const days = vals.map((x, i) => {
    const day = list[i], coming = ahead[i - list.length];
    const cls = [i % 3 && "quiet", coming ? "ahead" : !day ? "future" : x === null ? "none" : live && i === last && "today"].filter(Boolean).join(" ");
    return `<li ${day ? hint(name(day, x), "") : coming ? hint(coming[1], "") : ""} style="--c:${SUN_DOT}" data-i="${i}"${cls ? ` class="${cls}"` : ""}${i === at ? ' aria-current="true"' : ""}><span class="col">${x === null ? "" : `<i style="--v:${h(x).toFixed(1)}%"></i>`}</span><span class="date">${i + 1}</span></li>`;
  }).join("");
  const lines = [...list.map((day, i) => line(day, v(day), `<b>${cap(live && i === last ? t.todaySoFar : say(t.weekOn, { d: f.date(new Date(day.date)) }))}</b>`)), ...ahead.map((a) => a[2])];
  return `<div class="dayline">
        <div class="area"><svg class="socline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${g.lines}<line class="axis" x1="0" x2="100" y1="100" y2="100"/><path class="series" style="--c:${SUN_DOT}" d="${d}"/>${later ? `<path class="series later" style="--c:${SUN_DOT}" d="${later}"/>` : ""}</svg>${g.ticks}</div>
        <ol class="week" style="--n:${n}">${days}</ol>
      </div>${between}
      <div class="stepped">${steps(t, "Day", at, end)}<div class="picked" aria-live="polite" aria-atomic="true">${lines.map((l, i) => `<div class="day" data-i="${i}"${i === at ? "" : " hidden"}>${l}</div>`).join("")}</div></div>`;
}
// "Now" or "usual use" over a chart at x (0 to 100, as a number or as text), kept inside the card near its ends.
const nowLabel = (x, text) => `<span class="now-label${+x < 8 ? " start" : +x > 92 ? " end" : ""}" style="--x:${x}%">${text}</span>`;
// A sentence with its date in bold. {d} is the first placeholder of `said` in every language, so it sits where
// the date starts in `plain` (said filled in), even when cap() raised the date's first letter.
const boldDate = (plain, said, date) => { const i = said.indexOf("{d}"); return `${plain.slice(0, i)}<b>${plain.slice(i, i + date.length)}</b>${plain.slice(i + date.length)}`; };
// A month's name: this month (`cur`) as "November 2026 so far".
const monthName = (k, cur, t, f) => (k === cur ? say(t.monthSoFar, { m: f.monthYear(k) }) : f.monthYear(k));
// A month's total between its charts (see readout): `caption` over its figures.
const monthTotal = (caption, items) => `<div class="month-total">${readout(caption, items)}</div>`;
// Twelve months as buttons, oldest first (see yearKeys), each with a bar of `v(key)` (null: none on
// record, no bar) on one scale from 0 up, or with `both` up or down from a zero line by its sign (a value
// below 0 in the low colour): the line sits as high as the largest value below 0 needs, so the largest
// above and below together fill the bar. Under each its short name, the year on the last month before the
// year changes, and "so far" on this month; on a narrow card one letter and two digits ("O", "’25").
// Hovering one shows its hint `name(key, v)`; a click picks it (see _wireWeek). `ghost(key)`, when not
// null, is where a month should end: a faded bar behind its solid one, on the same scale.
function monthPicker(t, f, cur, at, v, name, color, both = false, ghost = () => null) {
  const keys = yearKeys(cur), vals = keys.map(v), ghosts = keys.map(ghost);
  const up = Math.max(0, ...vals.map((x) => x ?? 0), ...ghosts.map((x) => x ?? 0)), down = both ? Math.max(0, ...vals.map((x) => -(x ?? 0)), ...ghosts.map((x) => -(x ?? 0))) : 0;
  const top = Math.max(up + down, 1e-9), tall = (x) => ((Math.abs(x) / top) * 100).toFixed(1);
  return `<ol class="year${both ? " both" : ""}"${both ? ` style="--zero:${((down / top) * 100).toFixed(1)}%"` : ""}>${keys.map((k, i) => {
    const x = vals[i], c = markOf(x < 0 ? "--low" : color);
    return `<li><button type="button" data-month="${k}" aria-pressed="${k === at}" style="--c:${c}" ${hint(name(k, x), "")}><span class="bar">${x === null ? ""
      : `${ghosts[i] === null ? "" : `<i class="ghost${ghosts[i] < 0 ? " neg" : ""}" style="--v:${tall(ghosts[i])}%"></i>`}<i${x < 0 ? ' class="neg"' : ""} style="--v:${tall(x)}%"></i>`}</span><span><span class="wide">${f.month(k)}</span><span class="narrow">${f.monthNarrow(k)}</span></span><small>${
      k === cur ? t.soFar : i < 11 && keys[i + 1].slice(0, 4) !== k.slice(0, 4) ? `<span class="wide">${k.slice(0, 4)}</span><span class="narrow">’${k.slice(2, 4)}</span>` : ""}</small></button></li>`;
  }).join("")}</ol>`;
}

export { TRACK, nowLabel, boldDate, monthName, skyIcon, HOUSE, PLUG, line, ADVICE_ICON, HELP_ICON, SUN_DOT, hint, skBar, big, markOf, helpButton, SW, sw, wxIcon, ringAt, ringArc, ring, battRing, ringSize, splitRing, legendHtml, lineGrid, readout, steps, monthSteps, dayLine, monthTotal, monthPicker };
