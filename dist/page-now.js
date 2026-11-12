/* NOW: the headline, the flow, the wear and advice cards, the battery and the coming days. nowView gives what the
   page shows as plain data (a card null when it is not drawn), with the help lines each card draws; nowPage turns it
   into HTML. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
const [{ HALF_HOUR, HOUR, NOON, hourStart, clamp01, say, cap, esc }, { skyIcon, HOUSE, PLUG, line, ADVICE_ICON, SUN_DOT, hint, big, helpButton, wxIcon, battRing, nowLabel },
  { advice, outlookAdvice, advicePool, outlookLastsH, batteryWord, isLow, gridCharging, sources, MIN_FLOW_W, EXPORT_W, IMPORT_W },
  { SKY_NIGHT_DEG, SKY_DAY_DEG, RAIN_DAY_MM, coverOf }, { fromSensor, weatherOnly }, { SOLAR_SPREAD }] = await Promise.all([
  import(`./core.js${v}`), import(`./draw.js${v}`), import(`./advice.js${v}`), import(`./sky.js${v}`), import(`./data.js${v}`), import(`./forecast.js${v}`)]);

const SOON_PCT = 1;       // the battery in an hour shows when it moves this many points or more, its likely range when that spans as much
const PATHS = {
  sunHouse: "M170 62V121",
  sunBatt: "M127.6 40.2A124 104 0 0 0 47.9 119.9",
  sunGrid: "M212.4 40.2A124 104 0 0 1 292.1 119.9",
  battHouse: "M70 146H145",
  gridHouse: "M270 146H195",
};
// Arrowhead at the end of each path: x, y, direction in degrees. Its own element, not an SVG
// marker, so it can light up when the streak arrives.
const TIPS = {
  sunHouse: [170, 121, 90],
  sunBatt: [47.9, 119.9, 101.9],
  sunGrid: [292.1, 119.9, 78.1],
  battHouse: [145, 146, 0],
  gridHouse: [195, 146, 180],
};
// A line icon on the flow, centred on x y at s times its size; its lines stay about 2.2 wide.
// Lucide's are on a 24 x 24 grid (centre 12 12); the page's own are centred on 0 0 (shift 0).
const outline = (x, y, s, cls, body, shift = 12) => `<g class="outline ${cls}" transform="translate(${x - shift * s} ${y - shift * s}) scale(${s})" fill="none" stroke="currentColor" stroke-width="${(2.2 / s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

function flowSvg(n, sky, night, t, label, hints, battery, battColor, cover, moon) {
  const on = {
    sunHouse: Math.min(n.solarW, n.loadW) > MIN_FLOW_W,
    sunBatt: n.batteryChargeW > MIN_FLOW_W && !gridCharging(n),
    sunGrid: n.gridExportW > EXPORT_W,
    battHouse: n.batteryDischargeW > MIN_FLOW_W,
    gridHouse: n.gridImportW > MIN_FLOW_W,
  };
  // A live flow: a dim arrow (line and head in one group, so they dim as one shape), a bright
  // streak running along it, and a bright copy of the head that lights as the streak lands.
  const head = (k, cls) => `<path class="tip ${cls}" d="M-5.5 -3.85L3.3 0L-5.5 3.85Z" transform="translate(${TIPS[k][0]} ${TIPS[k][1]}) rotate(${TIPS[k][2]})"/>`;
  const lines = Object.keys(PATHS).filter((k) => battery || !/Batt/i.test(k)).map((k) => on[k]
    ? `<g class="arrow"><path class="ln" d="${PATHS[k]}"/>${head(k, "")}</g><path class="streak" d="${PATHS[k]}" pathLength="100"/>${head(k, "lit")}`
    : `<path class="ln" d="${PATHS[k]}"/>`).join("");
  const node = (x, y, text, body) => `<g class="node" data-focus-key="flow:${x}:${y}" ${hint(text)}><rect class="hit" x="${x - 36}" y="${y - 26}" width="72" height="78" fill="transparent"/>${body}</g>`;
  const [icon, sun] = skyIcon(night, cover, moon);
  const battW = n.batteryChargeW || n.batteryDischargeW;
  const gridW = n.gridImportW || n.gridExportW;
  const gridOff = gridW > MIN_FLOW_W ? "" : " off";
  // A node's name and power in HTML over the drawing (see .flowtext): its first baseline at x, y of the
  // viewBox, centred on x or starting at it. The nodes' hints already say both, so this is for the eye only.
  const words = (x, y, name, w, middle = true) =>
    `<span class="fl${middle ? "" : " start"}" style="--x:${x};--y:${y}"><span class="tl">${name}</span><span class="tv">${Math.round(w)} W</span></span>`;
  return `<div class="flowfit"><svg class="flow" viewBox="0 0 340 198" role="group" aria-label="${label}">
  <defs>
    <radialGradient id="halo"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.6"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient>
  </defs>
  ${night || ["overcast", "rain", "snow"].includes(cover) ? "" : `<circle class="halo" cx="170" cy="36" r="${Math.round(54 + 24 * sky.day)}" fill="url(#halo)"/>`}
  ${lines}
  <g class="node" data-focus-key="flow:sun" ${hint(hints.sun)}><rect class="hit" x="142" y="8" width="96" height="98" fill="transparent"/>
  <g class="sky-icon" data-icon="${icon}" transform="translate(146 12) scale(2)" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${sun}</g>
</g>
  ${battery ? node(46, 146, hints.battery, `${outline(46, 146, 1, "batt", `<rect x="-15" y="-9" width="30" height="18" rx="5"/>
    <rect class="pole" x="15" y="-3.5" width="3.8" height="7" rx="1.5" fill="currentColor" stroke="none"/>
    ${n.soc === null ? "" : `<rect class="lvl" x="-12" y="-6" width="${Math.min(24, Math.max(2, 24 * n.soc / 100)).toFixed(1)}" height="12" rx="2.5" fill="var(${battColor})" stroke="none"/>`}`, 0)}`) : ""}
  ${node(170, 146, hints.home, `${outline(170, 146, 1, "house", HOUSE, 0)}`)}
  ${node(294, 146, hints.grid, `${outline(294, 144, 1.5, `plug${gridOff}`, PLUG)}`)}
</svg><div class="flowtext" aria-hidden="true">${words(183, 86, n.solarW > 0 ? t.sun : t.noSun, n.solarW, false)}${battery ? words(46, 178, t.battery, battW) : ""}${words(170, 178, t.home, n.loadW)}${words(294, 178, t.grid, gridW)}</div></div>`;
}
// The adviceGo lines name one appliance each, in this order in every language: its icon instead of the
// washing machine. Found by the line's text, so the owner's own lines keep the plain "go" icon.
// GO_ICON maps each line to its icon (see learnGoIcons).
const APPLIANCE = {
  washer: ADVICE_ICON.go,
  oven: line(`<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3m5-3v3m5-3v3M7 4h.01M12 4h.01M17 4h.01"/>`),
  dishes: line(`<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20m14-7V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>`),
  iron: line(`<path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23"/>`),
  vacuum: line(`<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>`),
  phone: line(`<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12.67 8L10 12h4l-2.67 4"/>`),
  dryer: line(`<path d="M12.8 19.6A2 2 0 1 0 14 16H2m15.5-8a2.5 2.5 0 1 1 2 4H2m7.8-7.6A2 2 0 1 1 11 8H2"/>`),
  plug: line(`<path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6l-2.3 2.3a2.4 2.4 0 0 0 0 3.4zM2 22l3-3m2.5-5.5L10 11m.5 5.5L13 14m5-11l-4 4h6l-4 4"/>`),
};
const GO_ORDER = ["washer", "oven", "dishes", "iron", "vacuum", "phone", "dryer", "plug", "washer", "oven", "dishes", "iron", "vacuum", "phone", "dryer", "washer"];
const GO_ICON = new Map();
// The adviceGo lines of every language seen so far, each with its appliance's icon (see APPLIANCE): called with a
// language's built-in lines when it is first on screen.
const learnGoIcons = (lines) => lines.forEach((l, i) => GO_ICON.set(l, APPLIANCE[GO_ORDER[i]]));

// What the Now page shows: { head, flow, wear, advice, battery, machines, coming, help }, the words picked by their
// keys in the strings (the renderer says them). `sky` is the sky drawn (its daylight sizes the sun's halo), `day`
// the calendar day's number (one advice line a day), `now` the time.
function nowView({ data, sky, day, now, clock }) {
  const n = data.now, batt = data.batt, o = data.outlook;
  const charging = n.batteryChargeW > MIN_FLOW_W, discharging = n.batteryDischargeW > MIN_FLOW_W, exporting = n.gridExportW > EXPORT_W;
  // The headline names one source; with the grid as one of two, the line under it names the other.
  const names = sources(n), second = names.length > 1 && names.includes("grid") ? names[1] : null;
  const sub = second ? { sun: "subSun", battery: "subBattery", grid: "subGrid" }[second]
    // The grid already in the headline needs no line of its own.
    : n.gridImportW > IMPORT_W ? (names.includes("grid") ? "" : "subGrid")
    : exporting ? "subExport"
    : charging ? "subCharge"
    // The battery already in the headline needs no line of its own.
    : discharging && !names.includes("battery") ? "subBattery" : "";
  const word = n.soc === null ? "" : batteryWord(n.soc, batt ? batt.floor : 0);
  const sunCharging = charging && !gridCharging(n);
  const lastsH = batt && o ? outlookLastsH(n, batt, o.lastsUntil, now) : 0;
  // Rounded to the half hour of Home Assistant's clock (a zone may be 45 minutes off UTC's): the estimate is
  // rough, and the text stays still between updates.
  const half = (ms) => { const h = hourStart(ms, clock); return h + Math.round((ms - h) / HALF_HOUR) * HALF_HOUR; };
  const until = lastsH && lastsH !== Infinity ? half(now + lastsH * HOUR) : null;
  const night = data.sun.elevation < SKY_NIGHT_DEG / 2 && n.solarW === 0;
  // Day starts at first light: by then the night lines (the sun has gone to bed) read wrong.
  const daytime = data.sun.elevation > (data.sun.rising ? SKY_NIGHT_DEG : 0);
  // Evening: the sun is setting and low enough for the dusk colours, or gone.
  const evening = !daytime || (!data.sun.rising && data.sun.elevation < SKY_DAY_DEG);
  // At its floor at night the battery rests as it should, with the grid carrying the house: no alarm colours.
  const rests = !daytime && word === "empty" && Math.round(n.soc) >= (batt ? batt.floor : 0);
  const battColor = isLow(word) && !rests ? "--low" : "--batt";
  // The washer line alone says when to run something: beside it, the card keeps to the house and the battery.
  const plain = advice(n, data.forecast, daytime, word), timing = o?.best && ["go", "soon", "later", "wait"].includes(plain);
  const kind = outlookAdvice(timing ? "ok" : plain, o, word, sunCharging, daytime, evening, lastsH);
  // The battery in an hour, from the outlook's three runs, moved by a reading under the floor (see socShift; added in
  // this order, as the sweep checks the 1 point edge). Its likely range only from the sensor's forecast.
  const sensor = !!data.ahead && fromSensor(data.mode), ahead = n.soc !== null && batt?.kwh && o?.inHour;
  const hour = ahead && ahead.map((x) => x + n.soc - Math.min(100, Math.max(n.soc, batt.floor)));
  const soon = hour && Math.abs(hour[1] - n.soc) >= SOON_PCT ? hour[1] : null;
  const range = soon !== null && fromSensor(data.mode) && hour[2] - hour[0] >= SOON_PCT ? [hour[0], hour[2]] : null;
  return {
    head: { names, sub },
    flow: { n, today: data.today, night, glow: sky.day, battery: !!batt, battColor, cover: data.weather.cover, moon: data.moon },
    wear: data.wear,
    advice: { kind, word, sunCharging, daytime, rests, day },
    battery: n.soc === null ? null : { soc: n.soc, soon, range, color: battColor, word, kwh: batt?.kwh ?? null,
      state: charging ? (sunCharging ? "charging" : "chargingGrid") : lastsH === Infinity ? "untilSun" : lastsH ? "until" : discharging ? "discharging" : "resting",
      until, best: o?.best ?? [] },
    machines: n.soc === null && o?.best ? o.best : null,
    coming: comingView(data, now, clock),
    help: {
      battery: ["helpSolid", ...(o?.inHour ? ["helpGain", "helpUse", ...(sensor ? ["helpRange"] : []), "helpRise"] : []), "helpLow"],
      days: ["helpDaysPill", ...(!weatherOnly(data) && data.usualToday?.used?.[1] > 0 ? ["helpDaysUse"] : []), ...(data.ahead?.days?.some((d) => Number.isFinite(d.cloud)) ? ["helpDaysSky"] : [])],
    },
  };
}

function nowPage(v, t, f, clock, now, loading) {
  const { n, today } = v.flow, { names, sub: subKey } = v.head, src = names.map((s) => t.src[s]);
  const sentence = names.length > 1 && !names.includes("grid") ? t.sunBatt : say(t.runOn, { a: src[0] });
  const sub = subKey ? t[subKey] : "";
  const charging = n.batteryChargeW > MIN_FLOW_W, discharging = n.batteryDischargeW > MIN_FLOW_W;
  const battW = Math.round(n.batteryChargeW || n.batteryDischargeW);
  const hints = {
    sun: say(n.solarW > 0 ? t.hSun : t.hSunOff, { w: Math.round(n.solarW), k: f.kwh(today.solarKwh) }),
    home: say(t.hHome, { w: Math.round(n.loadW), k: f.kwh(today.loadKwh) }),
    battery: n.soc === null ? `${t.battery}: ${battW} W`
      : say(charging ? t.hBattIn : discharging ? t.hBattOut : t.hBattIdle, { p: Math.round(n.soc), w: battW }),
    grid: n.gridExportW > EXPORT_W ? say(t.hGridOut, { w: Math.round(n.gridExportW), k: f.kwh(today.gridExportKwh) })
      : say(n.gridImportW > MIN_FLOW_W ? t.hGridIn : t.hGridIdle, { w: Math.round(n.gridImportW), k: f.kwh(today.gridImportKwh) }),
  };
  const a = v.advice, lines = advicePool(t, a.kind, a.word, a.sunCharging, a.daytime);
  // One line per calendar day, so it stays put between redraws and changes tomorrow.
  const adviceText = lines[a.day % lines.length];
  return `
    <header><h1${loading ? ` data-wait="${t.loading}"` : ""}>${sentence}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</header>
    <div class="flowbox">${flowSvg(n, { day: v.flow.glow }, v.flow.night, t, sub ? `${sentence}. ${sub}` : sentence, hints, v.flow.battery, v.flow.battColor, v.flow.cover, v.flow.moon)}</div>
    ${v.wear ? `<section class="card wear" aria-label="${t.wearTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${ADVICE_ICON.low}</svg></span>
      <p>${esc(say(t["wear" + v.wear.kind[0].toUpperCase() + v.wear.kind.slice(1)], v.wear))}</p>
    </section>` : ""}
    <section class="card advice${a.rests ? " rest" : ""}" data-kind="${a.kind}" aria-label="${t.adviceTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${(a.kind === "go" && GO_ICON.get(adviceText)) || (a.rests ? ADVICE_ICON.ok : ADVICE_ICON[a.kind])}</svg></span>
      <p>${esc(adviceText)}</p>
    </section>
    ${v.battery ? batteryCard(v.battery, t, f, clock, now) : ""}${v.machines ? `<section class="card machines">${bestLine(v.machines, t, f, clock, now)}</section>` : ""}${v.coming ? comingCard(v.coming, t, f) : ""}`;
}

// The battery: its ring (see battRing), how full in words, what it does now or how long it lasts, and when to run
// the machines (see bestLine).
function batteryCard(v, t, f, clock, now) {
  const p = Math.round(v.soc), stored = v.kwh ? f.kwh(v.soc / 100 * v.kwh) : "";
  const until = v.until === null ? "" : f.time(new Date(v.until));
  // One o'clock takes the singular in some languages ("all'1:30", not "alle 1:30"): untilOne, where a language has it.
  const state = v.state === "until" ? say((/^0?1\D/.test(until) && t.untilOne) || t.until, { t: until }) : t[v.state];
  const ringName = v.soon === null ? say(stored ? t.hRing : t.hRingNoSize, { p, k: stored })
    : say(v.range ? t.hRingSoon : t.hRingSoonMid, { p, a: Math.round(v.soon), b: Math.round(v.range?.[0]), c: Math.round(v.range?.[1]) });
  return `<section class="card battery">
      <h2>${t.battery}</h2>
      ${helpButton(t, "battery")}
      <div class="ring-box">
        ${battRing(v.soc, v.soon, v.range, v.color, ringName, v.kwh ? f.kwh(v.kwh) : "")}
        <div class="ring-mid" aria-hidden="true">${big(p)}</div>
      </div>
      <div class="batt-say"><div class="batt-word"><i style="--c:var(${v.color})"></i><span>${t[v.word]}</span></div><p>${state}</p></div>
      ${bestLine(v.best, t, f, clock, now)}
    </section>`;
}

// Round numbers for what is still to come: one decimal under 10, whole above.
const near = (f, x) => f.num(x >= 10 ? Math.round(x) : x);
// The weather words of an icon (see coverOf): "" is clear.
const wxWord = (t, cover) => ({ "": t.wxSunny, partly: t.wxPartly, overcast: t.wxCloudy, rain: t.wxRain }[cover]);

// When to start each movable machine (see advise in forecast.js), and why: on the battery card, else (no
// charge reading) on a card of its own, named by its type's word.
const bestLine = (best, t, f, clock, now) => best.map((b) => {
  const name = esc(t[b.type]);
  const what = b.kind === "wait" ? say(t.adviseWait, { n: name, a: `${f.num(Math.round(b.kw * 10) / 10)} kW` })
    : b.kind === "now" ? say(t.adviseNow, { n: name })
      : say(clock(b.t).key === clock(now).key ? t.adviseAt : t.adviseTomorrow, { n: name, a: f.time(new Date(b.t)) });
  const why = b.why && say(t[`why${cap(b.why)}`], { a: b.band?.toUpperCase() });
  const icon = b.kind === "wait" ? ADVICE_ICON.wait : APPLIANCE[b.type === "dishwasher" ? "dishes" : b.type] ?? ADVICE_ICON.go;
  return `<div class="best" data-kind="${b.kind}"><span class="tile" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><p>${what}${why ? `<small>${why}</small>` : ""}</p></div>`;
}).join("");

// Up to 7 days from tomorrow, from the sensor, else from the Energy settings' solar forecast beside the
// page's own forecast (as far as it reaches, SOLAR_SPREAD either way, no weather): the day, its weather (the
// day's `cloud` by the sky's thresholds, rain from RAIN_DAY_MM; none when the sensor gives no cloud) and its
// likely sun [low, mid, high]; the usual day's use beside them (`use`, null with weather alone). null without a day.
function comingView(data, now, clock) {
  const a = data.ahead, today = clock(now).key;
  const days = (!a ? [] : fromSensor(data.mode) ? a.days : Object.entries(data.sunDays ?? {}).sort()
    .map(([d, x]) => ({ d, sun: [x * (1 - SOLAR_SPREAD), x, x * (1 + SOLAR_SPREAD)] })))
    .filter((d) => d.d > today && d.sun?.every(Number.isFinite)).slice(0, 7);
  if (!days.length) return null;
  const use = weatherOnly(data) ? null : data.usualToday?.used?.[1];
  return { days: days.map((d) => ({ d: d.d, sun: d.sun, cover: Number.isFinite(d.cloud) ? coverOf(d.cloud, d.rain >= RAIN_DAY_MM) : null })),
    use: Number.isFinite(use) && use > 0 ? use : null };
}
// A bar from 0 to the likely sun with a thin line from low to high over it, and the likely figure. One track from
// 0 to the highest high (or the usual day's use, when higher), crossed by an upright line at that use, named over
// the first row as the hour charts name now.
function comingCard(v, t, f) {
  const line = v.use !== null, use = v.use;
  const top = Math.max(...v.days.map((d) => d.sun[2]), line ? use : 0, 0.1), at = (x) => Math.round(clamp01(x / top) * 1000) / 10;
  const u = line ? at(use) : 0;
  const mark = line ? `<span class="use" aria-hidden="true"></span>` : "";
  const label = line ? nowLabel(u, t.usualUseMark) : "";
  const rows = v.days.map((d, i) => {
    const date = new Date(Date.parse(d.d) + NOON), [lo, mid, hi] = d.sun;
    const w = d.cover === null ? "" : `${wxWord(t, d.cover)}, `;
    const name = say(near(f, lo) === near(f, hi) ? t.hDayAheadMid : t.hDayAhead, { d: f.date(date), w, a: near(f, lo), b: near(f, hi) });
    return `<li ${hint(name, "")} style="--c:${SUN_DOT}"><span>${f.weekday(date)}</span>${wxIcon(d.cover)}
      <span class="track"><i style="--v:${at(mid)}%"></i><b style="--a:${at(lo)}%;--b:${at(hi)}%"></b>${mark}${i ? "" : label}</span><span class="num">${near(f, mid)}</span></li>`;
  }).join("");
  return `<section class="card coming">
      <h2><span>${t.comingDays}</span> <span class="num">kWh</span></h2>${helpButton(t, "days")}
      <ul class="days${line ? " with-use" : ""}" style="--u:${u}%">${rows}</ul>
    </section>`;
}

export { nowView, nowPage, learnGoIcons };
