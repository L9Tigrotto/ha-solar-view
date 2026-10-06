/* Solar page in plain words: a Home Assistant custom panel (panel_custom in configuration.yaml).
   Home Assistant sets `hass` on the element, so login, live states and language come for free.
   Served WITHOUT login, under /hacsfiles/ (HACS) or /local/ (copied by hand): never put a secret here.
   /local/ is cached hard: there, bump ?v= in configuration.yaml after every edit of any of the three
   files. /hacsfiles/ tells the browser not to cache.

   Files: this one (rules, logic, drawing, the element), strings.js (every text), styles.js (the CSS).
   Sections here: entities, rules, sky, parts, logic, data, drawing, pages, element. */

// ---- Entities ----
// Which sensors to read comes from Home Assistant's own Energy settings, so any brand set up
// there works. Each list can be replaced in the panel's `config:` (see entitiesFrom):
//   entities: { solar_power: sensor.x, battery_soc: [sensor.a, sensor.b], ... }
const SUN = "sun.sun";
// config name: [name in here, source type and key in the Energy settings]. Power in W or kW,
// energy in any unit the statistics know. Battery power is positive when discharging, grid
// power when importing.
const ENTITIES = {
  solar_power: ["solarW", "solar", "stat_rate"],
  battery_power: ["battW", "battery", "stat_rate"],
  grid_power: ["gridW", "grid", "stat_rate"],
  battery_soc: ["soc", "battery", "stat_soc"],
  solar_energy: ["solarKwh", "solar", "stat_energy_from"],
  battery_out_energy: ["batteryKwh", "battery", "stat_energy_from"],
  battery_in_energy: ["chargeKwh", "battery", "stat_energy_to"],
  grid_in_energy: ["gridImportKwh", "grid", "stat_energy_from"],
  grid_out_energy: ["gridExportKwh", "grid", "stat_energy_to"],
  // Not in the Energy settings. Without them house use is what flows in minus what flows out,
  // which counts the inverter's own losses as house use.
  load_power: ["loadW"],
  load_energy: ["loadKwh"],
};
const ENERGY = ["solarKwh", "batteryKwh", "chargeKwh", "gridImportKwh", "gridExportKwh", "loadKwh"];
const WATTS = { W: 1, kW: 1e3, MW: 1e6 };

// ---- Rules (tune here) ----
const POOR_SHARE = 0.55;      // a forecast for today under this share of a usual day is a poor day
const BETTER_TIMES = 1.5;     // tomorrow must beat today by this factor before saying "wait for tomorrow"
const BATTERY_FLOOR_SOC = 10; // percent where the inverter stops discharging, unless config says battery_floor
const LASTS_MIN_H = 0.5;      // "enough until" is only shown between these many hours
const LASTS_MAX_H = 18;
const USUAL_DAYS = 14;    // "enough until" follows the house's usual use per hour over these many days, unless config says usual_days
const USUAL_MIN = 3;      // until every hour of the day has this many days behind it, the present draw is used
const SURPLUS_W = 1000;   // solar minus house use above this: good moment for big appliances
const FADE_MIN_W = 500;   // the sun forecast for this hour must reach this before a drop in the next 3 hours is worth a warning
const FADE_SHARE = 0.4;   // the next 3 hours average under this share of this hour: the sun is fading soon
const LATER_MIN_W = 500;  // the next 3 hours must average this much forecast sun before "more sun is coming" is said
const LATER_TIMES = 2;    // and at least this many times this hour's forecast
const EXPORT_W = 50;      // exporting more than this also means spare energy
const IMPORT_W = 50;      // importing more than this counts as "the grid is helping"
// Battery words by whole percent: 0 empty, 1 to 15 low, 16 to 84 good, 85 to 99 almost full, 100 full.
const LOW_SOC = 16;       // under this is "low", and the low battery warning can fire
const HIGH_SOC = 85;      // from here up it is "almost full"
const MIN_USE_KWH = 0.05; // under this the house has used nothing yet today, so there is no share to show
const LOW_SOLAR_W = 100;  // "no real sun" for the low battery warning
const MIN_FLOW_W = 20;    // below this a flow is treated as off
const SOLAR_NOISE_W = 15; // an inverter can report a few watts all night (7 to 8 W measured)
const SENT_KWH = 0.05;    // "sent to the grid" rows stay hidden below this
const SAME_PCT = 5;       // month comparison: within this many percent is "about the same"
const REFRESH_MS = 5 * 60 * 1000; // totals come from the statistics, which move every 5 minutes

// ---- Sky: colours follow the sun's height (sun.sun elevation, degrees) ----
const SKY_NIGHT_DEG = -6; // at or below: full night
const SKY_LOW_DEG = 1;    // around here: full dawn or dusk colours
const SKY_DAY_DEG = 14;   // at or above: full day
// [top, middle, bottom, sun glow]
const SKY = {
  dark: {
    night: ["#0b1433", "#080e24", "#04060f", "#ff9d5c"],
    dawn: ["#1c2b60", "#573a70", "#8a4f6e", "#ffc2a0"],
    dusk: ["#2a2350", "#6a3052", "#8c3f2a", "#ff9d5c"],
    day: ["#1e5fae", "#17488a", "#0d2b57", "#ffd66b"],
  },
  light: {
    night: ["#a9b5e3", "#cdd5f0", "#eceffa", "#fff1c9"],
    dawn: ["#b9cdf2", "#f3cfe0", "#ffe9d6", "#fff3da"],
    dusk: ["#c6c3ee", "#ffd5c0", "#ffe6b8", "#fff1c9"],
    day: ["#7fc1f5", "#bfe0fa", "#eef7fe", "#fffbe0"],
  },
};

// ---- Parts: texts and stylesheet live in their own files ----
// They must load with this file's own ?v=, or under /local/ the browser keeps stale copies.
const version = new URL(import.meta.url).search;
const [{ STRINGS }, { CSS }] = await Promise.all([import(`./strings.js${version}`), import(`./styles.js${version}`)]);

// ---- Logic (pure) ----
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pct = (v) => Math.round(v * 100);
// say("{a} and {b}", { a, b }): placeholders are one letter.
const say = (text, parts) => text.replace(/\{(\w)\}/g, (_, k) => parts[k]);
// Days are counted in Home Assistant's time zone, not the browser's. clockOf(tz)(ms) gives the
// calendar day there as "2026-10-02", plus hour and minute.
function clockOf(tz) {
  const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let f;
  try { f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }); } catch (e) { f = new Intl.DateTimeFormat("en-CA", opts); }
  return (ms) => {
    const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
    return { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
  };
}
// A day key moved by whole days. Plain calendar arithmetic, so daylight saving cannot bend it.
const shiftKey = (key, days) => new Date(Date.parse(key) + days * 864e5).toISOString().slice(0, 10);
// A state as a number, null when the entity is missing or has no value.
const stateNum = (hass, id) => { const v = parseFloat(hass.states[id]?.state); return Number.isFinite(v) ? v : null; };

// "wait": today's forecast is poor against a usual day here (the average of the last 7 days),
// and tomorrow's is clearly better.
// "soon": spare sun now, but the forecast says it fades within 3 hours (a cycle would run into it).
// "later": no spare sun now, but the next 3 hours are forecast to be clearly sunnier.
function advice(n, forecast, daytime) {
  if (n.solarW - n.loadW > SURPLUS_W || n.gridExportW > EXPORT_W)
    return forecast && forecast.fade.now >= FADE_MIN_W && forecast.fade.next < forecast.fade.now * FADE_SHARE ? "soon" : "go";
  if (n.soc !== null && n.soc < LOW_SOC && n.solarW < LOW_SOLAR_W) return "low";
  if (daytime && forecast && forecast.today < forecast.usual * POOR_SHARE && forecast.tomorrow >= forecast.today * BETTER_TIMES) return "wait";
  if (daytime && forecast && forecast.fade.next >= LATER_MIN_W && forecast.fade.next >= forecast.fade.now * LATER_TIMES) return "later";
  return "ok";
}

// The lines that fit the situation: the advice kind, narrowed by the battery word where a more
// specific line is true. Specific lines come first, then the general ones, for more variety.
function advicePool(t, kind, word, charging, daytime) {
  const high = word === "full" || word === "nearlyFull";
  const general = daytime ? t.adviceOk : t.adviceOkNight;
  if (kind === "go") return high ? [...t.adviceGoFull, ...t.adviceGo] : t.adviceGo;
  if (kind === "low") return word === "empty" ? t.adviceEmpty : t.adviceLow;
  if (kind === "wait") return t.adviceWait;
  if (kind === "soon") return t.adviceSoon;
  if (kind === "later") return t.adviceLater;
  if (charging && (word === "low" || word === "empty")) return t.adviceOkRefill;
  return high ? [...t.adviceOkFull, ...general] : general;
}

// The strings of one language with the owner's own advice lines merged in. They come from the
// panel's `config:` in configuration.yaml (see the example there), so nobody edits this file:
//   advice: { it: { ok: ["..."], go: ["..."] }, en: { ... } }   added to the built-in lines
//   advice_replace: true                                        a pool with own lines uses only those
// Pool names: go, goFull, soon, later, low, empty, wait, ok, okNight, okFull, okRefill.
function withOwnAdvice(strings, config, lang) {
  const own = config?.advice?.[lang];
  if (!own) return strings;
  const t = { ...strings };
  for (const [name, lines] of Object.entries(own)) {
    const key = "advice" + name[0].toUpperCase() + name.slice(1);
    // An empty YAML entry arrives as null.
    const clean = [].concat(lines).filter((s) => s != null).map(String).filter((s) => s.trim());
    if (Array.isArray(strings[key]) && clean.length) t[key] = config.advice_replace ? clean : [...strings[key], ...clean];
  }
  return t;
}
// Text typed by the owner goes into the page as text, never as markup.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Hours the battery can carry the house. 0 when it is not carrying it or the answer is not worth
// showing, Infinity when the sun takes over before it runs out.
// With `plan` (the usual day, see totals) it walks forward hour by hour: each hour the house takes
// what it usually takes then, and the sun gives what is forecast. The rest of the present hour
// counts too, at whichever is worse for the battery: the present draw or the usual one. `at` is
// the present hour and minute in Home Assistant's time zone.
// Without a plan (the first days after install) the present draw is all there is.
function batteryLastsH(n, sun, batt, plan, at) {
  if (n.soc === null || !batt.kwh || n.batteryDischargeW <= MIN_FLOW_W || n.solarW >= n.loadW) return 0;
  let wh = Math.max(0, n.soc - batt.floor) / 100 * batt.kwh * 1000;
  const shown = (h) => (h >= LASTS_MIN_H && h <= LASTS_MAX_H ? h : 0);
  if (!plan) {
    // Morning, from first light: the sun is about to take over, so an end time would be wrong.
    if (sun.rising && sun.elevation > SKY_NIGHT_DEG) return 0;
    // What the sun still covers falls to the battery once it sets.
    return shown(wh / (n.batteryDischargeW + n.solarW));
  }
  let h = 0;
  for (let i = 0; h < LASTS_MAX_H; i++) {
    const hour = (at.hour + i) % 24, span = i ? 1 : (60 - at.minute) / 60;
    const drain = i ? plan.loadW[hour] - plan.solarW[hour]
      : Math.max(n.loadW, plan.loadW[hour]) - Math.min(n.solarW, plan.solarW[hour]);
    if (drain <= 0) return Infinity;
    if (wh <= drain * span) return shown(h + wh / drain);
    wh -= drain * span;
    h += span;
  }
  return 0;
}

function batteryWord(soc) {
  const p = Math.round(soc);
  return p <= 0 ? "empty" : p < LOW_SOC ? "low" : p < HIGH_SOC ? "good" : p < 100 ? "nearlyFull" : "full";
}

// Up to two sources that really carry the house right now, biggest first.
function sources(n) {
  const all = [["sun", Math.min(n.solarW, n.loadW)], ["battery", n.batteryDischargeW], ["grid", n.gridImportW]]
    .sort((a, b) => b[1] - a[1]);
  const floor = Math.max(MIN_FLOW_W, n.loadW * 0.25);
  const big = all.filter((s) => s[1] >= floor).slice(0, 2);
  return (big.length ? big : all.slice(0, 1)).map((s) => s[0]);
}

// Share of the house use that did not come from the grid. null while nothing has been used
// (just after midnight): neither 0 % nor 100 % would be true.
function ownShare(d) { return d.loadKwh >= MIN_USE_KWH ? clamp01(1 - d.gridImportKwh / d.loadKwh) : null; }
// Money not spent on the grid. null without a price.
const savedMoney = (d, price) => (price.buy === null ? null : Math.max(0, d.loadKwh - d.gridImportKwh) * price.buy);

// Sun per day, this month against last. `days` counts the days that have numbers, so a month
// only partly recorded still compares fairly. No verdict during the first day.
function monthVerdict(data) {
  const m = data.month, lm = data.lastMonth;
  if (m.days < 1 || !(lm.solarKwh > 0)) return "";
  const pct = (m.solarKwh / m.days / (lm.solarKwh / lm.days) - 1) * 100;
  return pct > SAME_PCT ? "more" : pct < -SAME_PCT ? "less" : "same";
}

const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, f) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * f).toString(16).padStart(2, "0")).join("");

// Night blends into dawn or dusk, which blends into day, by sun elevation.
function skyAt(elevation, rising, dark) {
  const p = SKY[dark ? "dark" : "light"];
  const low = rising ? p.dawn : p.dusk;
  const up = smooth((elevation - SKY_NIGHT_DEG) / (SKY_LOW_DEG - SKY_NIGHT_DEG));
  const day = smooth((elevation - SKY_LOW_DEG) / (SKY_DAY_DEG - SKY_LOW_DEG));
  return { colors: p.night.map((c, i) => mix(mix(c, low[i], up), p.day[i], day)), up, day };
}

// ---- Data ----
const isAdmin = (hass) => !!hass.user?.is_admin;

// The entity ids to read, as lists (several solar arrays or batteries are summed): from the
// Energy settings (`prefs`, the answer of energy/get_prefs, or null), then the owner's `config:`.
function entitiesFrom(prefs, config = {}) {
  const sources = (prefs && prefs.energy_sources) || [];
  // Older Home Assistant keeps a grid as lists of flows, newer as one import and export pair.
  // An old export flow names its price like an import one, so it is renamed here.
  const flat = sources.flatMap((s) => [s, ...["flow_from", "flow_to", "power"].flatMap((k) => (s[k] || []).map((x) => (k === "flow_to"
    ? { type: s.type, stat_energy_to: x.stat_energy_to, entity_energy_price_export: x.entity_energy_price, number_energy_price_export: x.number_energy_price }
    : { ...x, type: s.type })))]);
  const own = config.entities || {};
  const src = {};
  for (const [name, [key, type, field]] of Object.entries(ENTITIES))
    src[key] = own[name] ? [].concat(own[name]) : flat.filter((s) => s.type === type && s[field]).map((s) => s[field]);
  const batteries = sources.filter((s) => s.type === "battery");
  const sized = batteries.length > 0 && batteries.every((b) => b.capacity > 0);
  const price = (mine, entity, number) => mine ?? flat.map((s) => s[entity] ?? s[number]).find((v) => v != null) ?? null;
  return {
    ...src,
    // State of charge of several batteries: weighted by size when every size is known.
    socWeight: Object.fromEntries(batteries.map((b) => [b.stat_soc, sized ? b.capacity : 1])),
    batt: {
      kwh: config.battery_kwh ?? (sized ? batteries.reduce((sum, b) => sum + b.capacity, 0) : null),
      floor: config.battery_floor ?? BATTERY_FLOOR_SOC,
    },
    // Fewer than USUAL_MIN days could never make a usual day.
    usualDays: Math.max(USUAL_MIN, Math.round(Number(config.usual_days)) || USUAL_DAYS),
    // A number, or the id of an entity holding one.
    price: { buy: price(config.price_buy, "entity_energy_price", "number_energy_price"),
      sell: price(config.price_sell, "entity_energy_price_export", "number_energy_price_export") },
  };
}
// The live sensors the Now page cannot do without.
const coreIds = (src) => [...src.solarW, ...src.battW, ...src.gridW, ...src.soc, ...src.loadW];

// Energy per calendar day from statistics rows: Map of day key to { solarKwh, ... }.
function byDay(res, src, clock) {
  const days = new Map();
  for (const part of ENERGY) for (const id of src[part]) for (const r of res[id] || []) {
    const key = clock(r.start).key;
    if (!days.has(key)) days.set(key, Object.fromEntries(ENERGY.map((k) => [k, 0])));
    days.get(key)[part] += Math.max(0, r.change || 0);
  }
  return days;
}

// House use: its own sensor when the owner named one, else what flowed in minus what flowed out.
const houseKwh = (d, src) => (src.loadKwh.length ? d.loadKwh
  : Math.max(0, d.solarKwh + d.batteryKwh + d.gridImportKwh - d.chargeKwh - d.gridExportKwh));

// The usual day from hour rows: average W of house use and of sun for each hour of the day
// (0 to 23, Home Assistant's time zone). null until every hour of the day has USUAL_MIN hours
// behind it. An hour some sensor has no row for is skipped: its share would be missing.
function usualDay(res, src, clock) {
  const parts = ENERGY.filter((k) => src[k].length), ids = parts.flatMap((k) => src[k]);
  const hours = new Map();
  for (const part of parts) for (const id of src[part]) for (const r of res[id] || []) {
    if (!hours.has(r.start)) hours.set(r.start, { rows: 0, ...Object.fromEntries(ENERGY.map((k) => [k, 0])) });
    const h = hours.get(r.start);
    h.rows++;
    h[part] += Math.max(0, r.change || 0);
  }
  const load = Array(24).fill(0), sun = Array(24).fill(0), count = Array(24).fill(0);
  for (const [start, h] of hours) if (h.rows === ids.length) {
    const hour = clock(start).hour;
    count[hour]++;
    load[hour] += houseKwh(h, src);
    sun[hour] += h.solarKwh;
  }
  if (!ids.length || count.some((c) => c < USUAL_MIN)) return null;
  // kWh in one hour is the average kW over it.
  const avg = (kwh) => kwh.map((v, i) => Math.round(v / count[i] * 1000));
  return { loadW: avg(load), solarW: avg(sun) };
}

// Everything that comes from the statistics, as plain numbers: today, yesterday, both months,
// the week bars and the forecast. `daily` holds day rows, `recent` 5 minute rows that cover today
// (day rows lag by up to an hour), `hourly` hour rows of the last USUAL_DAYS days, `forecast` the
// answer of energy/solar_forecast.
function totals(src, daily, recent, hourly, forecast, clock, now) {
  const at = clock(now), today = at.key;
  const month = today.slice(0, 7), last = shiftKey(month + "-01", -1).slice(0, 7);
  const days = byDay(daily, src, clock);
  // A statistic without 5 minute rows (one imported from outside) only has its day row.
  days.set(today, byDay(recent, src, clock).get(today) ?? days.get(today));
  const sum = (keys) => {
    const d = Object.fromEntries(ENERGY.map((k) => [k, 0]));
    let count = 0;
    for (const key of keys) if (days.get(key)) { count++; for (const k of ENERGY) d[k] += days.get(key)[k]; }
    d.loadKwh = houseKwh(d, src);
    return { ...d, days: count };
  };
  const of = (prefix) => [...days.keys()].filter((k) => k.startsWith(prefix));
  // Noon UTC of each day: the page formats these dates in UTC, so every viewer sees the same day.
  const week = [7, 6, 5, 4, 3, 2, 1].map((back) => shiftKey(today, -back))
    .map((key) => ({ date: Date.parse(key) + 432e5, solarKwh: sum([key]).solarKwh }));
  const sunny = week.filter((w) => w.solarKwh > 0);
  const wh = {}, whHour = {};
  for (const f of Object.values(forecast || {})) for (const [time, v] of Object.entries(f.wh_hours || {})) {
    // Each value goes to the hour its time falls in, as the Energy dashboard draws it.
    const c = clock(Date.parse(time)), hour = `${c.key} ${c.hour}`;
    wh[c.key] = (wh[c.key] || 0) + v;
    whHour[hour] = (whHour[hour] || 0) + v;
  }
  // The plan for "enough until": the usual house use, and for the sun the forecast of the next 24
  // hours where it covers that day (an hour it leaves out has no sun), else the usual sun.
  const usual = usualDay(hourly, src, clock);
  const plan = usual && { loadW: usual.loadW, solarW: [...usual.solarW] };
  if (plan) for (let i = 0; i < 24; i++) {
    const c = clock(now + i * 36e5);
    if (c.key in wh) plan.solarW[c.hour] = Math.round(whHour[`${c.key} ${c.hour}`] || 0);
  }
  const tomorrow = shiftKey(today, 1);
  // The sun forecast of this hour, and the average of the next 3.
  const fcHour = (i) => { const c = clock(now + i * 36e5); return whHour[`${c.key} ${c.hour}`] || 0; };
  const fade = { now: fcHour(0), next: (fcHour(1) + fcHour(2) + fcHour(3)) / 3 };
  const thisMonth = sum(of(month));
  return {
    today: sum([today]), yesterday: sum([shiftKey(today, -1)]), lastMonth: sum(of(last)), week,
    // Today counts as the part of it that has passed.
    month: { ...thisMonth, days: thisMonth.days - (days.get(today) ? 1 : 0) + at.hour / 24 },
    forecast: today in wh && tomorrow in wh && sunny.length
      ? { fade, today: wh[today] / 1000, tomorrow: wh[tomorrow] / 1000, usual: sunny.reduce((a, w) => a + w.solarKwh, 0) / sunny.length } : null,
    plan,
    msToMidnight: ((23 - at.hour) * 60 + 60 - at.minute) * 60e3,
  };
}

// Everything the page shows, as one plain object: live states from `hass`, the rest from
// `stats` (see totals). `src` says which entities to read (see entitiesFrom).
function readData(hass, src, stats) {
  const watts = (ids) => ids.reduce((sum, id) => sum + (stateNum(hass, id) ?? 0) * (WATTS[hass.states[id]?.attributes?.unit_of_measurement] ?? 1), 0);
  const raw = watts(src.solarW);
  const solar = raw < SOLAR_NOISE_W ? 0 : raw;
  const batt = watts(src.battW);   // positive: discharging
  const grid = watts(src.gridW);   // positive: importing
  const socs = src.soc.map((id) => [stateNum(hass, id), src.socWeight[id] || 1]).filter((s) => s[0] !== null);
  const sun = hass.states[SUN];
  const elevation = parseFloat(sun?.attributes?.elevation); // NaN while sun.sun has no value
  // Text is an entity id, unless it is a number typed as text.
  const price = (v) => (typeof v !== "string" ? v : v.trim() && !isNaN(v) ? +v : stateNum(hass, v));
  const { msToMidnight, ...rest } = stats;
  return {
    now: {
      solarW: solar,
      loadW: src.loadW.length ? watts(src.loadW) : Math.max(0, solar + batt + grid),
      gridImportW: Math.max(0, grid), gridExportW: Math.max(0, -grid),
      batteryChargeW: Math.max(0, -batt), batteryDischargeW: Math.max(0, batt),
      // null: there is a battery, but nothing tells how full it is.
      soc: socs.length ? socs.reduce((a, s) => a + s[0] * s[1], 0) / socs.reduce((a, s) => a + s[1], 0) : null,
    },
    // Kept simple: without sun.sun the sky falls back to three steps from solar power.
    sun: Number.isFinite(elevation) ? { elevation, rising: !!sun.attributes.rising }
      : { elevation: raw >= 500 ? 30 : raw >= SOLAR_NOISE_W ? SKY_LOW_DEG : -10, rising: false },
    ...rest,
    // No battery at all: its card, its place in the flow and its rows are left out.
    batt: src.battW.length || src.soc.length ? src.batt : null,
    price: { buy: price(src.price.buy), sell: price(src.price.sell) },
    admin: isAdmin(hass),
  };
}

// Numbers for the loading skeleton. Best is what this browser showed last time: same optional
// rows and text widths, so nothing moves when the real data lands. Only the sky and the viewer
// are taken fresh. Typical numbers on a first visit.
const LAST_KEY = "solar-view-last";
function placeholder(hass) {
  const sun = hass.states[SUN], elevation = parseFloat(sun?.attributes?.elevation);
  const fresh = { sun: { elevation: Number.isFinite(elevation) ? elevation : 30, rising: !!sun?.attributes?.rising }, admin: isAdmin(hass) };
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY));
    if (last && last.now && last.week && "batt" in last) return { ...last, ...fresh };
  } catch (e) { /* no storage, or an old shape: use typical numbers */ }
  const day = (solarKwh, loadKwh, gridExportKwh = 0) =>
    ({ solarKwh, loadKwh, gridImportKwh: 0.2, gridExportKwh, batteryKwh: solarKwh * 0.4, chargeKwh: solarKwh * 0.45, days: 20 });
  // The sun is known while loading: by day it fills the battery, by night the battery carries the house.
  const solarW = fresh.sun.elevation > 0 ? 1500 : 0;
  return {
    ...fresh,
    now: { solarW, loadW: 400, gridImportW: 0, gridExportW: 0, batteryChargeW: solarW ? 1100 : 0, batteryDischargeW: solarW ? 0 : 400, soc: 50 },
    // A month nearly always sends something to the grid, a single day often does not.
    today: day(8, 6), yesterday: day(15, 14), month: day(200, 190, 5), lastMonth: day(400, 390, 10),
    // Whole days, not the present moment: a date that moved would redraw the skeleton on every update.
    week: [12, 9, 15, 16, 11, 14, 15].map((solarKwh, i) => ({ date: (Math.floor(Date.now() / 864e5) - 7 + i + 0.5) * 864e5, solarKwh })),
    batt: { kwh: 10, floor: BATTERY_FLOOR_SOC }, forecast: null, price: { buy: null, sell: null },
  };
}

// 12 or 24 hour clock: the panel's `time_format`, else the viewer's profile in Home Assistant
// (Time format: "12", "24", "system" or "language"). undefined leaves it to the language.
function hourCycle(config, locale) {
  const pick = String(config?.time_format ?? locale?.time_format ?? "language");
  if (pick === "system") return /h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle) ? "h12" : "h23";
  return pick === "12" ? "h12" : pick === "24" ? "h23" : undefined;
}

// One set of Intl formatters per draw.
function formats(lang, currency, cycle) {
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat(lang, { style: "currency", currency });
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hourCycle: cycle }); // "alle 2:30", as spoken
  // Days arrive as noon UTC of the calendar day (see totals).
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
  const date = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return {
    num: (v) => number.format(v),
    kwh: (v) => `${number.format(v)} kWh`,
    money: (v) => money.format(v),
    time: (d) => time.format(d),
    weekday: (d) => weekday.format(d).replace(".", ""),
    date: (d) => date.format(d),
  };
}

// ---- Drawing ----
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

function flowSvg(n, sky, night, t, label, hints, battery) {
  const on = {
    sunHouse: Math.min(n.solarW, n.loadW) > MIN_FLOW_W,
    sunBatt: n.batteryChargeW > MIN_FLOW_W,
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
  const node = (x, y, text, body) => `<g class="node" ${hint(text)}><rect class="hit" x="${x - 36}" y="${y - 26}" width="72" height="78" fill="transparent"/>${body}</g>`;
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<path class="ray" d="M0 -16.5V-21" transform="rotate(${a})"/>`).join("");
  const sun = night
    ? `<path class="ink off" d="M4 -13.4A14 14 0 1 0 13.4 4A11 11 0 0 1 4 -13.4Z"/>`
    : `<circle r="11.5" fill="var(--sun)"/>${rays}`;
  const battW = n.batteryChargeW || n.batteryDischargeW;
  const gridW = n.gridImportW || n.gridExportW;
  const gridOff = gridW > MIN_FLOW_W ? "" : " off";
  return `<svg class="flow" viewBox="0 0 340 198" role="group" aria-label="${label}">
  <defs>
    <radialGradient id="halo"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.6"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient>
  </defs>
  ${night ? "" : `<circle class="halo" cx="170" cy="36" r="${Math.round(54 + 24 * sky.day)}" fill="url(#halo)"/>`}
  ${lines}
  <g class="node" ${hint(hints.sun)}><rect class="hit" x="142" y="8" width="96" height="98" fill="transparent"/>
  <g transform="translate(170 36)">${sun}</g>
  <text class="tl" x="183" y="86">${n.solarW > 0 ? t.sun : t.noSun}</text>
  <text class="tv" x="183" y="101">${Math.round(n.solarW)} W</text></g>
  ${battery ? node(46, 146, hints.battery, `<g transform="translate(46 146)">
    <rect x="-15" y="-9" width="30" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect class="ink" x="16.5" y="-3.5" width="3" height="7" rx="1.5"/>
    ${n.soc === null ? "" : `<rect x="-12" y="-6" width="${Math.max(2, 24 * n.soc / 100)}" height="12" rx="2.5" fill="var(${n.soc < LOW_SOC ? "--low" : "--batt"})"/>`}
  </g>
  <text class="tl" x="46" y="178" text-anchor="middle">${t.battery}</text>
  <text class="tv" x="46" y="193" text-anchor="middle">${Math.round(battW)} W</text>`) : ""}
  ${node(170, 146, hints.home, `<path class="ink house" stroke="currentColor" stroke-width="2" stroke-linejoin="round" transform="translate(170 146)" d="M0 -16L16 -3H11V14H4V4H-4V14H-11V-3H-16Z"/>
  <text class="tl" x="170" y="178" text-anchor="middle">${t.home}</text>
  <text class="tv" x="170" y="193" text-anchor="middle">${Math.round(n.loadW)} W</text>`)}
  ${node(294, 146, hints.grid, `<g class="ink plug${gridOff}" transform="translate(294 144)">
    <rect x="-7" y="-15" width="3.6" height="9" rx="1.6"/><rect x="3.4" y="-15" width="3.6" height="9" rx="1.6"/>
    <path d="M-11 -7H11V0A11 11 0 0 1 -11 0Z"/><rect x="-1.8" y="10" width="3.6" height="7" rx="1.2"/>
  </g>
  <text class="tl" x="294" y="178" text-anchor="middle">${t.grid}</text>
  <text class="tv" x="294" y="193" text-anchor="middle">${Math.round(gridW)} W</text>`)}
</svg>`;
}

const ADVICE_ICON = {
  go: `<rect x="4" y="2.5" width="16" height="19" rx="3.5" fill="currentColor"/><circle cx="12" cy="13.6" r="4.6" fill="var(--tile)"/><circle cx="7.8" cy="6" r="1.1" fill="var(--tile)"/>`,
  low: `<path d="M12 4L21 19.5H3Z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 9.5v4.6M12 17v.2" stroke="var(--tile)" stroke-width="2.4" stroke-linecap="round"/>`,
  ok: `<path d="M5.5 12.6l4.3 4.3 8.7-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  wait: `<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 7.4V12l3.2 2.1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};
ADVICE_ICON.soon = ADVICE_ICON.later = ADVICE_ICON.wait;

// ---- Pages: each returns the HTML of one page from c = { data, t, f, sky, loading } ----
const PAGES = ["now", "today", "history", "details"]; // "details" is for admin users only

// A hint target: its sentence shows on hover, tap or focus, and is its name for screen readers.
// `role` is "img" except where the element already has one (list items).
const hint = (text, role = "img") => `data-hint="${text}" aria-label="${text}" tabindex="0"${role ? ` role="${role}"` : ""}`;
const bar = (frac, color) => `<span class="bar"><i style="--w:${pct(clamp01(frac))}%;--c:var(${color})"></i></span>`;
const big = (v) => `<span class="big">${v}<small>%</small></span>`;
const row = (f, label, kwh, top, color, word) =>
  `<div class="row"><span class="lab">${label}${word ? ` <em>${word}</em>` : ""}</span><span class="num">${f.kwh(kwh)}</span>${bar(kwh / top, color)}</div>`;

function nowHtml({ data, t, f, sky, loading, day, clock }) {
  const n = data.now, today = data.today;
  const charging = n.batteryChargeW > MIN_FLOW_W, discharging = n.batteryDischargeW > MIN_FLOW_W;
  const exporting = n.gridExportW > EXPORT_W;
  const names = sources(n), src = names.map((s) => t.src[s]);
  const sentence = names.length > 1 && !names.includes("grid") ? t.sunBatt
    : say(t.runOn, { a: src.length > 1 ? say(t.and, { a: src[0], b: src[1] }) : src[0] });
  const sub = n.gridImportW > IMPORT_W ? t.subGrid
    : exporting ? t.subExport
    : charging ? t.subCharge
    : discharging ? t.subBattery : "";
  const batt = data.batt;
  const word = n.soc === null ? "" : batteryWord(n.soc);
  const battColor = word === "low" || word === "empty" ? "--low" : "--batt";
  const now = Date.now();
  const lastsH = batt ? batteryLastsH(n, data.sun, batt, data.plan, clock(now)) : 0;
  // Rounded to the half hour: the estimate is rough, and the text stays still between updates.
  const until = () => new Date(Math.round((now + lastsH * 36e5) / 18e5) * 18e5);
  const battW = Math.round(n.batteryChargeW || n.batteryDischargeW);
  const battState = charging ? t.charging
    : lastsH === Infinity ? t.untilSun
    : lastsH ? say(t.until, { t: f.time(until()) })
    : discharging ? t.discharging : t.resting;
  const hints = {
    sun: say(n.solarW > 0 ? t.hSun : t.hSunOff, { w: Math.round(n.solarW), k: f.kwh(today.solarKwh) }),
    home: say(t.hHome, { w: Math.round(n.loadW), k: f.kwh(today.loadKwh) }),
    battery: n.soc === null ? `${t.battery}: ${battW} W`
      : say(charging ? t.hBattIn : discharging ? t.hBattOut : t.hBattIdle, { p: Math.round(n.soc), w: battW }),
    grid: exporting ? say(t.hGridOut, { w: Math.round(n.gridExportW), k: f.kwh(today.gridExportKwh) })
      : say(n.gridImportW > MIN_FLOW_W ? t.hGridIn : t.hGridIdle, { w: Math.round(n.gridImportW), k: f.kwh(today.gridImportKwh) }),
  };
  const night = data.sun.elevation < SKY_NIGHT_DEG / 2 && n.solarW === 0;
  // Day starts at first light: by then the night lines (the sun has gone to bed) read wrong.
  const daytime = data.sun.elevation > (data.sun.rising ? SKY_NIGHT_DEG : 0);
  const kind = advice(n, data.forecast, daytime);
  // One line per calendar day, so it stays put between redraws and changes tomorrow.
  const lines = advicePool(t, kind, word, charging, daytime);
  const adviceText = lines[day % lines.length];
  return `
    <header><h1${loading ? ` data-wait="${t.loading}"` : ""}>${sentence}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</header>
    <div class="flowbox">${flowSvg(n, sky, night, t, sub ? `${sentence}. ${sub}` : sentence, hints, !!batt)}</div>
    ${n.soc === null ? "" : `<section class="card battery">
      <h2>${t.battery}</h2>
      <div class="batt-top">
        ${big(Math.round(n.soc))}
        <div class="batt-say"><div class="batt-word"><i style="--c:var(${battColor})"></i>${t[word]}</div><p>${battState}</p></div>
      </div>
      <div class="gauge" ${batt.kwh ? hint(say(t.hGauge, { a: f.kwh(n.soc / 100 * batt.kwh), b: f.kwh(batt.kwh) })) : ""}><i style="--w:${Math.round(n.soc)}%;--c:var(${battColor})"></i></div>
    </section>`}
    <section class="card advice" data-kind="${kind}" aria-label="${t.adviceTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${ADVICE_ICON[kind]}</svg></span>
      <p>${esc(adviceText)}</p>
    </section>`;
}

function todayHtml({ data, t, f }) {
  const d = data.today;
  const top = Math.max(d.solarKwh, d.loadKwh, d.batteryKwh, d.gridImportKwh, d.gridExportKwh, 0.1);
  const gridWord = d.gridImportKwh < 0.05 ? t.nothing : d.gridImportKwh < 1 ? t.almostNothing : "";
  const share = ownShare(d);
  const saved = savedMoney(d, data.price);
  const earned = data.price.sell === null ? 0 : d.gridExportKwh * data.price.sell;
  // Under one cent "0,00 saved" reads like a fault, so say it in words.
  const money = saved === null ? "" : `<p class="money">${saved < 0.01 ? t.savedNone : say(t.saved, { v: f.money(saved) })}${
    earned >= 0.01 ? ` · ${say(t.earned, { v: f.money(earned) })}` : ""}</p>`;
  return `
    <h2 class="title">${t.tabToday}</h2>
    <div class="share">${share === null ? `<p>${t.noUseYet}</p>` : `${big(pct(share))}<p>${t.shareToday}</p><div ${
      hint(say(t.hShare, { a: f.kwh(Math.max(0, d.loadKwh - d.gridImportKwh)), b: f.kwh(d.loadKwh) }))}>${bar(share, "--batt")}</div>${money}`}</div>
    <section class="card">
      <h3>${t.todayNumbers}</h3>
      <div class="rows">
        ${row(f, t.made, d.solarKwh, top, "--sun")}
        ${row(f, t.used, d.loadKwh, top, "--home")}
        ${data.batt ? row(f, t.takenBatt, d.batteryKwh, top, "--batt") : ""}
        ${row(f, t.taken, d.gridImportKwh, top, "--grid", gridWord)}
        ${d.gridExportKwh >= SENT_KWH ? row(f, t.sent, d.gridExportKwh, top, "--grid") : ""}
      </div>
    </section>`;
}

function historyHtml({ data, t, f }) {
  const y = data.yesterday, m = data.month, lm = data.lastMonth;
  const thisMonth = t.thisMonth.toLowerCase(), lastMonth = t.lastMonth.toLowerCase();
  const wTop = Math.max(...data.week.map((w) => w.solarKwh), 0.1);
  const week = data.week.map((w) =>
    `<li ${hint(say(t.hDay, { d: f.date(new Date(w.date)), k: f.kwh(w.solarKwh) }), "")}><span class="num">${Math.round(w.solarKwh)}</span><span class="col"><i style="--h:${Math.round(w.solarKwh / wTop * 100)}%"></i></span><span>${f.weekday(new Date(w.date))}</span></li>`).join("");
  const mTop = Math.max(m.solarKwh, lm.solarKwh, 0.1);
  const verdict = monthVerdict(data);
  const saved = (x) => savedMoney(x, data.price);
  return `
    <h2 class="title">${t.tabHistory}</h2>
    <section class="card">
      <h3>${t.yesterday}</h3>
      ${ownShare(y) === null ? "" : `<div class="yest">${big(pct(ownShare(y)))}<span>${t.homeMade}</span></div>`}
      <span class="num">${t.ySun} ${f.kwh(y.solarKwh)} · ${t.yHouse} ${f.kwh(y.loadKwh)} · ${t.yGrid} ${f.kwh(y.gridImportKwh)}${
        y.gridExportKwh >= SENT_KWH ? ` · ${t.ySent} ${f.kwh(y.gridExportKwh)}` : ""}${
        saved(y) === null ? "" : ` · ${f.money(saved(y))} ${t.ySaved}`}</span>
    </section>
    ${week ? `<section class="card">
      <h3><span>${t.week}</span> <span class="num">kWh</span></h3>
      <ol class="week">${week}</ol>
    </section>` : ""}
    <section class="card month">
      <h3>${t.monthTitle}</h3>
      ${row(f, t.thisMonth, m.solarKwh, mTop, "--sun")}
      ${row(f, t.lastMonth, lm.solarKwh, mTop, "--sun-past")}
      ${Math.max(m.gridExportKwh, lm.gridExportKwh) >= SENT_KWH
        ? `<span class="num">${t.sent}: ${thisMonth} ${f.kwh(m.gridExportKwh)} · ${lastMonth} ${f.kwh(lm.gridExportKwh)}</span>` : ""}
      ${saved(m) === null ? "" : `<span class="num">${t.savedLabel}: ${thisMonth} ${f.money(saved(m))} · ${lastMonth} ${f.money(saved(lm))}</span>`}
      ${verdict ? `<p class="verdict">${t[verdict]}</p>` : ""}
    </section>`;
}

function detailsHtml({ data, t, f }) {
  const d = data.today, m = data.month, lm = data.lastMonth, b = data.batt, fc = data.forecast, p = data.price;
  const share = (part, whole) => (whole > 0 ? `${pct(clamp01(part / whole))} %` : "-");
  const kv = (label, value) => `<span>${label}</span><b class="wide">${value}</b>`;
  const two = (label, a, c) => `<span>${label}</span><b>${f.num(a)}</b><b>${f.num(c)}</b>`;
  const price = (v) => (v === null ? t.notSet : f.money(v));
  return `
    <h2 class="title">${t.tabDetails}</h2>
    <section class="card"><h3>${t.sunUse}</h3><div class="kv">
      ${kv(t.usedAtHome, share(d.solarKwh - d.gridExportKwh, d.solarKwh))}
      ${kv(t.homeMadeShare, share(d.loadKwh - d.gridImportKwh, ownShare(d) === null ? 0 : d.loadKwh))}
    </div></section>
    <section class="card"><h3>${t.forecast}</h3>${fc ? `<div class="kv">
      ${kv(t.fToday, f.kwh(fc.today))}
      ${kv(t.fSoFar, f.kwh(d.solarKwh))}
      ${kv(t.fTomorrow, f.kwh(fc.tomorrow))}
    </div>` : `<p class="note">${t.noForecast}</p>`}</section>
    ${b ? `<section class="card"><h3>${t.battMonth}</h3><div class="kv">
      ${kv(t.roundTrip, share(lm.batteryKwh, lm.chargeKwh))}
      ${b.kwh ? kv(t.cycles, f.num(lm.batteryKwh / b.kwh)) : ""}
    </div></section>` : ""}
    <section class="card"><h3><span>${t.monthNumbers}</span> <span class="num">kWh</span></h3><div class="kv">
      <span></span><span class="head">${t.colThis}</span><span class="head">${t.colLast}</span>
      ${two(t.made, m.solarKwh, lm.solarKwh)}
      ${two(t.used, m.loadKwh, lm.loadKwh)}
      ${two(t.taken, m.gridImportKwh, lm.gridImportKwh)}
      ${two(t.sent, m.gridExportKwh, lm.gridExportKwh)}
      ${b ? two(t.battIn, m.chargeKwh, lm.chargeKwh) + two(t.battOut, m.batteryKwh, lm.batteryKwh) : ""}
    </div></section>
    <section class="card"><h3>${t.prices}</h3><div class="kv">
      ${kv(t.buy, price(p.buy))}
      ${kv(t.sell, price(p.sell))}
    </div></section>`;
}

// ---- Element ----
class SolarView extends HTMLElement {
  constructor() {
    super();
    this._drawn = "";  // key of what is on screen, to skip identical redraws
    this._src = undefined;   // which entities to read (entitiesFrom), once the Energy settings answered
    this._stats = undefined; // totals from the statistics (totals)
    this._next = 0;          // when to load both again
    // The host attributes (dark, ready) are set in _render: a custom element constructor must
    // not set attributes on itself.
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
<div class="sky"></div><div class="stars"></div><div class="veil"></div><div class="hint" aria-hidden="true"></div>
<main class="pager">${PAGES.map((p) => `<section class="page ${p}" id="${p}"></section>`).join("")}</main>
<footer><ha-menu-button hidden></ha-menu-button><nav class="tabs">${PAGES.map((p) => `<button type="button" data-page="${p}"></button>`).join("")}</nav></footer>`;
    this._pager = root.querySelector(".pager");
    this._menu = root.querySelector("ha-menu-button");
    this._tabs = [...root.querySelectorAll(".tabs button")];
    this._hint = root.querySelector(".hint");
    this._wireHints(root);
    this._wireTabs(root);
  }

  // Home Assistant can create this element and set hass, narrow and panel before this file has
  // finished loading (the load event does not wait for the imports above). Those values then sit
  // on the element as plain properties and hide the setters below, so the page stays empty.
  // Hand each one to its setter.
  connectedCallback() {
    for (const name of ["panel", "narrow", "hass"]) if (Object.hasOwn(this, name)) {
      const value = this[name];
      delete this[name];
      this[name] = value;
    }
  }

  // Hovering, tapping or focusing anything with data-hint shows its sentence. Delegated, because
  // the pages are redrawn whenever the data changes.
  _wireHints(root) {
    const hint = this._hint;
    const hide = () => hint.classList.remove("on");
    const show = (e) => {
      const el = e.target.closest && e.target.closest("[data-hint]");
      // The skeleton holds placeholder numbers: never put them in a hint.
      if (!el || this._pager.classList.contains("skel")) { hide(); return; }
      hint.textContent = el.dataset.hint;
      const box = this.getBoundingClientRect(), r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(box.width - hint.offsetWidth - 8, r.left - box.left + r.width / 2 - hint.offsetWidth / 2));
      const above = r.top - box.top - hint.offsetHeight - 8;
      hint.style.transform = `translate(${Math.round(left)}px,${Math.round(above >= 8 ? above : r.bottom - box.top + 8)}px)`;
      hint.classList.add("on");
    };
    root.addEventListener("pointerover", show);
    root.addEventListener("focusin", show);
    root.addEventListener("focusout", hide);
    this.addEventListener("pointerleave", hide);
  }

  // The tab bar follows the swipe, and a tab scrolls the pager.
  _wireTabs(root) {
    const mark = (id) => this._tabs.forEach((b) =>
      (b.dataset.page === id ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
    mark("now");
    // After a tap the pager scrolls past the pages in between: the tapped tab stays marked until
    // its page arrives. A touch or the wheel means the viewer took over, so the swipe leads again.
    let going = "";
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && (!going || e.target.id === going)) { going = ""; mark(e.target.id); }
    }, { root: this._pager, threshold: 0.6 });
    [...this._pager.children].forEach((p) => io.observe(p));
    for (const type of ["pointerdown", "wheel"]) this._pager.addEventListener(type, () => { going = ""; }, { passive: true });
    this._tabs.forEach((b) => b.addEventListener("click", () => {
      const page = root.getElementById(b.dataset.page);
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      going = page.id;
      this._pager.scrollTo({ left: page.offsetLeft - this._pager.offsetLeft, behavior: calm ? "instant" : "smooth" });
      mark(page.id);
    }));
  }

  // Home Assistant's menu button is the only way out whenever its sidebar is not on screen:
  // on a narrow screen, or on any screen when the user chose to always hide the sidebar.
  _showMenu() { this._menu.hidden = !(this._narrow || this._hass?.dockedSidebar === "always_hidden"); }

  // Home Assistant passes the panel_custom entry here; its `config:` holds the owner's settings.
  set panel(p) { this._panel = p; this._drawn = ""; if (this._hass) this._load(); this._render(); }
  get panel() { return this._panel; }

  set narrow(v) { this._narrow = v; this._menu.narrow = v; this._showMenu(); }
  get narrow() { return this._narrow; }

  set hass(hass) {
    this._hass = hass;
    this._menu.hass = hass;
    this._showMenu();
    if (Date.now() >= this._next) this._load();
    this._render();
  }
  get hass() { return this._hass; }

  // Which entities to read (Energy settings plus config), then their totals from the statistics.
  // Kept simple: everything is asked again every 5 minutes, about 2000 small rows, except the hour
  // rows of the usual day (as many again), asked once an hour. Ask the day rows hourly too if that
  // ever shows up as load.
  async _load() {
    const hass = this._hass, now = Date.now(), run = (this._run = (this._run || 0) + 1);
    this._next = now + REFRESH_MS;
    try {
      // "No prefs": the Energy page was never set up. The owner's config may still name entities.
      const prefs = await hass.callWS({ type: "energy/get_prefs" }).catch((e) => { if (e && e.code === "not_found") return null; throw e; });
      const src = entitiesFrom(prefs, this._panel?.config || {});
      const ids = ENERGY.flatMap((k) => src[k]);
      const stat = (period, start) => (ids.length ? hass.callWS({
        type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(),
        statistic_ids: ids, period, types: ["change"], units: { energy: "kWh" },
      }) : {});
      // The usual day moves slowly: its hour rows are asked once an hour.
      const asked = `${ids} ${src.usualDays}`;
      const kept = this._hourly && this._hourly.asked === asked && now < this._hourly.until ? this._hourly : null;
      // 63 days reach the first day of last month from any day. 25 hours cover today, even a long one.
      const [daily, recent, hourly, forecast] = await Promise.all([stat("day", now - 63 * 864e5), stat("5minute", now - 25 * 36e5),
        kept ? kept.rows : stat("hour", now - src.usualDays * 864e5), hass.callWS({ type: "energy/solar_forecast" }).catch(() => ({}))]);
      // `hass` and `panel` each start a load when the page opens: only the newest may answer,
      // or entities read without the config could land last.
      if (run !== this._run) return;
      this._src = src;
      this._hourly = kept || { asked, until: now + 36e5, rows: hourly };
      this._stats = totals(src, daily, recent, hourly, forecast, clockOf(hass.config?.time_zone), now);
      // Just after midnight "today" must start from zero.
      this._next = Math.min(this._next, now + this._stats.msToMidnight + 5e3);
      this._render();
    } catch (e) {
      console.warn("solar-view: loading the numbers failed", e);
      this._next = Date.now() + 60e3; // try again in a minute, not in 5
    }
  }

  _render() {
    const hass = this._hass;
    if (!hass) return;
    // The viewer's language when its texts exist ("pt-BR", then "pt"), else English. Numbers and
    // dates follow the viewer's language either way.
    const locale = String((hass.locale && hass.locale.language) || hass.language || "en");
    const lang = [locale, locale.split("-")[0], "en"].find((l) => STRINGS[l]);
    const dark = !!(hass.themes && hass.themes.darkMode);
    const t = withOwnAdvice(STRINGS[lang], this._panel?.config, lang);
    const $ = (id) => this.shadowRoot.getElementById(id);
    const paint = (prefix, colors) => colors.slice(0, 3).forEach((c, i) => this.style.setProperty(`--${prefix}${i + 1}`, c));
    this.toggleAttribute("dark", dark);
    this._pager.setAttribute("aria-label", t.pages);
    // Written only on a change: this runs on every state change in the house.
    [t.tabNow, t.tabToday, t.tabHistory, t.tabDetails].forEach((label, i) => { if (this._tabs[i].textContent !== label) this._tabs[i].textContent = label; });
    // The Info page is for the owner. Hiding it is tidiness, not security: the sensors are readable anyway.
    $("details").hidden = this._tabs[3].hidden = !isAdmin(hass);

    // Three ways to have nothing to show. Still loading: the Energy settings or the statistics
    // have not answered, or Home Assistant is starting and the sensors are not there yet.
    // Not set up: no solar power sensor, or a sensor that does not exist. Offline: the sensors
    // exist but have no value. Drawing zeros instead would read as "battery empty".
    const src = this._src, core = src ? coreIds(src) : [];
    const missing = core.filter((id) => !hass.states[id]);
    const started = !hass.config || hass.config.state === "RUNNING";
    const setup = !!src && (!src.solarW.length || (missing.length > 0 && started));
    const silent = core.some((id) => stateNum(hass, id) === null);
    // While Home Assistant starts, sensors without a value are still loading, not offline.
    const loading = !setup && (!src || !this._stats || missing.length > 0 || (silent && !started));
    const offline = !loading && !setup && silent;
    // The veil is a plain day sky over the real one. It fades out once there is data, so the
    // real sky colour arrives as a transition instead of a jump.
    paint("l", skyAt(30, false, dark).colors);
    this._pager.setAttribute("aria-busy", String(loading));
    this._pager.classList.toggle("skel", loading);
    // Placeholder numbers must not be read out as if they were real.
    // aria-hidden needs the value "true" (an empty one hides nothing); inert keeps focus out too.
    PAGES.forEach((p) => {
      $(p).inert = loading;
      if (loading) $(p).setAttribute("aria-hidden", "true"); else $(p).removeAttribute("aria-hidden");
    });
    if (offline || setup) {
      // Naming the missing sensors helps the owner; to anyone else they mean nothing.
      const message = offline ? t.offline : t.setup + (missing.length && isAdmin(hass) ? ` ${t.missing} ${esc(missing.join(", "))}` : "");
      if (this._drawn === message) return;
      this._drawn = message;
      this.removeAttribute("ready");
      this._hint.classList.remove("on");
      PAGES.forEach((p) => { $(p).innerHTML = p === "now" ? `<p class="empty">${message}</p>` : ""; });
      return;
    }

    // Loading draws the real markup from placeholder numbers and .skel greys it out, so the
    // skeleton has exactly the size of what replaces it.
    const data = loading ? placeholder(hass) : readData(hass, src, this._stats);
    const day = this.testDay ?? Math.round(new Date().setHours(0, 0, 0, 0) / 864e5); // testDay: preview harness only (?day=)
    const cycle = hourCycle(this._panel?.config, hass.locale);
    const key = loading + locale + cycle + dark + day + JSON.stringify(data);
    if (key === this._drawn) return; // same data again: leave the DOM (and its motion) alone
    this._drawn = key;
    if (loading) this.removeAttribute("ready");
    else {
      try { localStorage.setItem(LAST_KEY, JSON.stringify(data)); } catch (e) { /* storage is optional */ }
      if (!this.hasAttribute("ready")) { // first real data: fade the veil out, let the content rise in
        this.setAttribute("ready", "");
        this._pager.classList.add("fresh");
        setTimeout(() => this._pager.classList.remove("fresh"), 900);
      }
    }

    const sky = skyAt(data.sun.elevation, data.sun.rising, dark);
    paint("s", sky.colors);
    this.style.setProperty("--glow", sky.colors[3]);
    this.style.setProperty("--stars", dark ? (0.7 * (1 - sky.up)).toFixed(2) : "0");

    const f = formats(locale, hass.config?.currency || "EUR", cycle);
    const c = { data, t, f, sky, loading, day, clock: clockOf(hass.config?.time_zone) };
    let html;
    try {
      html = [nowHtml(c), todayHtml(c), historyHtml(c), data.admin ? detailsHtml(c) : ""];
    } catch (e) {
      // Never a blank page: what is drawn stays. While loading the likely cause is a remembered
      // copy from an older version, so drop it and draw the typical numbers instead.
      console.error("solar-view: draw failed", e);
      let had = false;
      try { had = localStorage.getItem(LAST_KEY) !== null; localStorage.removeItem(LAST_KEY); } catch (e2) { /* no storage */ }
      if (loading && had) this._render();
      return;
    }
    this._hint.classList.remove("on"); // its sentence belonged to the old numbers
    // The redraw replaces every element. Keep keyboard focus on the same hint target.
    const targets = () => [...this.shadowRoot.querySelectorAll("[data-hint]")];
    const focused = targets().indexOf(this.shadowRoot.activeElement);
    PAGES.forEach((p, i) => { $(p).innerHTML = html[i]; });
    if (focused >= 0) targets()[focused]?.focus({ preventScroll: true });
  }
}

// A tab left open across an update loads the new version beside the old one: keep the old
// element until the page is refreshed instead of throwing.
if (!customElements.get("solar-view")) customElements.define("solar-view", SolarView);
export { STRINGS, entitiesFrom, clockOf, totals, batteryLastsH }; // for the checks in the preview harness
