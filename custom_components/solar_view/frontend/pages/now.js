/* NOW: the headline, the flow, the wear and advice cards, the battery and the coming days. nowView gives what the
   page shows as plain data (a card null when it is not drawn), with the help lines each card draws; nowPage turns it
   into HTML. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("../lib/core.js"), typeof import("../lib/draw.js"), typeof import("../lib/advice.js"), typeof import("../lib/sky.js"),
 *   typeof import("../lib/data.js"), typeof import("../lib/forecast.js")]} */
const [{ HALF_HOUR, HOUR, noonOf, hourStart, clamp01, say, cap, esc }, { skyIcon, HOUSE, PLUG, line, ADVICE_ICON, SUN_DOT, hint, big, helpButton, weatherIcon, batteryRing, nowLabel },
  { advice, outlookAdvice, advicePool, loadLines, outlookLastsH, batteryWord, isLow, gridCharging, sources, MIN_FLOW_W, EXPORT_W, IMPORT_W },
  { SKY_NIGHT_DEG, SKY_DAY_DEG, RAIN_DAY_MM, coverOf }, { fromSensor, weatherOnly, staleSince }, { SOLAR_SPREAD }] = await Promise.all([
  import(`../lib/core.js${v}`), import(`../lib/draw.js${v}`), import(`../lib/advice.js${v}`), import(`../lib/sky.js${v}`), import(`../lib/data.js${v}`), import(`../lib/forecast.js${v}`)]);

const SOON_PERCENT = 1;       // the battery in an hour shows when it moves this many points or more
const PATHS = {
  sunHouse: "M170 62V121",
  sunToBattery: "M127.6 40.2A124 104 0 0 0 47.9 119.9",
  sunGrid: "M212.4 40.2A124 104 0 0 1 292.1 119.9",
  batteryHouse: "M70 146H145",
  gridHouse: "M270 146H195",
};
// Arrowhead at the end of each path: x, y, direction in degrees. Its own element, not an SVG
// marker, so it can light up when the streak arrives.
const TIPS = {
  sunHouse: [170, 121, 90],
  sunToBattery: [47.9, 119.9, 101.9],
  sunGrid: [292.1, 119.9, 78.1],
  batteryHouse: [145, 146, 0],
  gridHouse: [195, 146, 180],
};
// A line icon on the flow, centred on x y at s times its size; its lines stay about 2.2 wide.
// Lucide's are on a 24 x 24 grid (centre 12 12); the page's own are centred on 0 0 (shift 0).
const outline = (x, y, s, className, body, shift = 12) => `<g class="outline ${className}" transform="translate(${x - shift * s} ${y - shift * s}) scale(${s})" fill="none" stroke="currentColor" stroke-width="${(2.2 / s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

function flowSvg(n, sky, night, lines, label, hints, battery, batteryColor, cover, moon) {
  const on = {
    sunHouse: Math.min(n.solarW, n.loadW) > MIN_FLOW_W,
    sunToBattery: n.batteryChargeW > MIN_FLOW_W && !gridCharging(n),
    sunGrid: n.gridExportW > EXPORT_W,
    batteryHouse: n.batteryDischargeW > MIN_FLOW_W,
    gridHouse: n.gridImportW > MIN_FLOW_W,
  };
  // A live flow: a dim arrow (line and head in one group, so they dim as one shape), a bright
  // streak running along it, and a bright copy of the head that lights as the streak lands.
  const head = (k, className) => `<path class="tip ${className}" d="M-5.5 -3.85L3.3 0L-5.5 3.85Z" transform="translate(${TIPS[k][0]} ${TIPS[k][1]}) rotate(${TIPS[k][2]})"/>`;
  const flowLines = Object.keys(PATHS).filter((k) => battery || !/Battery/i.test(k)).map((k) => on[k]
    ? `<g class="arrow"><path class="ln" d="${PATHS[k]}"/>${head(k, "")}</g><path class="streak" d="${PATHS[k]}" pathLength="100"/>${head(k, "lit")}`
    : `<path class="ln" d="${PATHS[k]}"/>`).join("");
  const node = (x, y, text, body) => `<g class="node" data-focus-key="flow:${x}:${y}" ${hint(text)}><rect class="hit" x="${x - 36}" y="${y - 26}" width="72" height="78" fill="transparent"/>${body}</g>`;
  const [icon, sun] = skyIcon(night, cover, moon);
  const batteryW = n.batteryChargeW || n.batteryDischargeW;
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
  ${flowLines}
  <g class="node" data-focus-key="flow:sun" ${hint(hints.sun)}><rect class="hit" x="142" y="8" width="96" height="98" fill="transparent"/>
  <g class="sky-icon" data-icon="${icon}" transform="translate(146 12) scale(2)" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${sun}</g>
</g>
  ${battery ? node(46, 146, hints.battery, `${outline(46, 146, 1, "battery-icon", `<rect x="-15" y="-9" width="30" height="18" rx="5"/>
    <rect class="pole" x="15" y="-3.5" width="3.8" height="7" rx="1.5" fill="currentColor" stroke="none"/>
    ${n.chargeLevel === null ? "" : `<rect class="lvl" x="-12" y="-6" width="${Math.min(24, Math.max(2, 24 * n.chargeLevel / 100)).toFixed(1)}" height="12" rx="2.5" fill="var(${batteryColor})" stroke="none"/>`}`, 0)}`) : ""}
  ${node(170, 146, hints.home, `${outline(170, 146, 1, "house", HOUSE, 0)}`)}
  ${node(294, 146, hints.grid, `${outline(294, 144, 1.5, `plug${gridOff}`, PLUG)}`)}
</svg><div class="flowtext" aria-hidden="true">${words(183, 86, n.solarW > 0 ? lines.shared.sun : lines.shared.noSun, n.solarW, false)}${battery ? words(46, 178, lines.shared.battery, batteryW) : ""}${words(170, 178, lines.shared.home, n.loadW)}${words(294, 178, lines.shared.grid, gridW)}</div></div>`;
}
// The now.advice.go lines name one appliance each, in this order in every language: its icon instead of the
// washing machine. Found by the line's text, so the owner's own lines keep the plain "go" icon.
// GO_ICON maps each line to its icon (see learnLines).
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
const GO_ICON = new Map(), LOAD_TEXT = new Set();
// From the built-in strings of every language seen so far, called when one is first on screen: the now.advice.go lines,
// each with its appliance's icon (see APPLIANCE), and the lines left out beside the washer line (see loadLines).
const learnLines = (strings) => {
  strings.now.advice.go.forEach((l, i) => GO_ICON.set(l, APPLIANCE[GO_ORDER[i]]));
  loadLines(strings).forEach((l) => LOAD_TEXT.add(l));
};

// What the Now page shows: { head, flow, wear, advice, battery, machines, learn, coming, help }, the words picked by their
// keys in the strings (the renderer says them). `sky` is the sky drawn (its daylight sizes the sun's halo), `day`
// the calendar day's number (one advice line a day), `now` the time.
/** @param {import("../lib/data.js").ViewInput} c */
function nowView({ data, sky, day, now, clock }) {
  const n = data.now, battery = data.battery, o = data.outlook;
  const charging = n.batteryChargeW > MIN_FLOW_W, discharging = n.batteryDischargeW > MIN_FLOW_W, exporting = n.gridExportW > EXPORT_W;
  // The headline names one source; with the grid as one of two, the line under it names the other.
  const names = sources(n), second = names.length > 1 && names.includes("grid") ? names[1] : null;
  const sub = second ? { sun: "alsoFromSun", battery: "alsoFromBattery", grid: "alsoFromGrid" }[second]
    // The grid already in the headline needs no line of its own.
    : n.gridImportW > IMPORT_W ? (names.includes("grid") ? "" : "alsoFromGrid")
    : exporting ? "alsoToGrid"
    : charging ? "alsoChargingBattery"
    // The battery already in the headline needs no line of its own.
    : discharging && !names.includes("battery") ? "alsoFromBattery" : "";
  const word = n.chargeLevel === null ? "" : batteryWord(n.chargeLevel, battery ? battery.floor : 0);
  const sunCharging = charging && !gridCharging(n);
  const lastsH = battery && o ? outlookLastsH(n, battery, o.lastsUntil, now) : 0;
  // Rounded to the half hour of Home Assistant's clock (a zone may be 45 minutes off UTC's): the estimate is
  // rough, and the text stays still between updates.
  const half = (timestamp) => { const h = hourStart(timestamp, clock); return h + Math.round((timestamp - h) / HALF_HOUR) * HALF_HOUR; };
  const until = lastsH && lastsH !== Infinity ? half(now + lastsH * HOUR) : null;
  const night = data.sun.elevation < SKY_NIGHT_DEG / 2 && n.solarW === 0;
  // Day starts at first light: by then the night lines (the sun has gone to bed) read wrong.
  const daytime = data.sun.elevation > (data.sun.rising ? SKY_NIGHT_DEG : 0);
  // Evening: the sun is setting and low enough for the dusk colours, or gone.
  const evening = !daytime || (!data.sun.rising && data.sun.elevation < SKY_DAY_DEG);
  // At its floor at night the battery rests as it should, with the grid carrying the house: no alarm colours.
  const rests = !daytime && word === "empty" && Math.round(n.chargeLevel) >= (battery ? battery.floor : 0);
  const batteryColor = isLow(word) && !rests ? "--low" : "--battery";
  // The washer line alone says when to run something: beside it, the card keeps to the house and the battery.
  const plain = advice(n, data.forecast, daytime, word), timing = o?.best && ["go", "soon", "later", "wait"].includes(plain);
  const kind = outlookAdvice(timing ? "ok" : plain, o, word, sunCharging, daytime, evening, lastsH);
  // The battery in an hour, from the outlook's three runs, moved by a reading under the floor (see chargeShift; added in
  // this order, as the sweep checks the 1 point edge).
  const ahead = n.chargeLevel !== null && battery?.kwh && o?.chargeInHour;
  const hour = ahead && ahead.map((x) => x + n.chargeLevel - Math.min(100, Math.max(n.chargeLevel, battery.floor)));
  const soon = hour && Math.abs(hour[1] - n.chargeLevel) >= SOON_PERCENT ? hour[1] : null;
  const coming = comingView(data, now, clock);
  return {
    head: { names, sub, stale: staleSince(data, now) },
    flow: { n, charging, discharging, today: data.today, night, glow: sky.day, battery: !!battery, batteryColor, cover: data.weather.cover, moon: data.moon },
    wear: data.wear,
    advice: { kind, word, sunCharging, daytime, rests, day, washer: !!o?.best },
    battery: n.chargeLevel === null ? null : { chargeLevel: n.chargeLevel, soon, color: batteryColor, word, kwh: battery?.kwh ?? null,
      state: charging ? (sunCharging ? "charging" : "chargingGrid") : lastsH === Infinity ? "lastsUntilSun" : lastsH ? "lastsUntil" : discharging ? "discharging" : "resting",
      until, best: o?.best ?? [] },
    machines: n.chargeLevel === null && o?.best ? o.best : null,
    // The first days: how many more until the usual day, and with it the page's own predictions.
    learn: !fromSensor(data.mode) && data.usualIn > 0 ? data.usualIn : null,
    coming,
    help: {
      battery: ["help.batterySolid", ...(o?.chargeInHour ? ["help.batteryGain", "help.batteryUse", "help.charging"] : []), "help.batteryLow"],
      days: ["help.daysBar", ...(!weatherOnly(data) && data.usualToday?.used?.[1] > 0 ? ["help.daysUse"] : []), ...(coming?.days.some((d) => d.cover !== null) ? ["help.daysSky"] : [])],
    },
  };
}

function nowPage(v, lines, format, clock, now, loading) {
  const { n, today } = v.flow, { names, sub: subKey } = v.head, source = names.map((s) => lines.now.sourceNames[s]);
  const sentence = names.length > 1 && !names.includes("grid") ? lines.now.sunAndBattery : say(lines.now.houseUsing, { source: source[0] });
  const sub = subKey ? lines.now[subKey] : "";
  // A reading too old to be live says when it was taken (see staleSince).
  const stale = v.head.stale === null ? "" : `<p class="stale">${say(lines.now.lastUpdate, { time: whenSeen(v.head.stale, format, clock, now) })}</p>`;
  const { charging, discharging } = v.flow;
  const batteryW = Math.round(n.batteryChargeW || n.batteryDischargeW);
  const hints = {
    sun: say(n.solarW > 0 ? lines.now.hintSun : lines.now.hintSunOff, { watts: Math.round(n.solarW), energy: format.kwh(today.solarKwh) }),
    home: say(lines.now.hintHome, { watts: Math.round(n.loadW), energy: format.kwh(today.loadKwh) }),
    battery: n.chargeLevel === null ? `${lines.shared.battery}: ${batteryW} W`
      : say(charging ? lines.now.hintBatteryIn : discharging ? lines.now.hintBatteryOut : lines.now.hintBatteryIdle, { percent: Math.round(n.chargeLevel), watts: batteryW }),
    grid: n.gridExportW > EXPORT_W ? say(lines.now.hintGridOut, { watts: Math.round(n.gridExportW), energy: format.kwh(today.gridExportKwh) })
      : say(n.gridImportW > MIN_FLOW_W ? lines.now.hintGridIn : lines.now.hintGridIdle, { watts: Math.round(n.gridImportW), energy: format.kwh(today.gridImportKwh) }),
  };
  const a = v.advice, adviceLines = advicePool(lines, a.kind, a.word, a.sunCharging, a.daytime, a.washer ? LOAD_TEXT : null);
  // One line per calendar day, so it stays put between redraws and changes tomorrow.
  const adviceText = adviceLines[a.day % adviceLines.length];
  // One string per card, each keyed by data-card, for writeNow.
  return [
    `<header data-card="head"><h1${loading ? ` data-wait="${lines.shared.loading}"` : ""}>${sentence}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}${stale}</header>`,
    `<div class="flowbox" data-card="flow">${flowSvg(n, { day: v.flow.glow }, v.flow.night, lines, sub ? `${sentence}. ${sub}` : sentence, hints, v.flow.battery, v.flow.batteryColor, v.flow.cover, v.flow.moon)}</div>`,
    v.wear && `<section class="card wear" data-card="wear" aria-label="${lines.now.wearTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${ADVICE_ICON.low}</svg></span>
      <p><span>${esc(say(lines.now["wear" + cap(v.wear.kind)], v.wear))}</span></p>
    </section>`,
    `<section class="card advice${a.rests ? " rest" : ""}" data-card="advice" data-kind="${a.kind}" aria-label="${lines.now.advice.title}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${(a.kind === "go" && GO_ICON.get(adviceText)) || (a.rests ? ADVICE_ICON.ok : ADVICE_ICON[a.kind])}</svg></span>
      <p><span>${esc(adviceText)}</span></p>
    </section>`,
    v.battery && batteryCard(v.battery, lines, format, clock, now),
    v.machines && `<section class="card machines" data-card="machines">${bestLine(v.machines, lines, format, clock, now)}</section>`,
    v.learn && `<section class="card learn" data-card="learn"><p>${v.learn === 1 ? lines.now.learningUsualDayOne : say(lines.now.learningUsualDay, { days: v.learn })}</p></section>`,
    v.coming && comingCard(v.coming, lines, format),
  ].filter(Boolean);
}

// Now written card by card: a card whose markup is as before stays untouched, a changed one is brought
// to its new markup in place (see morph), so the flow's streaks keep running and a hint elsewhere stays. A
// card is matched by its data-card; anything else on the page (the error message) goes.
function writeNow(page, cards) {
  const before = [...page.childNodes], kept = new Set(), template = document.createElement("template");
  const old = new Map(before.filter((element) => element.dataset?.card).map((element) => [element.dataset.card, element]));
  let prev = null;
  for (const html of cards) {
    const key = html.match(/data-card="([^"]+)"/)[1];
    let element = old.get(key);
    if (element?.sv !== html) {
      template.innerHTML = html;
      element = element ? morph(element, template.content.firstElementChild) : template.content.firstElementChild;
      element.sv = html;
    }
    if ((prev ? prev.nextElementSibling : page.firstElementChild) !== element) prev ? prev.after(element) : page.prepend(element);
    kept.add(element);
    prev = element;
  }
  before.forEach((n) => kept.has(n) || n.remove());
}

// `el` brought to `to` (the same markup with newer values): the attributes and texts that differ are set, a node of
// another kind is replaced, so the elements that stay keep their animations. Gives the node now in place.
function morph(element, to) {
  if (element.nodeName !== to.nodeName) { element.replaceWith(to); return to; }
  if (element.nodeType !== Node.ELEMENT_NODE) { if (element.data !== to.data) element.data = to.data; return element; }
  for (const { name } of [...element.attributes]) if (!to.hasAttribute(name)) element.removeAttribute(name);
  for (const { name, value } of to.attributes) if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  const a = [...element.childNodes], b = [...to.childNodes];
  b.forEach((n, i) => (a[i] ? morph(a[i], n) : element.append(n)));
  a.slice(b.length).forEach((n) => n.remove());
  return element;
}

// The battery: its ring (see batteryRing), how full in words, what it does now or how long it lasts, and when to run
// the machines (see bestLine).
function batteryCard(v, lines, format, clock, now) {
  const p = Math.round(v.chargeLevel), stored = v.kwh ? format.kwh(v.chargeLevel / 100 * v.kwh) : "";
  const until = v.until === null ? "" : format.time(new Date(v.until));
  // One o'clock takes the singular in some languages ("all'1:30", not "alle 1:30"): lastsUntilOne, where a language has it.
  const state = v.state === "lastsUntil" ? say((/^0?1\D/.test(until) && lines.now.lastsUntilOne) || lines.now.lastsUntil, { time: until }) : lines.now[v.state];
  const ringName = v.soon === null ? say(stored ? lines.now.hintCharge : lines.now.hintChargeOnly, { percent: p, stored })
    : say(lines.now.hintChargeSoon, { percent: p, soonPercent: Math.round(v.soon) });
  return `<section class="card battery" data-card="battery">
      <h2>${lines.shared.battery}</h2>
      ${helpButton(lines, "battery")}
      <div class="ring-box">
        ${batteryRing(v.chargeLevel, v.soon, v.color, ringName, v.kwh ? format.kwh(v.kwh) : "")}
        <div class="ring-mid" aria-hidden="true">${big(p)}</div>
      </div>
      <div class="battery-say"><div class="battery-word"><i style="--c:var(${v.color})"></i><span>${lines.shared[v.word]}</span></div><p>${state}</p></div>
      ${bestLine(v.best, lines, format, clock, now)}
    </section>`;
}

// When the last reading came: its time, with its date when not today.
const whenSeen = (timestamp, format, clock, now) => { const d = new Date(timestamp); return clock(timestamp).key === clock(now).key ? format.time(d) : `${format.date(d)}, ${format.time(d)}`; };

// Round numbers for what is still to come: one decimal under 10, whole above.
const near = (format, x) => format.num(x >= 10 ? Math.round(x) : x);
// The weather words of an icon (see coverOf): "" is clear.
const weatherWord = (lines, cover) => ({ "": lines.now.weatherSunny, partly: lines.now.weatherPartly, overcast: lines.now.weatherCloudy, rain: lines.now.weatherRain }[cover]);

// When to start each movable machine (see advise in forecast.js), and why: on the battery card, else (no
// charge reading) on a card of its own, named by its type's word.
const bestLine = (best, lines, format, clock, now) => best.map((b) => {
  const name = esc(lines.shared[b.type]);
  const what = b.kind === "wait" ? say(lines.now.startWait, { machine: name, power: `${format.num(Math.round(b.kw * 10) / 10)} kW` })
    : b.kind === "now" ? say(lines.now.startNow, { machine: name })
      : say(clock(b.t).key === clock(now).key ? lines.now.startAt : lines.now.startTomorrow, { machine: name, time: format.time(new Date(b.t)) });
  const why = b.why && say(lines.now[`why${cap(b.why)}`], { band: b.band?.toUpperCase() });
  const icon = b.kind === "wait" ? ADVICE_ICON.wait : APPLIANCE[b.type === "dishwasher" ? "dishes" : b.type] ?? ADVICE_ICON.go;
  return `<div class="best" data-kind="${b.kind}"><span class="tile" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><p><span>${what}</span>${why ? `<small>${why}</small>` : ""}</p></div>`;
}).join("");

// Up to 7 days from tomorrow, from the sensor, else from the Energy settings' solar forecast (as far as it reaches,
// SOLAR_SPREAD either way; alone before a usual day is on record): the day, its weather (the day's `cloud` by
// the sky's thresholds, rain from RAIN_DAY_MM; from the fresh sensor's days at every level, as the sky; none
// without them) and its likely sun [low, mid, high]; the usual day's use beside them (`use`, null with weather
// alone). null without a day.
function comingView(data, now, clock) {
  const a = data.ahead, today = clock(now).key;
  const days = (fromSensor(data.mode) ? a?.days ?? [] : data.mode?.level !== "usual_days_weather" ? [] : Object.entries(data.sunDays ?? {}).sort()
    .map(([d, x]) => ({ d, sun: [x * (1 - SOLAR_SPREAD), x, x * (1 + SOLAR_SPREAD)] })))
    .filter((d) => d.d > today && d.sun?.every(Number.isFinite)).slice(0, 7);
  if (!days.length) return null;
  const use = weatherOnly(data) ? null : data.usualToday?.used?.[1];
  const sky = (d) => (Number.isFinite(d.cloud) ? d : data.sensorSky?.[d.d] ?? {});
  return { days: days.map((d) => { const s = sky(d); return { d: d.d, sun: d.sun, cover: Number.isFinite(s.cloud) ? coverOf(s.cloud, s.rain >= RAIN_DAY_MM) : null }; }),
    use: Number.isFinite(use) && use > 0 ? use : null };
}
// A bar from 0 to the likely sun with a thin line from low to high over it, and the likely figure. One track from
// 0 to the highest high (or the usual day's use, when higher), crossed by an upright line at that use, named over
// the first row as the hour charts name now.
function comingCard(v, lines, format) {
  const line = v.use !== null, use = v.use;
  const top = Math.max(...v.days.map((d) => d.sun[2]), line ? use : 0, 0.1), at = (x) => Math.round(clamp01(x / top) * 1000) / 10;
  const u = line ? at(use) : 0;
  const mark = line ? `<span class="use" aria-hidden="true"></span>` : "";
  const label = line ? nowLabel(u, lines.now.usualUseMark) : "";
  const rows = v.days.map((d, i) => {
    const date = new Date(noonOf(d.d)), [low, middle, high] = d.sun;
    const w = d.cover === null ? "" : `${weatherWord(lines, d.cover)}, `;
    const name = say(near(format, low) === near(format, high) ? lines.now.hintDayAheadMid : lines.now.hintDayAhead, { date: format.date(date), weather: w, low: near(format, low), high: near(format, high), amount: near(format, low) });
    return `<li ${hint(name, "")} style="--c:${SUN_DOT}"><span>${format.weekday(date)}</span>${weatherIcon(d.cover)}
      <span class="track"><i style="--v:${at(middle)}%"></i><b style="--a:${at(low)}%;--b:${at(high)}%"></b>${mark}${i ? "" : label}</span><span class="num">${near(format, middle)}</span></li>`;
  }).join("");
  return `<section class="card coming" data-card="coming">
      <h2><span>${lines.now.comingDays}</span> <span class="num">kWh</span></h2>${helpButton(lines, "days")}
      <ul class="days${line ? " with-use" : ""}" style="--u:${u}%">${rows}</ul>
    </section>`;
}

export { nowView, nowPage, writeNow, learnLines, whenSeen };
