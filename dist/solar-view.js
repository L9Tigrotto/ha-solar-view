/* Solar page in plain words: a Home Assistant custom panel (panel_custom in configuration.yaml).
   Home Assistant sets `hass` on the element, so login, live states and language come for free.
   Served WITHOUT login, under /hacsfiles/ (HACS) or /local/ (copied by hand): never put a secret here.
   /local/ is cached hard: there, bump ?v= in configuration.yaml after every edit of any file. /hacsfiles/ tells the browser not to cache.

   Files: this one (rules, logic, drawing, the element), forecast.js (the day simulation and what follows
   from the forecast), strings-en.js and one strings-xx.js per language (every text), styles.js (the CSS).
   Sections here: entities, rules, sky, parts, logic, data, drawing, pages, element. */

// ---- Entities ----
// Which sensors to read comes from Home Assistant's own Energy settings, so any brand set up
// there works. Each list can be replaced in the panel's `config:` (see entitiesFrom):
//   entities: { solar_power: sensor.x, battery_soc: [sensor.a, sensor.b], ... }
const SUN = "sun.sun";
// The charts and lists the arrow keys move along, each one Tab stop (see _rove).
const ROVE = ":is(ul.hours,ul.days,ol.week,ol.year,ol.hours24,svg.cols)";
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
  // Money, in the currency: what the grid cost and paid, as Home Assistant counts it for the Energy page
  // (its own cost sensors when the Energy settings name none, see entitiesFrom).
  grid_cost: ["costMoney", "grid", "stat_cost"],
  grid_compensation: ["earnedMoney", "grid", "stat_compensation"],
};
const ENERGY = ["solarKwh", "batteryKwh", "chargeKwh", "gridImportKwh", "gridExportKwh", "loadKwh"];
const PARTS = [...ENERGY, "costMoney", "earnedMoney"]; // everything summed from the statistics
const zero = () => Object.fromEntries(PARTS.map((k) => [k, 0])); // every part at 0, to add into
const WATTS = { W: 1, kW: 1e3, MW: 1e6 };

// ---- Rules (tune here) ----
const POOR_SHARE = 0.55;      // a forecast for today under this share of a usual day is a poor day
const BETTER_TIMES = 1.5;     // tomorrow must beat today by this factor before saying "wait for tomorrow"
const BATTERY_FLOOR_SOC = 20; // percent where the inverter stops discharging, unless config says battery_floor
const LASTS_MIN_H = 0.5;      // "enough until" is only shown between these many hours
const LASTS_MAX_H = 18;
const USUAL_DAYS = 14;    // the usual day (Energy's dashed lines) averages each hour over these many days, unless config says usual_days
const USUAL_MIN = 3;      // until every hour of the day has this many days behind it there is no usual day (no dashed lines, no forecast built here)
const SURPLUS_W = 1000;   // solar minus house use above this: good moment for big appliances
const FADE_MIN_W = 500;   // the sun forecast for this hour must reach this before a drop in the next 3 hours is worth a warning
const FADE_SHARE = 0.4;   // the next 3 hours average under this share of this hour: the sun is fading soon
const LATER_MIN_W = 500;  // the next 3 hours must average this much forecast sun before "more sun is coming" is said
const LATER_TIMES = 2;    // and at least this many times this hour's forecast
const EXPORT_W = 50;      // sending more than this to the grid shows as a flow, and counts as spare sun when the battery is nearly full
const IMPORT_W = 50;      // importing more than this counts as "the grid is helping"
// Battery words by whole percent, counted from the floor (where the inverter stops discharging):
// at the floor empty, up to 15 above it low, then good, 85 to 99 almost full, 100 full.
const LOW_ABOVE_FLOOR = 16; // under this many percent above the floor is "low", and the low battery warning can fire
const HIGH_SOC = 85;      // from here up it is "almost full"
const MIN_USE_KWH = 0.05; // under this the house has used nothing yet today, so there is no share to show
const LOW_SOLAR_W = 100;  // "no real sun" for the low battery warning
const MIN_FLOW_W = 20;    // below this a flow is treated as off
const SOLAR_NOISE_W = 15; // an inverter can report a few watts all night (7 to 8 W measured)
const SENT_KWH = 0.05;    // "sent to the grid" rows stay hidden below this
const PAYBACK_SPREAD = 0.2; // payback's likely range: every coming month this much better and worse, until a year is on record
const PAYBACK_MAX_MONTHS = 600; // the payback walk gives up here (50 years)
const STANDBY_MIN_KWH = 1; // a load sensor this much a day under the energy balance: the gap is the inverter's standby
const SOON_PCT = 1;       // the battery in an hour shows when it moves this many points or more, its likely range when that spans as much
const REFRESH_MS = 5 * 60 * 1000; // totals come from the statistics, which move every 5 minutes

// ---- Sky: colours follow the sun's height (sun.sun elevation, degrees) ----
const SKY_DEEP_DEG = -18; // at or below: the night's own colours (astronomical night)
const SKY_NIGHT_DEG = -6; // at or below: night, still keeping some dawn or dusk down to SKY_DEEP_DEG
const SKY_LOW_DEG = 1;    // around here: full dawn or dusk colours
const SKY_DAY_DEG = 14;   // at or above: full day
const SKY_HIGH_DEG = 50;  // at or above: the day's own colours; below it the day keeps some dawn or dusk
const SKY_LOW_SHARE = 0.3; // how much dawn or dusk the day keeps at SKY_DAY_DEG, and the night at SKY_NIGHT_DEG
const CLOUD_GREY_FROM = 50; // forecast cloud cover in %: under this the sky keeps its colour
const CLOUD_GREY_FULL = 90; // from here up the day sky is fully grey
const RAIN_MM = 0.2;        // the forecast hour must bring more than this to show rain
const RAIN_DAY_MM = 1;      // a coming day shows rain from this much in the day
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
// Texts: one file per language (strings-it.js), loaded the first time it is on screen. English is always
// there, under every other language, so a key one lacks reads in English (a half-copied /local/ update).
const version = new URL(import.meta.url).search;
// This device's language, set in the gear's dialog: one of LANGUAGES, kept apart from the Home Assistant
// profile. Absent (Automatic) the page follows the viewer's language there. Each language by its own name.
const LANGUAGE_KEY = "solar-view-language";
const LANGUAGES = { en: "English", it: "Italiano", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", nl: "Nederlands", pl: "Polski" };
const STRINGS = {}; // the languages loaded so far
const failedLanguages = new Set(); // these stay English for this visit
const textsOf = (code) => import(`./strings-${code}.js${version}`).then((m) => m.STRINGS[code]);
const english = textsOf("en");
const loads = {};
const loadLanguage = (code) => loads[code] ??= Promise.all([english, code === "en" ? {} : textsOf(code)]).then(
  ([en, own]) => { STRINGS[code] = { ...en, ...own }; },
  (e) => { failedLanguages.add(code); console.warn("solar view: the texts for", code, "did not load", e); });
// The first language is guessed, so its file comes with the others: this device's choice in the gear, else
// the page's language, which Home Assistant sets to the viewer's. A wrong guess costs one file; _render
// then loads the right one.
const supported = (l) => [l, l.split("-")[0]].find((c) => Object.hasOwn(LANGUAGES, c));
let guess = "";
try { guess = localStorage.getItem(LANGUAGE_KEY) ?? ""; } catch (e) { /* no storage */ }
guess = supported(guess) ?? supported(document.documentElement.lang || navigator.language || "") ?? "en";
const [, , { CSS }, { findForecast, forecastOf, lookAhead, efficiencyOf, moneySoFar }] = await Promise.all([
  english, loadLanguage(guess), import(`./styles.js${version}`), import(`./forecast.js${version}`)]);

// ---- Logic (pure) ----
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pct = (v) => Math.round(v * 100);
// say("{a} and {b}", { a, b }): placeholders are one letter.
const say = (text, parts) => text.replace(/\{(\w)\}/g, (_, k) => parts[k]);
const cap = (text) => text[0].toUpperCase() + text.slice(1);
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
// The months Production and Month balance show, January to December, each the latest of its name up to
// this month (`key`, "2026-10"): this year's up to it, last year's after it.
const yearKeys = (key) => { const [y, m] = key.split("-").map(Number); return Array.from({ length: 12 }, (_, i) => `${i < m ? y : y - 1}-${String(i + 1).padStart(2, "0")}`); };
// Start of the hour holding ms, from the clock's minute: right in half hour time zones too.
const hourStart = (ms, clock) => ms - clock(ms).minute * 60e3 - (ms % 60e3);
// A state as a number, null when the entity is missing or has no value.
const stateNum = (hass, id) => { const v = parseFloat(hass.states[id]?.state); return Number.isFinite(v) ? v : null; };

// "go": spare sun now: sun over the house's use while the battery is nearly full, or there is none (until
// then the sun is filling the battery), or sending to the grid with a nearly full battery (a few watts
// sent out by a house without one would not run a washing machine).
// "soon": spare sun now, but the forecast says it fades within 3 hours (a cycle would run into it).
// Not with a nearly full battery, which carries the cycle to its end: so only without a battery.
// "low": the battery word is low or empty (see batteryWord) and there is no real sun.
// "wait": today's forecast is poor against a usual day here (the average of the days with sun
// among the last 7), and tomorrow's is clearly better.
// "later": no spare sun now, but the next 3 hours are forecast to be clearly sunnier.
function advice(n, forecast, daytime, word) {
  const high = isHigh(word);
  if ((n.solarW - n.loadW > SURPLUS_W && (high || !word)) || (high && n.gridExportW > EXPORT_W))
    return !high && forecast && forecast.fade.now >= FADE_MIN_W && forecast.fade.next < forecast.fade.now * FADE_SHARE ? "soon" : "go";
  if (isLow(word) && n.solarW < LOW_SOLAR_W) return "low";
  if (daytime && forecast && forecast.tomorrow !== null && forecast.usual !== null
    && forecast.today < forecast.usual * POOR_SHARE && forecast.tomorrow >= forecast.today * BETTER_TIMES) return "wait";
  if (daytime && forecast && forecast.fade.next >= LATER_MIN_W && forecast.fade.next >= forecast.fade.now * LATER_TIMES) return "later";
  return "ok";
}
// Where "ok" would take the general lines (see advicePool), the forecast's outlook can say more, from its
// mid run: in the evening or at night with the battery carrying the house, "short" when it runs out
// before the sun takes over (lastsH a time), "okLasts" when it does not (lastsH Infinity); by day "fills"
// when the battery fills later today and spare sun is left over. Without an outlook "ok" stays.
function outlookAdvice(kind, outlook, word, sunCharging, daytime, evening, lastsH) {
  if (kind !== "ok" || !outlook || (sunCharging && isLow(word)) || (isHigh(word) && daytime)) return kind;
  if (evening && lastsH) return lastsH === Infinity ? "okLasts" : "short";
  return daytime && outlook.fills ? "fills" : kind;
}

// The lines that fit the situation: the advice kind, narrowed by the battery word where a more
// specific line is true. Specific lines come first, then the general ones, for more variety.
// `sunCharging`: the battery is filling from the sun, not from the grid.
function advicePool(t, kind, word, sunCharging, daytime) {
  const high = isHigh(word);
  const general = daytime ? t.adviceOk : t.adviceOkNight;
  const fromForecast = { wait: t.adviceWait, soon: t.adviceSoon, later: t.adviceLater, short: t.adviceShort, okLasts: t.adviceOkLasts, fills: t.adviceFills }[kind];
  if (fromForecast) return fromForecast;
  // The go-full lines say "battery full": only at 100 %.
  if (kind === "go") return word === "full" ? [...t.adviceGoFull, ...t.adviceGo] : t.adviceGo;
  if (kind === "low") return word === "empty" ? t.adviceEmpty : t.adviceLow;
  if (sunCharging && isLow(word)) return t.adviceOkRefill;
  // The full battery lines speak of the day ahead.
  return high && daytime ? [...t.adviceOkFull, ...general] : general;
}

// The strings of one language with the owner's own advice lines merged in. They come from the
// panel's `config:` in configuration.yaml (see the example in docs/setup.md), so nobody edits this file:
//   advice: { it: { ok: ["..."], go: ["..."] }, en: { ... } }   added to the built-in lines
//   advice_replace: true                                        a pool with own lines uses only those
// Pool names: go, goFull, soon, later, low, empty, wait, ok, okNight, okFull, okRefill, short, okLasts, fills.
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

// Today's mean charge by the hour, from the statistics of every battery's charge sensor, weighted as the live
// reading (see readData): [[hour start, %], ...], oldest first. The present hour has no row yet. An hour
// some battery of `ids` has no mean for is left out: the others alone are not the charge of them all.
function socDay(rows, weight, clock, now, ids = Object.keys(rows || {})) {
  const today = clock(now).key, by = new Map();
  for (const [id, list] of Object.entries(rows || {})) for (const r of list || []) {
    if (!Number.isFinite(r.mean) || clock(r.start).key !== today) continue;
    const t = hourStart(r.start, clock), w = weight[id] || 1, a = by.get(t) ?? [0, 0, 0];
    by.set(t, [a[0] + r.mean * w, a[1] + w, a[2] + 1]);
  }
  return [...by].filter(([, a]) => a[2] >= ids.length).sort((a, b) => a[0] - b[0]).map(([t, [s, w]]) => [t, s / w]);
}
// Hours the battery can carry the house, from the forecast: `until` is when its mid run reaches the floor
// (see lookAhead), null for no answer. 0 when it is not carrying it or the answer is not worth showing,
// Infinity when the sun takes over before it runs out. Without the forecast there is no answer: a guess
// from the usual day read as a promise.
function outlookLastsH(n, batt, until, now) {
  if (n.soc === null || !batt.kwh || n.batteryDischargeW <= MIN_FLOW_W || n.solarW >= n.loadW) return 0;
  if (until === Infinity) return Infinity;
  const h = ((until ?? now) - now) / 36e5;
  return h >= LASTS_MIN_H && h <= LASTS_MAX_H ? h : 0;
}

function batteryWord(soc, floor) {
  const p = Math.round(soc);
  return p <= floor ? "empty" : p < floor + LOW_ABOVE_FLOOR ? "low" : p < HIGH_SOC ? "good" : p < 100 ? "nearlyFull" : "full";
}
// "" (no state of charge) is neither.
const isLow = (word) => word === "low" || word === "empty";
const isHigh = (word) => word === "full" || word === "nearlyFull";
// The battery is filling mostly from the grid (a cheap night rate, say), not from the sun.
const gridCharging = (n) => n.batteryChargeW > MIN_FLOW_W && n.solarW < n.batteryChargeW / 2;

// Up to two sources that really carry the house right now, biggest first.
function sources(n) {
  const all = [["sun", Math.min(n.solarW, n.loadW)], ["battery", n.batteryDischargeW], ["grid", n.gridImportW]]
    .sort((a, b) => b[1] - a[1]);
  const floor = Math.max(MIN_FLOW_W, n.loadW * 0.25);
  const big = all.filter((s) => s[1] >= floor).slice(0, 2);
  return (big.length ? big : all.slice(0, 1)).map((s) => s[0]);
}

// Share of the house use that did not come from the grid. null while nothing has been used
// (just after midnight), or when either figure is unknown: neither 0 % nor 100 % would be true.
function ownShare(d) { return Number.isFinite(d.loadKwh) && Number.isFinite(d.gridImportKwh) && d.loadKwh >= MIN_USE_KWH ? clamp01(1 - d.gridImportKwh / d.loadKwh) : null; }
// The sum of figures, null (unknown) when any of them is.
const sumKnown = (values) => (values.every(Number.isFinite) ? values.reduce((s, v) => s + v, 0) : null);
// Energy at a price: 0 kWh costs 0 even without a price; unknown energy or price, null.
const pricedEnergy = (kwh, rate) => (!Number.isFinite(kwh) ? null : kwh === 0 ? 0 : Number.isFinite(rate) ? kwh * rate : null);
// Money not spent on the grid. null without a price or with an unknown figure.
const savedMoney = (d, price) => (![d.loadKwh, d.gridImportKwh].every(Number.isFinite) ? null : pricedEnergy(Math.max(0, d.loadKwh - d.gridImportKwh), price.buy));

const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, f) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * f).toString(16).padStart(2, "0")).join("");

// Night blends into dawn or dusk, which blends into day, by sun elevation. The day itself keeps a little
// of dawn or dusk while the sun is low, and reaches its own colours only with a high sun, so a summer noon
// is the deepest blue and a winter day stays a touch warmer. The night mirrors it: a little of dusk or dawn
// while the sun is just under the horizon, its own colours only in the deep night, so a summer night
// (the sun barely below -18) stays a touch lighter than a winter one. `grey` (0 to 1, see greyOf) turns
// only the day colours toward a grey of the same lightness, so it counts by the day's share.
function skyAt(elevation, rising, dark, grey = 0) {
  const p = SKY[dark ? "dark" : "light"];
  const low = p.dusk.map((c, i) => mix(c, p.dawn[i], +rising)); // `rising` may be a share, see dawnOf
  const up = smooth((elevation - SKY_NIGHT_DEG) / (SKY_LOW_DEG - SKY_NIGHT_DEG));
  const day = smooth((elevation - SKY_LOW_DEG) / (SKY_DAY_DEG - SKY_LOW_DEG));
  const warm = SKY_LOW_SHARE * (1 - smooth((elevation - SKY_DAY_DEG) / (SKY_HIGH_DEG - SKY_DAY_DEG)));
  const dusky = SKY_LOW_SHARE * smooth((elevation - SKY_DEEP_DEG) / (SKY_NIGHT_DEG - SKY_DEEP_DEG));
  const dayColors = p.day.map((c, i) => {
    c = mix(c, low[i], warm);
    const [r, g, b] = hex(c), v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, "0");
    return mix(c, `#${v}${v}${v}`, grey);
  });
  return { colors: p.night.map((c, i) => mix(mix(mix(c, low[i], dusky), low[i], up), dayColors[i], day)), up, day };
}
// How much the low sky is dawn's (1) rather than dusk's (0), by the sun's direction: 1 east, 0 west, half
// and half at noon and midnight, so a low winter noon does not jump from dawn to dusk when `rising` turns.
// Without an azimuth, by `rising`. Rounded, so the redraw key does not move with every digit.
const dawnOf = (a) => { const az = parseFloat(a?.azimuth); return Number.isFinite(az) ? Math.round(50 * (1 + Math.sin((az * Math.PI) / 180))) / 100 : !!a?.rising; };
// Forecast cloud cover in % to how grey the day sky is: 0 under 50, 1 from 90 up, 0 when unknown.
const greyOf = (cloud) => (Number.isFinite(cloud) ? clamp01((cloud - CLOUD_GREY_FROM) / (CLOUD_GREY_FULL - CLOUD_GREY_FROM)) : 0);

// Where the forecast hour holding `now` is in `ahead.hours`, -1 when there is none.
const hourIndex = (ahead, now) => ahead?.hours.findIndex((h) => h.t <= now && now < h.t + 36e5) ?? -1;
// That hour, from a fresh sensor only: the forecast the page builds has no cloud, rain or prices.
const presentHour = (ahead, now) => (ahead?.from === "sensor" ? ahead.hours[hourIndex(ahead, now)] : undefined);
// The first weather entity, by id. Looked for again only when it goes, or after a minute (one added that
// sorts first): every id in the house is a long list to go through on each state change.
let weatherId, weatherAt = 0;
function weatherOf(hass) {
  if (!hass.states[weatherId] || Date.now() - weatherAt > 6e4) {
    weatherId = Object.keys(hass.states).filter((k) => k.startsWith("weather.")).sort()[0];
    weatherAt = Date.now();
  }
  return hass.states[weatherId];
}
// Rain now: the sensor's present hour when it is fresh (it wins, even saying no rain), else the weather
// entity. Never while that entity says snow alone: the sensor counts snow as rain.
function raining(ahead, state, now) {
  if (state === "snowy") return false;
  if (ahead?.from === "sensor") return (presentHour(ahead, now)?.rain ?? 0) > RAIN_MM;
  return ["rainy", "pouring", "lightning-rainy", "snowy-rainy"].includes(state);
}
// Cloud cover now in %: the sensor's present hour when it is fresh, else the weather entity's
// `cloud_coverage` (what it sees now, not a forecast; not every weather integration has it).
const cloudNow = (ahead, coverage, now) => (ahead?.from === "sensor" ? presentHour(ahead, now)?.cloud : Number(coverage ?? NaN));
// Snow now: only the weather entity knows it (the sensor has no snow).
const snowing = (state) => ["snowy", "snowy-rainy"].includes(state);
// What covers the sun or moon icon this hour, by the sky's thresholds: "snow", "rain", "overcast" (cloud
// from 90 %), "partly" (50 to 90 %) or "" (clear, or no cloud known).
const coverOf = (cloud, rain, snow = false) => (snow ? "snow" : rain ? "rain" : cloud >= CLOUD_GREY_FULL ? "overcast" : cloud >= CLOUD_GREY_FROM ? "partly" : "");
// The moon's phase in 8 steps (0 new, 2 first quarter, 4 full, 6 last quarter), from a known new moon
// and the mean length of a lunar month.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14), LUNAR_DAYS = 29.530588853;
const moonPhase = (ms) => Math.round(((((ms - NEW_MOON) / 864e5 / LUNAR_DAYS) % 1) + 1) % 1 * 8) % 8;

// ---- Data ----
// A calendar date written YYYY-MM-DD, kept as that text; null for anything else, or a day that does not
// exist (2026-02-30 is not read as 2 March).
function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}
// The entity ids to read, as lists (several solar arrays or batteries are summed): from the
// Energy settings (`prefs`, the answer of energy/get_prefs, or null), then the owner's `config:`.
// `costs` (energy/info's cost_sensors) names the cost sensor Home Assistant made for each grid
// statistic with a price, where the settings name no cost statistic of their own.
function entitiesFrom(prefs, config = {}, costs = {}) {
  const energySources = prefs?.energy_sources ?? [];
  // Older Home Assistant keeps a grid as lists of flows, newer as one import and export pair.
  // An old export flow names its price like an import one, so it is renamed here.
  const flat = energySources.flatMap((s) => [s, ...["flow_from", "flow_to", "power"].flatMap((k) => (s[k] || []).map((x) => (k === "flow_to"
    ? { type: s.type, stat_energy_to: x.stat_energy_to, stat_compensation: x.stat_compensation, entity_energy_price_export: x.entity_energy_price, number_energy_price_export: x.number_energy_price }
    : { ...x, type: s.type })))])
    .map((s) => ({ ...s, stat_cost: s.stat_cost ?? costs?.[s.stat_energy_from], stat_compensation: s.stat_compensation ?? costs?.[s.stat_energy_to] }));
  const own = config.entities || {};
  const src = {};
  for (const [name, [key, type, field]] of Object.entries(ENTITIES))
    src[key] = own[name] ? [].concat(own[name]) : flat.filter((s) => s.type === type && s[field]).map((s) => s[field]);
  const batteries = energySources.filter((s) => s.type === "battery");
  const sized = batteries.length > 0 && batteries.every((b) => b.capacity > 0);
  const price = (entity, number) => flat.map((s) => s[entity] ?? s[number]).find((v) => v != null) ?? null;
  const num = (v, otherwise) => (Number.isFinite(v) && v >= 0 ? v : otherwise); // anything but a number of 0 or more is ignored
  return {
    ...src,
    // State of charge of several batteries: weighted by size when every size is known.
    socWeight: Object.fromEntries(batteries.map((b) => [b.stat_soc, sized ? b.capacity : 1])),
    batt: {
      kwh: config.battery_kwh ?? (sized ? batteries.reduce((sum, b) => sum + b.capacity, 0) : null),
      floor: config.battery_floor ?? BATTERY_FLOOR_SOC,
      maxChargeKw: num(config.battery_max_charge_kw, null), // null: no limit
    },
    // For the forecast: null is no export limit (0 on zero-export inverters); the inverter's own use
    // in W, null when not set (then worked out in totals).
    exportMaxKw: num(config.export_max_kw, null),
    standbyW: num(config.standby_w, null),
    // Fewer than USUAL_MIN days could never make a usual day.
    usualDays: Math.max(USUAL_MIN, Math.round(Number(config.usual_days)) || USUAL_DAYS),
    // Payback: what the system cost, the day it started, and what it saved before Home Assistant recorded.
    // No cost, no payback card; a date that is not a real YYYY-MM-DD day counts from the first month on record.
    payback: num(config.system_cost, 0) > 0
      ? { cost: config.system_cost, since: calendarDate(config.install_date), before: num(config.saved_before, 0) } : null,
    // The bill's fixed part, a month (a meter fee, say): added to every month's cost on Money. The id of an
    // entity holding it, so each month keeps what it was then (see fixedAt); a number counts for every month.
    billFixed: typeof config.bill_fixed === "string" ? config.bill_fixed : num(config.bill_fixed, 0),
    // The Energy settings' prices: a number, or the id of an entity holding one, so Home Assistant keeps
    // their history in the cost statistics.
    price: { buy: price("entity_energy_price", "number_energy_price"),
      sell: price("entity_energy_price_export", "number_energy_price_export") },
  };
}
// The live sensors the Now page cannot do without.
const coreIds = (src) => [...src.solarW, ...src.battW, ...src.gridW, ...src.soc, ...src.loadW];

// Statistics rows summed into buckets (`keyOf` gives a row's bucket): Map of key to { solarKwh, ... }.
// A part is known only when every meter it sums has a valid row for every energy interval of the bucket;
// else it is null (unknown), never a partial sum. A part with no meter is 0 for energy (nothing to
// count) and null for money (nothing on record: the price stands in, see moneyHtml). Minutes no meter has a
// row for are not looked for: a meter that only counts up puts what it counted while unavailable (a restart,
// a cloud integration offline) into its first row after, so the sum is still whole.
function statisticsBuckets(res, src, keyOf) {
  const buckets = new Map(), energyIds = new Set(ENERGY.flatMap((part) => src[part]));
  for (const id of new Set(PARTS.flatMap((part) => src[part]))) for (const r of res[id] || []) {
    const key = keyOf(r.start);
    if (!buckets.has(key)) buckets.set(key, { starts: new Set(), meters: new Map() });
    const b = buckets.get(key);
    if (energyIds.has(id)) b.starts.add(r.start);
    if (!b.meters.has(id)) b.meters.set(id, { sum: 0, valid: new Set(), invalid: false });
    const m = b.meters.get(id);
    // An energy meter only counts up; money keeps its sign (a negative tariff pays the other way).
    if (Number.isFinite(r.change)) { m.sum += energyIds.has(id) ? Math.max(0, r.change) : r.change; m.valid.add(r.start); } else m.invalid = true;
  }
  return new Map([...buckets].map(([key, b]) => {
    const value = zero();
    for (const part of PARTS) {
      const ids = src[part];
      if (!ids.length) { value[part] = ENERGY.includes(part) ? 0 : null; continue; }
      const complete = ids.every((id) => { const m = b.meters.get(id); return m && !m.invalid && m.valid.size && [...b.starts].every((s) => m.valid.has(s)); });
      value[part] = complete ? ids.reduce((s, id) => s + b.meters.get(id).sum, 0) : null;
    }
    return [key, value];
  }));
}
// Energy per calendar day (see statisticsBuckets).
const byDay = (res, src, clock) => statisticsBuckets(res, src, (start) => clock(start).key);

// What flowed in minus what flowed out: house use with the inverter's own losses. The forecast
// counts use this way always (its standby is taken off separately). null when a part is unknown.
const balanceKwh = (d) => ([d.solarKwh, d.batteryKwh, d.gridImportKwh, d.chargeKwh, d.gridExportKwh].every(Number.isFinite)
  ? Math.max(0, d.solarKwh + d.batteryKwh + d.gridImportKwh - d.chargeKwh - d.gridExportKwh) : null);
// House use: its own sensor when the owner named one, else the balance.
const houseKwh = (d, src) => (src.loadKwh.length ? d.loadKwh : balanceKwh(d));

// The usual day from hour rows: average W of house use and of sun for each hour of the day
// (0 to 23, Home Assistant's time zone). null until every hour of the day has USUAL_MIN hours
// behind it. An hour some sensor has no row for is skipped: its share would be missing.
function usualDay(res, src, clock) {
  const parts = ENERGY.filter((k) => src[k].length), ids = parts.flatMap((k) => src[k]);
  const hours = new Map();
  for (const part of parts) for (const id of src[part]) for (const r of res[id] || []) {
    if (!hours.has(r.start)) hours.set(r.start, { rows: 0, ...zero() });
    if (!Number.isFinite(r.change)) continue;
    const h = hours.get(r.start);
    h.rows++;
    h[part] += Math.max(0, r.change || 0);
  }
  const load = Array(24).fill(0), bal = Array(24).fill(0), sun = Array(24).fill(0), count = Array(24).fill(0);
  for (const [start, h] of hours) if (h.rows === ids.length) {
    const hour = clock(start).hour;
    count[hour]++;
    load[hour] += houseKwh(h, src);
    bal[hour] += balanceKwh(h);
    sun[hour] += h.solarKwh;
  }
  if (!ids.length || count.some((c) => c < USUAL_MIN)) return null;
  // kWh in one hour is the average kW over it. balanceW is house use as the forecast counts it
  // (standby included), which differs from loadW only when the owner named a load sensor.
  const avg = (kwh) => kwh.map((v, i) => Math.round(v / count[i] * 1000));
  return { loadW: avg(load), balanceW: avg(bal), solarW: avg(sun) };
}

// Everything that comes from the statistics, as plain numbers: today, both months, this month's days,
// the usual day so far and the forecast, plus what the forecast part needs (see _lookAhead). `daily` holds
// day rows, `recent` 5 minute rows that cover today (day rows lag by up to an hour), `hourly` hour
// rows of the last `usual_days` days, `forecast` the answer of energy/solar_forecast, `monthly` month rows.
function totals(src, daily, recent, hourly, forecast, clock, now, monthly = {}) {
  const at = clock(now), today = at.key;
  const month = today.slice(0, 7), last = shiftKey(month + "-01", -1).slice(0, 7);
  const days = byDay(daily, src, clock), recentDays = byDay(recent, src, clock);
  // A statistic without 5 minute rows (one imported from outside) only has its day row.
  const recentToday = recentDays.get(today);
  days.set(today, recentToday ?? days.get(today));
  // In the first hour of a day the 5 minute rows (25 hours of them) still hold all of yesterday, when the day
  // rows have no row for it yet (they are made from hour rows, written about 12 minutes past each hour).
  const yesterday = shiftKey(today, -1);
  if (at.hour === 0 && !days.has(yesterday) && recentDays.has(yesterday)) days.set(yesterday, recentDays.get(yesterday));
  // Today by the hour (hour start in ms) for the money so far, from the same rows as today's total.
  // loadKwh is the balance, as the forecast and the money so far count use; houseKwh is what Today by
  // hour draws: the house sensor's reading when there is one, else the same balance.
  // ponytail: a statistic with only day rows is missing here while others have 5 minute rows (rare,
  // imported statistics); merge its day row into the first hour if that ever matters.
  const todayHours = Object.fromEntries([...statisticsBuckets(recentToday ? recent : daily, src, (start) => hourStart(start, clock))]
    .filter(([start]) => clock(start).key === today));
  for (const h of Object.values(todayHours)) { h.houseKwh = houseKwh(h, src); h.loadKwh = balanceKwh(h); }
  // Battery round trip from the hour rows, trusted only with enough days of them (see efficiencyOf).
  // Only days where both ways are known count: a day missing a row would read as a worse battery.
  const battDays = [...byDay(hourly, src, clock).values()].filter((d) => Number.isFinite(d.batteryKwh) && Number.isFinite(d.chargeKwh));
  const kwhOf = (part) => battDays.reduce((s, d) => s + d[part], 0);
  // A day without a row adds 0 only for a part no meter counts; for any other part it makes the sum unknown.
  const unmetered = (part) => ENERGY.includes(part) && !src[part].length;
  const sum = (keys) => {
    const d = zero();
    let count = 0;
    for (const key of keys) {
      const row = days.get(key);
      if (row) count++;
      for (const k of PARTS) d[k] = sumKnown([d[k], row ? row[k] : unmetered(k) ? 0 : null]);
    }
    if (!count) for (const k of PARTS) if (!unmetered(k)) d[k] = null;
    d.loadKwh = houseKwh(d, src);
    // `none`: no numbers on record for any of the days, so its zeros are never drawn as real ones.
    d.days = count;
    if (!count) d.none = true;
    return d;
  };
  // Every day of a month (this one up to today), so a day missing from the statistics leaves its total unknown.
  const of = (prefix) => {
    const [y, m] = prefix.split("-").map(Number), length = prefix === month ? +today.slice(8) : new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
  };
  const before = [7, 6, 5, 4, 3, 2, 1].map((back) => shiftKey(today, -back));
  // This month day by day, today last (from its 5 minute rows), each at noon UTC of its day: the page
  // formats these dates in UTC, so every viewer sees the same day. The rest of a day's figures show when
  // its day is picked (see productionCard), its money on Money (see moneyHtml).
  const dayOf = (key) => ({ date: Date.parse(key) + 432e5, ...sum([key]) });
  const monthDays = Array.from({ length: +today.slice(8) }, (_, i) => dayOf(`${month}-${String(i + 1).padStart(2, "0")}`));
  // The other 11 months Production shows, day by day, with only what a picked day says (see picked),
  // rounded: the copy this browser remembers stays small.
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const pastDays = Object.fromEntries(yearKeys(month).filter((k) => k !== month).map((k) => {
    const [y, m] = k.split("-").map(Number);
    return [k, Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => {
      const d = dayOf(`${k}-${String(i + 1).padStart(2, "0")}`);
      return d.none ? { date: d.date, none: true } : { date: d.date, ...Object.fromEntries(["solarKwh", "loadKwh", "gridImportKwh", "gridExportKwh"].map((p) => [p, r2(d[p])])) };
    })];
  }));
  // The last 7 full days that have numbers: the standby.
  const full = before.filter((key) => days.has(key)).map((key) => sum([key]));
  // What flows in and out but the load sensor never sees, a day on average.
  const known = full.filter((d) => Number.isFinite(balanceKwh(d)) && Number.isFinite(d.loadKwh));
  const gap = known.reduce((s, d) => s + balanceKwh(d) - d.loadKwh, 0) / (known.length || 1);
  const sunny = full.filter((w) => w.solarKwh > 0);
  // Each value goes to the hour its time falls in, as the Energy dashboard draws it, keyed by that hour's
  // start: the repeated hour of the night the clocks go back is two hours, not one.
  const wh = {}, whHour = {};
  for (const f of Object.values(forecast || {})) for (const [time, v] of Object.entries(f.wh_hours || {})) {
    const t = Date.parse(time), c = clock(t), hour = hourStart(t, clock);
    wh[c.key] = (wh[c.key] || 0) + v;
    whHour[hour] = (whHour[hour] || 0) + v;
  }
  const usual = usualDay(hourly, src, clock);
  const tomorrow = shiftKey(today, 1);
  // The sun forecast of this hour, and the average of the next 3.
  const fcHour = (i) => whHour[hourStart(now + i * 36e5, clock)] || 0;
  const fade = { now: fcHour(0), next: (fcHour(1) + fcHour(2) + fcHour(3)) / 3 };
  // The usual day's sun and house use in kWh, by now and in all (the dashed lines on Made and Used).
  const usualBy = (w) => [w.slice(0, at.hour).reduce((a, v) => a + v, 0) + w[at.hour] * at.minute / 60, w.reduce((a, v) => a + v, 0)].map((v) => v / 1000);
  return {
    today: sum([today]), lastMonth: sum(of(last)), monthDays, pastDays, monthKey: month, // "2026-10": this month
    // Every finished month on record before this one, oldest first, as [key, kWh]: payback.
    // This month comes from the day rows (as `month`), which the month rows lag.
    months: [...byDay(monthly, src, clock)].map(([key, d]) => [key.slice(0, 7), { ...d, loadKwh: houseKwh(d, src) }])
      .filter(([key]) => key < month).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    usualToday: usual && { made: usualBy(usual.solarW), used: usualBy(usual.loadW) },
    month: sum(of(month)),
    // `tomorrow` and `usual` are null when not known: only the "wait" advice needs them.
    forecast: today in wh ? { fade, today: wh[today] / 1000, tomorrow: tomorrow in wh ? wh[tomorrow] / 1000 : null,
      usual: sunny.length ? sunny.reduce((a, w) => a + w.solarKwh, 0) / sunny.length : null } : null,
    msToMidnight: ((23 - at.hour) * 60 + 60 - at.minute) * 60e3,
    // For the forecast part only (readData leaves them out): the solar forecast by hour, the usual day,
    // the battery round trip, the inverter's standby (the owner's standby_w, else worked out from a
    // load sensor, else 0).
    todayHours, solarWh: whHour, usual,
    efficiency: efficiencyOf(kwhOf("batteryKwh"), kwhOf("chargeKwh"), battDays.length),
    standbyW: src.standbyW ?? (src.loadKwh.length && gap >= STANDBY_MIN_KWH ? (gap / 24) * 1000 : 0),
  };
}

// Everything the page shows, as one plain object: live states from `hass`, the rest from
// `stats` (see totals). `src` says which entities to read (see entitiesFrom). `fc` holds the
// forecast and what follows from it (see _lookAhead): { ahead, outlook }.
function readData(hass, src, stats, fc = {}) {
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
  // The forecast's inputs stay out: they are not drawn, and the copy this browser remembers stays small.
  const { msToMidnight, todayHours, solarWh, usual, efficiency, standbyW, socDay, fixedMonths, ...rest } = stats;
  const round = (v, to) => (Number.isFinite(v) ? Math.round(v * to) / to : null), socAt = new Map(socDay);
  const now = Date.now(), weather = weatherOf(hass), wx = weather?.state, cloud = cloudNow(fc.ahead, weather?.attributes?.cloud_coverage, now), rain = raining(fc.ahead, wx, now), snow = snowing(wx);
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
    sun: Number.isFinite(elevation) ? { elevation, rising: !!sun.attributes.rising, dawn: dawnOf(sun.attributes) }
      : { elevation: raw >= 500 ? 30 : raw >= SOLAR_NOISE_W ? SKY_LOW_DEG : -10, rising: false },
    // Grey rounded, so the redraw key does not move with every digit.
    weather: { grey: Math.round(greyOf(cloud) * 100) / 100, rain, snow, cover: coverOf(cloud, rain, snow) },
    // The moon as it is seen here: south of the equator it is lit from the other side.
    moon: { phase: moonPhase(now), south: hass.config?.latitude < 0 },
    ...rest,
    ahead: fc.ahead ?? null, outlook: fc.outlook ?? null,
    // No battery at all: its card, its place in the flow and its rows are left out.
    batt: src.battW.length || src.soc.length ? src.batt : null,
    sends: src.exportMaxKw !== 0, // export is on: Today has a column for what is sent
    payback: src.payback,
    // The bill's fixed part: its month means (see fixedAt), and its value now.
    billFixed: { months: fixedMonths ?? {}, now: typeof src.billFixed === "string" ? stateNum(hass, src.billFixed) : src.billFixed },
    // Today by the hour, oldest first: [hour start, mean charge %, then in kWh what the battery took in and
    // gave back, the sun made, the house used and the grid gave], rounded; null where the statistics have no row.
    battDay: [...new Set([...socAt.keys(), ...Object.keys(todayHours).map(Number)])].sort((a, b) => a - b).map((t) => {
      const p = socAt.get(t), h = todayHours[t];
      return [t, p === undefined ? null : round(p, 10), ...["chargeKwh", "batteryKwh", "solarKwh", "houseKwh", "gridImportKwh"].map((k) => (h ? round(h[k], 100) : null))];
    }),
    price: { buy: price(src.price.buy), sell: price(src.price.sell) },
  };
}

// Numbers for the loading skeleton. Best is what this browser showed last time: same optional
// rows and text widths, so nothing moves when the real data lands. Only the sky is taken
// fresh. Typical numbers on a first visit, in the shape the Energy settings give (`src`, once
// they answered): a battery or not, prices, export, payback, so the same pages and cards show.
const LAST_KEY = "solar-view-last";
function remembered() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY));
    if (last && last.now && last.monthDays && "batt" in last && "sends" in last) return last;
  } catch (e) { /* no storage, or an old shape: use typical numbers */ }
  return null;
}
function placeholder(hass, src) {
  const sun = hass.states[SUN], elevation = parseFloat(sun?.attributes?.elevation);
  const fresh = { sun: { elevation: Number.isFinite(elevation) ? elevation : 30, rising: !!sun?.attributes?.rising, dawn: dawnOf(sun?.attributes) }, weather: { grey: 0, rain: false, snow: false, cover: "" },
    moon: { phase: moonPhase(Date.now()), south: hass.config?.latitude < 0 } };
  const last = remembered();
  // The icon over the flow keeps last time's cloud, so it does not change shape when the data lands.
  if (last) return { ...last, ...fresh, weather: { ...fresh.weather, cover: last.weather?.cover ?? "" } };
  const day = (solarKwh, loadKwh, gridExportKwh = 0) =>
    ({ solarKwh, loadKwh, gridImportKwh: 0.2, gridExportKwh, batteryKwh: solarKwh * 0.4, chargeKwh: solarKwh * 0.45, days: 20 });
  // The sun is known while loading: by day it fills the battery, by night the battery carries the house.
  const solarW = fresh.sun.elevation > 0 ? 1500 : 0;
  // Before the Energy settings answer: a battery, export on, no prices (see _render, which waits for them).
  const battery = !src || src.battW.length > 0 || src.soc.length > 0, soc = !src || src.soc.length ? 50 : null;
  const now = new Date(Date.now()), midnight = new Date(now).setHours(0, 0, 0, 0), done = Math.floor((now - midnight) / 36e5);
  return {
    ...fresh,
    now: { solarW, loadW: 400, gridImportW: solarW || battery ? 0 : 400, gridExportW: solarW && !battery ? 1100 : 0,
      batteryChargeW: solarW && battery ? 1100 : 0, batteryDischargeW: solarW || !battery ? 0 : 400, soc },
    // A month nearly always sends something to the grid, a single day often does not.
    // Whole months on record, so no "numbers for some days" line shows while loading.
    today: day(8, 6), month: day(200, 190, 5), lastMonth: day(400, 390, 10),
    usualToday: null, monthKey: now.toISOString().slice(0, 7),
    // Whole days, not the present moment: a date that moved would redraw the skeleton on every update.
    monthDays: Array.from({ length: now.getDate() }, (_, i) => ({ ...day(12, 14), date: Date.UTC(now.getFullYear(), now.getMonth(), i + 1, 12) })),
    batt: battery ? { kwh: 10, floor: src?.batt.floor ?? BATTERY_FLOOR_SOC } : null, sends: src?.exportMaxKw !== 0, forecast: null,
    price: { buy: src?.price.buy != null ? 0.25 : null, sell: src?.price.sell != null ? 0.08 : null }, payback: src?.payback ?? null,
    // The hours done since midnight and this one so far (its figures show under the charts, with no charge mean
    // until it ends), a day the clocks change too (see battDayCard).
    battDay: Array.from({ length: done + 1 }, (_, i) => [midnight + i * 36e5, i < done ? 50 : null, 0, 0, 0.5, 0.5, 0]),
    ahead: null, outlook: null,
  };
}

// Display switches, per device (the gear): only the switches turned off are kept, as { rain: false }.
// Nothing kept, or storage that fails, means everything on. Grouped by the heading they go under.
// Only how things look: cards with nothing to show hide themselves.
const SHOW_KEY = "solar-view-show";
// A small flag beside each name, only a picture: the name is what is read out. Automatic gets a globe.
const FLAG = {
  en: '<path fill="#21468b" d="M0 0h24v16H0z"/><path stroke="#fff" stroke-width="4" d="m0 0 24 16M24 0 0 16"/><path stroke="#c8102e" stroke-width="1.5" d="m0 0 24 16M24 0 0 16"/><path fill="#fff" d="M9 0h6v16H9zM0 5h24v6H0z"/><path fill="#c8102e" d="M10.5 0h3v16h-3zM0 6.5h24v3H0z"/>',
  it: '<path fill="#009246" d="M0 0h8v16H0z"/><path fill="#fff" d="M8 0h8v16H8z"/><path fill="#ce2b37" d="M16 0h8v16h-8z"/>',
  es: '<path fill="#aa151b" d="M0 0h24v16H0z"/><path fill="#f1bf00" d="M0 4h24v8H0z"/>',
  fr: '<path fill="#002395" d="M0 0h8v16H0z"/><path fill="#fff" d="M8 0h8v16H8z"/><path fill="#ed2939" d="M16 0h8v16h-8z"/>',
  de: '<path fill="#000" d="M0 0h24v5.333H0z"/><path fill="#d00" d="M0 5.333h24v5.334H0z"/><path fill="#ffce00" d="M0 10.667h24V16H0z"/>',
  pt: '<path fill="#f00" d="M0 0h24v16H0z"/><path fill="#060" d="M0 0h9.6v16H0z"/><circle cx="9.6" cy="8" r="3.7" fill="#ff0"/><path fill="#fff" stroke="#c00" stroke-width="1" d="M7.7 5.5h3.8v3q-1.9 3-3.8 0z"/>',
  nl: '<path fill="#ae1c28" d="M0 0h24v5.333H0z"/><path fill="#fff" d="M0 5.333h24v5.334H0z"/><path fill="#21468b" d="M0 10.667h24V16H0z"/>',
  pl: '<path fill="#fff" d="M0 0h24v8H0z"/><path fill="#dc143c" d="M0 8h24v8H0z"/>',
  "": '<g fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="6.5"/><ellipse cx="12" cy="8" rx="3" ry="6.5"/><path d="M5.5 8h13"/></g>',
};
// Rich options where the browser draws them (see .language select); elsewhere the parser drops the button,
// the flags and the spans, and each option keeps its name as plain text.
const languagePicker = () => `<fieldset class="language"><legend id="language-title" data-t="language"></legend>
<select name="language" aria-labelledby="language-title"><button type="button"><selectedcontent></selectedcontent></button>${
  Object.entries({ "": "", ...LANGUAGES }).map(([code, name]) => `<option value="${code}"><svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">${FLAG[code]}</svg><span>${name}</span></option>`).join("")}</select></fieldset>`;
const SWITCHES = { showSky: ["sunHeight", "clouds", "rain"] };

// 12 or 24 hour clock: the panel's `time_format`, else the viewer's profile in Home Assistant
// (Time format: "12", "24", "system" or "language"). undefined leaves it to the language.
function hourCycle(config, locale) {
  const pick = String(config?.time_format ?? locale?.time_format ?? "language");
  if (pick === "system") return /h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle) ? "h12" : "h23";
  return pick === "12" ? "h12" : pick === "24" ? "h23" : undefined;
}

// One set of Intl formatters, kept while the language, currency, clock and time zone stay (see _render). Times
// are in Home Assistant's time zone (`zone`), as the hours they name; dates are calendar days, in UTC (see totals).
function formats(lang, currency, cycle, zone) {
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat(lang, { style: "currency", currency });
  const whole = new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }); // payback's sums
  // The currency sign after the number, whatever the language: "1.77 €".
  const after = (nf, v) => {
    const parts = nf.formatToParts(v), sign = parts.filter((p) => p.type === "currency").map((p) => p.value).join("");
    return `${parts.filter((p) => p.type !== "currency" && (p.type !== "literal" || p.value.trim())).map((p) => p.value).join("")} ${sign}`;
  };
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hourCycle: cycle, timeZone: zone }); // "alle 2:30", as spoken
  const hour = new Intl.DateTimeFormat(lang, { hour: "numeric", hourCycle: cycle, timeZone: zone }); // "15", "3 PM": the next hours' heads
  const zoned = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hourCycle: cycle, timeZone: zone, timeZoneName: "short" }); // the hour the clocks go back, twice
  const month = new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }); // "Oct", "ott": under the month columns
  const monthNarrow = new Intl.DateTimeFormat(lang, { month: "narrow", timeZone: "UTC" }); // "O": under the 12 months on a narrow card
  const monthLong = new Intl.DateTimeFormat(lang, { month: "long", timeZone: "UTC" }); // "October": the month columns' names
  const monthYear = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }); // "March 2029": paid back
  // Payback's time left, with the language's own plurals: "18 months", "4.8 years".
  const months = new Intl.NumberFormat(lang, { style: "unit", unit: "month", unitDisplay: "long" });
  const years = new Intl.NumberFormat(lang, { style: "unit", unit: "year", unitDisplay: "long", maximumFractionDigits: 1 });
  // Days arrive as noon UTC of the calendar day (see totals).
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
  const date = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  // An unknown figure (null, or anything not a finite number) reads as a dash, never 0 or NaN.
  const known = (show) => (v) => (Number.isFinite(v) ? show(v) : "—");
  return {
    num: known((v) => number.format(v)),
    kwh: known((v) => `${number.format(v)} kWh`),
    money: known((v) => after(money, v)),
    moneyWhole: known((v) => after(whole, v)),
    time: (d) => time.format(d),
    zoned: (d) => zoned.format(d),
    month: (key) => month.format(new Date(`${key}-15T12:00:00Z`)).replace(".", ""),
    monthNarrow: (key) => monthNarrow.format(new Date(`${key}-15T12:00:00Z`)),
    monthLong: (key) => monthLong.format(new Date(`${key}-15T12:00:00Z`)),
    monthYear: (key) => monthYear.format(new Date(`${key}-15T12:00:00Z`)),
    months: (n) => months.format(n),
    years: (n) => years.format(n),
    hour: (d) => hour.format(d),
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

// Icons drawn as lines: most are Lucide's (lucide.dev, ISC and MIT licences, at the end of this file) on its
// 24 x 24 grid; the moon with its phase and craters, the battery with its level, the house and the "fine"
// tick are this page's own. The sun, house, grid and battery keep their colours.
// The sky icon: the sun by day, the moon in its phase by night, each behind a cloud when it is partly
// cloudy; a cloud alone when overcast, with slanted drops when it rains.
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
// A line icon on the flow, centred on x y at s times its size; its lines stay about 2.2 wide.
// Lucide's are on a 24 x 24 grid (centre 12 12); the page's own are centred on 0 0 (shift 0).
// The house (centred on 0 0) and Lucide's plug, on the flow and at the ends of the prices' arrows.
const HOUSE = `<path d="M-1.24 -14.99Q0 -16 1.24 -14.99L14.76 -4.01Q16 -3 14.4 -3L12.6 -3Q11 -3 11 -1.4L11 12.4Q11 14 9.4 14L5.6 14Q4 14 4 12.4L4 5.6Q4 4 2.4 4L-2.4 4Q-4 4 -4 5.6L-4 12.4Q-4 14 -5.6 14L-9.4 14Q-11 14 -11 12.4L-11 -1.4Q-11 -3 -12.6 -3L-14.4 -3Q-16 -3 -14.76 -4.01Z"/>`;
const PLUG = `<path d="M12 22v-5m3-9V2m2 6a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1zM9 8V2"/>`;
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
    ${n.soc === null ? "" : `<rect class="lvl" x="-12" y="-6" width="${Math.max(2, 24 * n.soc / 100).toFixed(1)}" height="12" rx="2.5" fill="var(${battColor})" stroke="none"/>`}`, 0)}`) : ""}
  ${node(170, 146, hints.home, `${outline(170, 146, 1, "house", HOUSE, 0)}`)}
  ${node(294, 146, hints.grid, `${outline(294, 144, 1.5, `plug${gridOff}`, PLUG)}`)}
</svg><div class="flowtext" aria-hidden="true">${words(183, 86, n.solarW > 0 ? t.sun : t.noSun, n.solarW, false)}${battery ? words(46, 178, t.battery, battW) : ""}${words(170, 178, t.home, n.loadW)}${words(294, 178, t.grid, gridW)}</div></div>`;
}

const line = (body) => `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
const ADVICE_ICON = {
  go: line(`<path d="M3 6h3m11 0h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5a2.5 2.5 0 0 1 0-5"/>`),
  low: line(`<path d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>`),
  ok: `<path d="M5.5 12.6l4.3 4.3 8.7-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  wait: line(`<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`),
};
ADVICE_ICON.soon = ADVICE_ICON.later = ADVICE_ICON.short = ADVICE_ICON.fills = ADVICE_ICON.wait;
ADVICE_ICON.okLasts = ADVICE_ICON.ok;
// The adviceGo lines name one appliance each, in this order in every language: its icon instead of the
// washing machine. Found by the line's text, so the owner's own lines keep the plain "go" icon. Filled
// with a language's lines when it is first on screen (see _render).
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
// The help button's "?" in a circle, and the tab bar's icons (24 x 24, drawn with the text colour).
// The whole-page messages: the inverter not answering (a crossed out wifi), and setting up (the sun).
const OFFLINE_ICON = `<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69m8.83 2.69a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20"/>`;
const SETUP_ICON = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`;
const HELP_ICON = `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"/>`;
const TAB_ICON = {
  now: `<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>`,
  energy: `<path d="M3 3v16a2 2 0 0 0 2 2h16m-3-4V9m-5 8V5M8 17v-3"/>`,
  money: `<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48M15 6h1v4"/><path d="m6.134 14.768l.866-.5l2 3.464"/><circle cx="16" cy="8" r="6"/>`,
};

// ---- Pages: each returns the HTML of one page from c = { data, t, f, sky, loading, day, clock, pick } ----
const PAGES = ["now", "energy", "money"];

// A hint target: its sentence shows on hover, tap or focus, and is its name for screen readers.
// `role` is "img" except where the element already has one (list items).
// The colour of a sun mark, for the dot in its hint.
const SUN_DOT = "var(--sun-mark,var(--sun))";
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
// What a focused control is within its page, so a redraw can focus the same one again (see _render): a
// card's "?" by its card, a month by its key, a flow node by its key, a day or hour by its card, chart row
// and place, any other hint target by its card and place among that card's hint targets.
const cardKey = (card) => (card.dataset.pick ? `pick:${card.dataset.pick}` : `class:${card.getAttribute("class")}`);
function focusKey(page, el) {
  if (el.matches(".help[data-card]")) return { kind: "help", card: el.dataset.card };
  if (el.dataset.focusKey) return { kind: "key", key: el.dataset.focusKey }; // before the month: a month step has both
  if (el.dataset.month) return { kind: "month", month: el.dataset.month };
  const card = el.closest(".card"), scope = card || page, scopeKey = card ? cardKey(card) : null;
  if (el.dataset.i !== undefined) {
    const row = el.parentElement, sel = row.matches(".hours24") ? ".hours24" : ".week";
    return { kind: "item", scope: scopeKey, row: sel, rowIndex: [...scope.querySelectorAll(sel)].indexOf(row), index: el.dataset.i };
  }
  const index = [...scope.querySelectorAll("[data-hint]")].indexOf(el);
  return index < 0 ? null : { kind: "hint", scope: scopeKey, index };
}
function focusTarget(page, key) {
  const find = (sel, ok) => [...page.querySelectorAll(sel)].find(ok);
  if (key.kind === "help") return find(".help[data-card]", (el) => el.dataset.card === key.card);
  if (key.kind === "month") return find("[data-month]", (el) => el.dataset.month === key.month);
  if (key.kind === "key") return find("[data-focus-key]", (el) => el.dataset.focusKey === key.key);
  const scope = key.scope ? find(".card", (card) => cardKey(card) === key.scope) : page;
  if (!scope) return null;
  if (key.kind === "item") return [...(scope.querySelectorAll(key.row)[key.rowIndex]?.children || [])].find((el) => el.dataset.i === key.index);
  return scope.querySelectorAll("[data-hint]")[key.index] || null;
}
// The small drawings in the help dialogs, 30 x 16, in the colour --c: a column so far, a faded column with
// its outline, a whisker, a dashed usual day line, a range pill on its track, a piece of a ring (or a bar), a line solid and dashed, a hollow dot, a big dot with its picked label,
// and the prices' arrows, Grid to Home (left) and Home to Grid (right).
const SW = {
  solid: `<rect x="9" y="1" width="12" height="15" rx="2" stroke="none"/>`,
  ghost: `<rect x="9.75" y="1.75" width="10.5" height="13.5" rx="2" class="faded"/>`,
  range: `<path d="M15 2V14M11 2H19M11 14H19" fill="none"/>`,
  usual: `<path d="M1 8H29" fill="none" stroke-dasharray="4 3"/>`,
  pill: `<rect x="1" y="5" width="28" height="6" rx="3" class="track" stroke="none"/><rect x="9" y="5" width="13" height="6" rx="3" stroke="none"/>`,
  arc: `<path d="M3 8H27" fill="none" stroke-width="8"/>`,
  line: `<path d="M1 13L9 8L17 10L29 3" fill="none" stroke-linejoin="round"/>`,
  lineAhead: `<path d="M1 13L9 8L17 10L29 3" fill="none" stroke-dasharray="4 3"/>`,
  hollow: `<circle cx="15" cy="8" r="4" class="hollow"/>`,
  buy: `<path d="M27 8H3M9 2L3 8L9 14" fill="none"/>`,
  sell: `<path d="M3 8H27M21 2L27 8L21 14" fill="none"/>`,
  dotPick: `<circle cx="15" cy="5" r="4.5" stroke="none"/><rect x="6" y="12" width="18" height="4" rx="2" class="ink" stroke="none"/>`,
};
const sw = (shape, color) => `<svg class="sw" viewBox="0 0 30 16" style="--c:${markOf(color)}" aria-hidden="true">${SW[shape]}</svg>`;
// The weather icons of the next hours and coming days (see skyIcon), on one box.
const wxIcon = (cover) => `<svg class="wx" viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cover === null ? "" : skyIcon(false, cover, null)[1]}</svg>`;
// How to read each card: one line per mark, its drawing and its text. The battery's has its two
// example rings above the lines (see the element).
const READ = {
  battery: ["solid", "gain", "use", "range", "low"].map((k) => [`<i class="${k}"></i>`, `help${k[0].toUpperCase() + k.slice(1)}`]),
  today: [[sw("solid", "--home"), "helpTodaySolid"], [sw("ghost", "--home"), "helpTodayGhost"], [sw("range", "--home"), "helpLikely"], [sw("usual", "--ink"), "helpTodayUsual"]],
  hours: [[sw("ghost", "--sun"), "helpHoursBar"], [sw("range", "--sun"), "helpLikely"], [wxIcon("overcast"), "helpHoursSky"]],
  days: [[sw("pill", "--sun"), "helpDaysPill"], [wxIcon("partly"), "helpDaysSky"]],
  daily: [[sw("solid", "--sun"), "helpProdMonths"], [sw("line", "--sun"), "helpWeekBar"], [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpWeekPick"]],
  share: [[sw("arc", "--sun"), "helpShareSun"], [sw("arc", "--batt"), "helpShareBatt"], [sw("arc", "--grid"), "helpShareGrid"],
    [`<b class="sw-num">%</b>`, "helpShareNum"], ["", "helpShareTotal"]],
  recent: [[sw("line", "--sun"), "helpRecentBar"], [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpRecentPick"]],
  payback: [[sw("arc", "--sun"), "helpPaybackArc"], ["", "helpPaybackCost"], ["", "helpPaybackLeft"]],
  battday: [[sw("line", "--sun"), "helpBattDayBars"], [sw("lineAhead", "--sun"), "helpBattDayGhost"], [sw("line", "--batt"), "helpBattDayLine"], [sw("lineAhead", "--batt"), "helpBattDayAhead"], [sw("usual", "--low"), "helpBattDayFloor"], [sw("dotPick", "--batt"), "helpBattDayPick"]],
  table: [[sw("solid", "--batt"), "helpBalMonths"], [sw("arc", "--grid"), "helpBalSplit"], ["", "helpBalNet"]],
  prices: [[sw("buy", "--grid"), "helpPricesBuy"], [sw("sell", "--sent"), "helpPricesSell"], ["", "helpPricesRates"]],
};
// A three-quarter ring, open at the bottom like a car gauge, from 0 at the lower left to 1 at the
// lower right, solid to `frac` (a fraction of the whole ring; NaN reads as an empty ring).
const ringAt = (u, r) => {
  const a = (135 + 270 * clamp01(u)) * Math.PI / 180;
  return `${(100 + r * Math.cos(a)).toFixed(1)} ${(103 + r * Math.sin(a)).toFixed(1)}`;
};
const ringArc = (u0, u1, r, back = false) =>
  `A${r} ${r} 0 ${Math.abs(clamp01(u1) - clamp01(u0)) > 2 / 3 ? 1 : 0} ${back ? 0 : 1} ${ringAt(u1, r)}`;
function ring(frac, color, label, size) {
  const whole = `M${ringAt(0, 80)} ${ringArc(0, 1, 80)}`;
  return `<svg class="ring" viewBox="0 0 200 176" style="--c:${markOf(color)}" ${hint(label)}>
    <path class="track" d="${whole}"/>
    <path class="val" d="${whole}" pathLength="100" stroke-dasharray="${pct(clamp01(frac) || 0)} 100"/>
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
    <path class="track" d="${arc(0, 1, 80)}"/>
    ${s === u ? "" : `<path class="soon" ${c} d="${arc(Math.min(u, s), Math.max(u, s), 80)}"/>`}
    <path class="val" d="${arc(0, 1, 80)}" pathLength="100" stroke-dasharray="${Math.round(Math.min(u, s) * 1000) / 10} 100"/>
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
  return `<svg class="ring" viewBox="0 0 200 176" ${hint(label)}><path class="track" d="M${ringAt(0, 80)} ${ringArc(0, 1, 80)}"/>${marks}${ringSize(size)}</svg>`;
}
// Columns over kWh gridlines at round steps. `items` are { label, color, soFar, tonight, name, value, usual }:
// solid to `soFar`; with `tonight` ([low, mid, high], or null) a faded column with a solid outline to
// the mid and a whisker with caps from low to high; a plain number gives the faded column alone. `value`
// is the text under the column, `name` its sentence (see hint). The scale reaches the largest value drawn. `legend` ({ label, color } list)
// goes under the chart in as many equal parts, so one entry per column sits under its column. `usual` (kWh list) draws a dashed line across the
// column at each value. `none`: no numbers on record, no column.
// Across in percent and up in px, with no viewBox: the text keeps its size at any width.
const COL_H = 132, COL_TOP = 8, COL_MIN = 2; // plot height, room above it for a cap, the shortest column
const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
function columns(f, items, legend) {
  const top = Math.max(...items.map((it) => Math.max(it.soFar, [].concat(it.tonight ?? 0).at(-1) || 0, ...(it.usual ?? []))), 0.1);
  const step = STEPS.find((s) => top / s <= 4) ?? STEPS.at(-1), max = Math.ceil(top / step) * step || step;
  const base = COL_TOP + COL_H, high = base + 24, y = (v) => Math.round((COL_TOP + COL_H * (1 - clamp01(v / max))) * 10) / 10;
  const w = 100 / items.length, at = (u) => `${(w * u).toFixed(2)}%`;
  const lines = Array.from({ length: Math.round(max / step) }, (_, i) => y((i + 1) * step))
    .map((ly, i) => `<line class="grid" x1="0" x2="100%" y1="${ly}" y2="${ly}"/><text class="tick" x="0" y="${ly - 3}">${f.num((i + 1) * step)}</text>`).join("");
  // Every skeleton bar of one chart as long as its longest value.
  const values = items.map((it) => String(it.value ?? f.num(it.soFar)));
  const longest = values.reduce((a, b) => (b.length > a.length ? b : a), "");
  const cols = items.map((it, i) => {
    const r = Number.isFinite(it.tonight) ? [it.tonight, it.tonight, it.tonight] : it.tonight?.every(Number.isFinite) ? it.tonight : null;
    const solid = Math.min(y(it.soFar), base - COL_MIN), ghost = r && Math.min(y(r[1]), solid);
    const hi = r && Math.min(y(r[2]), ghost), lo = r && Math.max(y(r[0]), ghost);
    const value = values[i];
    const cap = (cy) => `<line class="cap" x1="${at(i + 0.4)}" x2="${at(i + 0.6)}" y1="${cy}" y2="${cy}"/>`;
    // The skeleton bar beside the column, not in it: a long value must not widen the column's box.
    return `${skBar(at(i + 0.5), base + 18, longest, 12.5)}<g class="col" style="--c:${markOf(it.color)}" ${hint(it.name ?? it.label)}>
      <rect class="hit" x="${at(i)}" y="0" width="${at(1)}" height="${high}" rx="8" fill="transparent"/>
      ${r ? `<rect class="ghost" x="${at(i + 0.25)}" y="${ghost}" width="${at(0.5)}" height="${(base - ghost).toFixed(1)}" rx="3"/>` : ""}
      ${it.none || !Number.isFinite(it.soFar) ? "" : `<rect class="val" x="${at(i + 0.25)}" y="${solid}" width="${at(0.5)}" height="${(base - solid).toFixed(1)}" rx="3"/>`}
      ${(it.usual ?? []).map((v) => `<line class="usual" x1="${at(i + 0.12)}" x2="${at(i + 0.88)}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}
      ${r && Array.isArray(it.tonight) ? `<line class="whisker" x1="${at(i + 0.5)}" x2="${at(i + 0.5)}" y1="${hi}" y2="${lo}"/>${cap(hi)}${cap(lo)}` : ""}
      <text class="v" x="${at(i + 0.5)}" y="${base + 18}" text-anchor="middle">${value}</text>    </g>`;
  }).join("");
  return `<svg class="cols" width="100%" height="${high}" role="group">${lines}<line class="axis" x1="0" x2="100%" y1="${base}" y2="${base}"/>${cols}</svg>
    ${legend?.length ? legendHtml(legend) : ""}`;
}
const legendHtml = (list) => `<ul class="legend" style="--n:${list.length}">${list.map((l) =>
  `<li><i style="--c:${markOf(l.color)}"></i><span>${l.label}</span></li>`).join("")}</ul>`;

function nowHtml({ data, t, f, sky, loading, day, clock }) {
  const n = data.now, today = data.today;
  const charging = n.batteryChargeW > MIN_FLOW_W, discharging = n.batteryDischargeW > MIN_FLOW_W;
  const exporting = n.gridExportW > EXPORT_W;
  const names = sources(n), src = names.map((s) => t.src[s]);
  // The headline names one source; with the grid as one of two, the line under it names the other.
  const sentence = names.length > 1 && !names.includes("grid") ? t.sunBatt : say(t.runOn, { a: src[0] });
  const second = names.length > 1 && names.includes("grid") ? names[1] : null;
  const sub = second ? t[{ sun: "subSun", battery: "subBattery", grid: "subGrid" }[second]]
    : n.gridImportW > IMPORT_W ? t.subGrid
    : exporting ? t.subExport
    : charging ? t.subCharge
    // The battery already in the headline needs no line of its own.
    : discharging && !names.includes("battery") ? t.subBattery : "";
  const batt = data.batt;
  const word = n.soc === null ? "" : batteryWord(n.soc, batt ? batt.floor : 0);
  const battColor = isLow(word) ? "--low" : "--batt";
  const stored = batt?.kwh ? f.kwh(n.soc / 100 * batt.kwh) : "";
  const sunCharging = charging && !gridCharging(n);
  const now = Date.now();
  const lastsH = batt && data.outlook ? outlookLastsH(n, batt, data.outlook.lastsUntil, now) : 0;
  // Rounded to the half hour: the estimate is rough, and the text stays still between updates.
  const until = lastsH && lastsH !== Infinity ? f.time(new Date(Math.round((now + lastsH * 36e5) / 18e5) * 18e5)) : "";
  const battW = Math.round(n.batteryChargeW || n.batteryDischargeW);
  const battState = charging ? (sunCharging ? t.charging : t.chargingGrid)
    : lastsH === Infinity ? t.untilSun
    // One o'clock takes the singular in some languages ("all'1:30", not "alle 1:30"): untilOne, where a language has it.
    : lastsH ? say((/^0?1\D/.test(until) && t.untilOne) || t.until, { t: until })
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
  // Evening: the sun is setting and low enough for the dusk colours, or gone.
  const evening = !daytime || (!data.sun.rising && data.sun.elevation < SKY_DAY_DEG);
  const kind = outlookAdvice(advice(n, data.forecast, daytime, word), data.outlook, word, sunCharging, daytime, evening, lastsH);
  const lines = advicePool(t, kind, word, sunCharging, daytime);
  // One line per calendar day, so it stays put between redraws and changes tomorrow.
  const adviceText = lines[day % lines.length];
  // The battery in an hour, from the outlook's three runs. They start from the floor at the lowest, so
  // a reading under it moves them by the same amount. Its likely range only from the sensor's forecast:
  // the page's own has one value.
  const p = Math.round(n.soc), ahead = n.soc !== null && batt?.kwh && data.outlook?.inHour;
  const hour = ahead && ahead.map((v) => v + n.soc - Math.min(100, Math.max(n.soc, batt.floor)));
  const soon = hour && Math.abs(hour[1] - n.soc) >= SOON_PCT ? hour[1] : null;
  const range = soon !== null && data.ahead?.from === "sensor" && hour[2] - hour[0] >= SOON_PCT ? [hour[0], hour[2]] : null;
  const ringName = soon === null ? say(stored ? t.hRing : t.hRingNoSize, { p, k: stored })
    : say(range ? t.hRingSoon : t.hRingSoonMid, { p, a: Math.round(soon), b: Math.round(range?.[0]), c: Math.round(range?.[1]) });
  return `
    <header><h1${loading ? ` data-wait="${t.loading}"` : ""}>${sentence}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</header>
    <div class="flowbox">${flowSvg(n, sky, night, t, sub ? `${sentence}. ${sub}` : sentence, hints, !!batt, battColor, data.weather.cover, data.moon)}</div>
    <section class="card advice" data-kind="${kind}" aria-label="${t.adviceTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${(kind === "go" && GO_ICON.get(adviceText)) || ADVICE_ICON[kind]}</svg></span>
      <p>${esc(adviceText)}</p>
    </section>
    ${n.soc === null ? "" : `<section class="card battery">
      <h2>${t.battery}</h2>
      ${helpButton(t, "battery")}
      <div class="ring-box">
        ${battRing(n.soc, soon, range, battColor, ringName, batt?.kwh ? f.kwh(batt.kwh) : "")}
        <div class="ring-mid" aria-hidden="true">${big(p)}</div>
      </div>
      <div class="batt-say"><div class="batt-word"><i style="--c:var(${battColor})"></i><span>${t[word]}</span></div><p>${battState}</p></div>
    </section>`}`;
}

// Round numbers for what is still to come: one decimal under 10, whole above.
const near = (f, v) => f.num(v >= 10 ? Math.round(v) : v);
// The weather words of an icon (see coverOf): "" is clear.
const wxWord = (t, cover) => ({ "": t.wxSunny, partly: t.wxPartly, overcast: t.wxCloudy, rain: t.wxRain }[cover]);

// ENERGY: today, hour by hour, next hours, coming days, this month's days.
// Today's columns: made, used, from sun, from battery, from grid, and sent while export is on. With the
// outlook each has its faded by-tonight column and whisker; with a usual day Made and Used carry its
// dashed lines (by now, and in all).
function todayCard({ data, t, f, clock }) {
  const d = data.today, o = data.outlook, tn = o?.tonight, u = data.usualToday;
  // No numbers on record today (the inverter or the connection down): only that, no zeros.
  if (d.none) return `<section class="card today share">
      <h2>${t.todayNumbers}</h2>
      <p>${cap(t.noData)}</p>
    </section>`;
  // Nothing to compare today with (no forecast, no usual day): the ring of where the power came from, and
  // what the sun made and sent under it.
  if (!o?.tonight?.made && !u) return `<section class="card today share">
      <h2>${t.todayNumbers}</h2>${helpButton(t, "share")}
      ${shareRing(data, t, f)}
    </section>`;
  const gridWord = !Number.isFinite(d.gridImportKwh) ? "" : d.gridImportKwh < 0.05 ? t.nothing : d.gridImportKwh < 1 ? t.almostNothing : "";
  // One column: `short` names it beside its forecast, `long` (the old row's words) without one.
  // A range whose ends read the same (the page's own forecast has low = mid = high) is one value: the
  // faded column without a whisker, and no "likely" in its name.
  const column = (short, long, color, soFar, tonight, word, usual) => {
    const r = tonight?.every(Number.isFinite) ? tonight : null, one = r && near(f, r[0]) === near(f, r[2]);
    const a = f.kwh(soFar) + (word ? ` (${word})` : "");
    const name = r ? say(one ? t.hColumnMid : t.hColumn, { l: short, a, b: near(f, r[1]), c: near(f, r[0]), d: near(f, r[2]) })
      : `${long}: ${f.kwh(soFar)}${word ? `, ${word}` : ""}`;
    return { label: short, color, soFar, none: !Number.isFinite(soFar), tonight: one ? r[1] : r, usual,
      name: usual ? `${name}. ${say(t.hUsual, { a: near(f, usual[0]), b: near(f, usual[1]) })}` : name,
      value: r ? say(t.soFarTonight, { a: near(f, soFar), b: near(f, r[1]) }) : near(f, soFar) };
  };
  // Straight from the sun is what is left of the use: unknown when any part of it is.
  const fromBatt = data.batt ? (Number.isFinite(d.batteryKwh) ? Math.max(0, d.batteryKwh) : null) : 0;
  const direct = [d.loadKwh, fromBatt, d.gridImportKwh].every(Number.isFinite) ? Math.max(0, d.loadKwh - fromBatt - d.gridImportKwh) : null;
  const items = [
    column(t.colMade, t.made, "--sun", d.solarKwh, tn?.made, "", u?.made),
    column(t.colUsed, t.used, "--home", d.loadKwh, tn?.used, "", u?.used),
    column(t.colSun, t.takenSun, "--sun", direct, tn?.fromSun),
    ...(data.batt ? [column(t.colBatt, t.takenBatt, "--batt", d.batteryKwh, tn?.fromBatt)] : []),
    column(t.colGrid, t.taken, "--grid", d.gridImportKwh, tn?.fromGrid, gridWord),
    ...(data.sends ? [column(t.colSent, t.sent, "--sent", d.gridExportKwh, tn?.sent)] : []),
  ];
  const best = o?.best && `<p class="best">${say(clock(o.best.from).key === clock(Date.now()).key ? t.bestTime : t.bestTomorrow,
    { a: f.time(new Date(o.best.from)), b: f.time(new Date(o.best.to)) })}</p>`;
  return `<section class="card today">
      <h2><span>${t.todayNumbers}</span> <span class="num">kWh</span></h2>${helpButton(t, "today")}
      ${columns(f, items, items)}
      ${best || ""}
    </section>`;
}

// The present hour and the 5 after it, found by t: the hour, its cloud or rain (only the sensor knows
// them), a faded sun bar with its likely range (none from the page's own forecast, whose ranges are
// flat), all on one scale, and the likely sun in kW. None without a forecast.
function nextHoursCard({ data, t, f }) {
  const a = data.ahead, first = hourIndex(a, Date.now());
  const hours = first < 0 ? [] : a.hours.slice(first, first + 6);
  if (hours.length < 6) return "";
  const sky = a.from === "sensor", top = Math.max(...hours.map((h) => h.sun[2]), 0.1), at = (v) => Math.round(clamp01(v / top) * 1000) / 10;
  const items = hours.map((h, i) => {
    const [lo, mid, hi] = h.sun, one = !sky || f.num(lo) === f.num(hi);
    const cover = sky ? coverOf(h.cloud, h.rain > RAIN_MM) : "", w = cover && wxWord(t, cover);
    const name = say(one ? t.hHour : t.hHourRange, { h: f.time(new Date(h.t)), w: w ? `${w}, ` : "", k: f.num(mid), a: f.num(lo), b: f.num(hi) });
    // A clear hour keeps an empty icon, so the bars stay level.
    return `<li ${hint(name, "")} style="--c:${SUN_DOT}" data-at="${h.t}"><span>${i ? f.hour(new Date(h.t)) : t.hourNow}</span>${sky ? wxIcon(cover ? (cover === "partly" ? "overcast" : cover) : null) : ""}
      <span class="bar"><i style="--h:${at(mid)}%"></i>${one ? "" : `<b style="--lo:${at(lo)}%;--hi:${at(hi)}%"></b>`}</span><span class="num">${f.num(mid)}</span></li>`;
  }).join("");
  return `<section class="card next">
      <h2><span>${t.nextHours}</span> <span class="num">kW</span></h2>${helpButton(t, "hours")}
      <ul class="hours">${items}</ul>
    </section>`;
}

// Up to 7 days from tomorrow, from the sensor only: the day, its weather (the day's `cloud` by the sky's
// thresholds, rain from RAIN_DAY_MM; none when the sensor gives no cloud), and a pill from low to high on
// one track from 0 to the highest high, with the two figures at its ends.
function comingDaysCard({ data, t, f, clock }) {
  const a = data.ahead, today = clock(Date.now()).key;
  const days = a?.from !== "sensor" ? [] : a.days.filter((d) => d.d > today && d.sun?.every(Number.isFinite)).slice(0, 7);
  if (!days.length) return "";
  const top = Math.max(...days.map((d) => d.sun[2]), 0.1), at = (v) => Math.round(clamp01(v / top) * 1000) / 10;
  const rows = days.map((d) => {
    const cover = Number.isFinite(d.cloud) ? coverOf(d.cloud, d.rain >= RAIN_DAY_MM) : null;
    const date = new Date(Date.parse(d.d) + 432e5), [lo, , hi] = d.sun;
    const w = cover === null ? "" : `${wxWord(t, cover)}, `;
    const name = say(near(f, lo) === near(f, hi) ? t.hDayAheadMid : t.hDayAhead, { d: f.date(date), w, a: near(f, lo), b: near(f, hi) });
    return `<li ${hint(name, "")} style="--c:${SUN_DOT}"><span>${f.weekday(date)}</span>${wxIcon(cover)}<span class="num lo">${near(f, lo)}</span>
      <span class="track"><i style="--a:${at(lo)}%;--b:${at(hi)}%"></i></span><span class="num">${near(f, hi)}</span></li>`;
  }).join("");
  return `<section class="card coming">
      <h2><span>${t.comingDays}</span> <span class="num">kWh</span></h2>${helpButton(t, "days")}
      <ul class="days">${rows}</ul>
    </section>`;
}

// A line chart's scale up to `top`, on a box 0 to 100 high stretched to its place (see .socline): its top
// at a round step, the gridlines at each step, and their values beside them (`fmt`), in HTML so they keep
// their size.
// Down to `bottom` below 0 when a value is (money: a day that cost more than it brought), else from 0.
function lineGrid(top, fmt, bottom = 0) {
  const step = STEPS.find((s) => (top - bottom) / s <= 2) ?? STEPS.at(-1), max = Math.ceil(top / step) * step || step;
  const min = Math.floor(bottom / step) * step, span = max - min;
  const at = Array.from({ length: Math.round(span / step) }, (_, i) => min + (i + 1) * step), pos = (v) => ((v - min) / span) * 100;
  return { min, max, span, lines: at.map((v) => `<line class="grid" x1="0" x2="100" y1="${(100 - pos(v)).toFixed(2)}" y2="${(100 - pos(v)).toFixed(2)}"/>`).join(""),
    ticks: at.map((v) => `<span class="tick" style="bottom:${pos(v).toFixed(2)}%">${fmt(v)}</span>`).join("") };
}
// Figures under a chart, each a label over its value, centred: `caption` (the picked hour, day or month)
// over them, then each [label, value, colour, below 0] (null: left out), the label with a dot in its colour.
function readout(caption, items) {
  const rows = items.filter(Boolean);
  return `<div class="readout">${caption ? `<div class="period">${caption}</div>` : ""}<dl data-n="${rows.length}">${rows.map(([label, value, color, neg]) =>
    `<div${color ? ` style="--c:${markOf(color)}"` : ""}><dt>${color ? "<i></i>" : ""}<span>${label}</span></dt><dd${neg ? ' class="neg"' : ""}>${value}</dd></div>`).join("")}</dl></div>`;
}
// A picked day's figures, `lead` over them (see dayLine): what the sun made, the house used and the grid
// gave, how much was home made, and what was sent when there was any (or when that is unknown). Without
// numbers on record, only that; an unknown figure as a dash.
function picked(t, f, x, lead) {
  if (x.none) return readout(lead, [[t.noData, "—"]]);
  const share = ownShare(x);
  return readout(lead, [
    [t.sun, f.kwh(x.solarKwh), "--sun"],
    [t.homeUse, f.kwh(x.loadKwh), "--home"],
    [t.colGrid, f.kwh(x.gridImportKwh), "--grid"],
    [t.selfSupplied, share === null ? "—" : `${f.num(pct(share))}%`, "--batt"],
    x.gridExportKwh == null || x.gridExportKwh >= SENT_KWH ? [t.sent, f.kwh(x.gridExportKwh), "--sent"] : null,
  ]);
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
function dayLine(t, f, key, list, v, name, line, at, { live = true, between = "" } = {}) {
  const [y, m] = key.split("-").map(Number), last = list.length - 1, n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // A pick kept from a longer month (the 31st, now the 1st of the next) falls back to the last day.
  if (!(at >= 0 && at <= last)) at = last;
  const vals = Array.from({ length: n }, (_, i) => (list[i] ? v(list[i]) : null));
  const g = lineGrid(Math.max(...vals.map((x) => x ?? 0), 0.01), f.num, Math.min(...vals.map((x) => x ?? 0), 0)), h = (x) => ((x - g.min) / g.span) * 100;
  const d = vals.map((x, i) => (x === null ? "" : `${i && vals[i - 1] !== null ? "L" : "M"}${(((i + 0.5) / n) * 100).toFixed(2)} ${(100 - h(x)).toFixed(2)}`)).join("");
  const days = vals.map((x, i) => {
    const day = list[i], cls = [i % 3 && "quiet", !day ? "future" : x === null ? "none" : live && i === last && "today"].filter(Boolean).join(" ");
    return `<li ${day ? hint(name(day, x), "") : ""} style="--c:${SUN_DOT}" data-i="${i}"${cls ? ` class="${cls}"` : ""}${i === at ? ' aria-current="true"' : ""}><span class="col">${x === null ? "" : `<i style="--v:${h(x).toFixed(1)}%"></i>`}</span><span class="date">${i + 1}</span></li>`;
  }).join("");
  const lines = list.map((day, i) => line(day, v(day), `<b>${cap(live && i === last ? t.todaySoFar : say(t.weekOn, { d: f.date(new Date(day.date)) }))}</b>`));
  return `<div class="dayline">
        <div class="area"><svg class="socline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${g.lines}<line class="axis" x1="0" x2="100" y1="100" y2="100"/><path class="series" style="--c:${SUN_DOT}" d="${d}"/></svg>${g.ticks}</div>
        <ol class="week" style="--n:${n}">${days}</ol>
      </div>${between}
      <div class="stepped">${steps(t, "Day", at, last)}<div class="picked" aria-live="polite" aria-atomic="true">${lines.map((l, i) => `<div class="day" data-i="${i}"${i === at ? "" : " hidden"}>${l}</div>`).join("")}</div></div>`;
}
// A month's total between its charts (see readout): `caption` over its one figure.
const monthTotal = (caption, label, value, color) => `<div class="month-total">${readout(caption, [[label, value, color]])}</div>`;
// Twelve months as buttons, January to December (see yearKeys), each with a bar of `v(key)` (null: none
// on record, no bar) on one scale from 0 up, or with `both` up or down from a zero line by its sign (a
// value below 0 in the low colour): the line sits as high as the largest value below 0 needs, so the
// largest above and below together fill the bar. Under each its short name, and its year when that is last year's, or
// "so far" for this month; on a narrow card one letter and two digits ("O", "’25"). Hovering one shows its hint `name(key, v)`; a click picks it (see _wireWeek).
function monthPicker(t, f, cur, at, v, name, color, both = false) {
  const keys = yearKeys(cur), vals = keys.map(v);
  const up = Math.max(0, ...vals.map((x) => x ?? 0)), down = both ? Math.max(0, ...vals.map((x) => -(x ?? 0))) : 0;
  const top = Math.max(up + down, 1e-9);
  return `<ol class="year${both ? " both" : ""}"${both ? ` style="--zero:${((down / top) * 100).toFixed(1)}%"` : ""}>${keys.map((k, i) => {
    const x = vals[i], c = markOf(x < 0 ? "--low" : color);
    return `<li><button type="button" data-month="${k}" aria-pressed="${k === at}" style="--c:${c}" ${hint(name(k, x), "")}><span class="bar">${x === null ? ""
      : `<i${x < 0 ? ' class="neg"' : ""} style="--v:${((Math.abs(x) / top) * 100).toFixed(1)}%"></i>`}</span><span><span class="wide">${f.month(k)}</span><span class="narrow">${f.monthNarrow(k)}</span></span><small>${
      k === cur ? t.soFar : k.slice(0, 4) !== cur.slice(0, 4) ? `<span class="wide">${k.slice(0, 4)}</span><span class="narrow">’${k.slice(2, 4)}</span>` : ""}</small></button></li>`;
  }).join("")}</ol>`;
}
// Production: what the sun made each of the 12 months (see monthPicker), the picked month's total under
// them, then its days (see dayLine). This month at first.
function productionCard({ data, t, f, pick }) {
  const cur = data.monthKey, at = yearKeys(cur).includes(pick?.dailyMonth) ? pick.dailyMonth : cur;
  const daysOf = (k) => (k === cur ? data.monthDays : data.pastDays?.[k]) ?? [];
  const solar = (d) => (d.none ? null : d.solarKwh);
  // A month with a day missing has no total: a part of it would read as the whole.
  const total = (k) => { const v = daysOf(k).map(solar); return v.length ? sumKnown(v) : null; };
  const named = (k) => (k === cur ? say(t.monthSoFar, { m: f.monthYear(k) }) : f.monthYear(k));
  const sum = total(at);
  return `<section class="card daily" data-pick="daily">
      <h2><span>${t.production}</span> <span class="num">kWh</span></h2>${helpButton(t, "daily")}
      <h3 class="chart-title">${t.prodMonths}</h3>
      ${monthPicker(t, f, cur, at, total, (k, v) => `${named(k)}: ${v === null ? t.noData : f.kwh(v >= 10 ? Math.round(v) : v)}`, "--sun")}
      <div class="stepped total">${monthSteps(t, cur, at, (k) => cap(named(k)))}${monthTotal(cap(named(at)), t.prodMonths, f.kwh(sum >= 10 ? Math.round(sum) : sum), "--sun")}</div>
      <h3 class="chart-title"><span>${t.daily}</span> <span class="num">${cap(f.monthYear(at))}</span></h3>
      ${dayLine(t, f, at, daysOf(at), solar,
        (d, v) => (v === null ? `${f.date(new Date(d.date))}: ${t.noData}` : say(t.hDay, { d: f.date(new Date(d.date)), k: f.kwh(v) })), (d, v, lead) => picked(t, f, d, lead), pick?.daily, { live: at === cur })}
    </section>`;
}

// Today hour by hour, midnight to midnight, on two charts with one timeline (see lineGrid), each under its
// title and unit. Above, with a battery and a charge reading, its mean charge in percent (solid, broken where
// an hour has no row), where the mid run takes it until midnight (dashes), and the floor (red dashes). Below,
// a line each for what the sun made, what the house used and what the grid gave, a point an hour; solid for
// the hours done, dashed from there on, this hour with it, as the outlook's mid run expects them. What is still to come is shaded.
// One hour is picked (this one at first, see dayLine), a dot on each line, its figures under the charts.
// Nothing is drawn for an hour without a row; its sentence says so. Hidden in the first hour of a day with
// no row yet.
function battDayCard({ data, t, f, clock, pick }) {
  const b = data.batt, n = data.now, rows = data.battDay ?? [];
  // Now to the 5 minutes, so the page is not redrawn every few seconds for a line that barely moves.
  const H = 36e5, now = Math.floor(Date.now() / 3e5) * 3e5;
  // The day's real hours, midnight to midnight: 23 the day the clocks go forward, 25 the day they go back.
  const today = clock(now).key, hours = [];
  let day0 = hourStart(now, clock);
  while (clock(day0 - H).key === today) day0 -= H;
  for (let ms = day0; clock(ms).key === today; ms += H) hours.push(ms);
  const N = hours.length;
  if (!rows.length && now - day0 < H) return "";
  const x = (ms) => (clamp01((ms - day0) / (N * H)) * 100).toFixed(2), y = (p) => (100 - Math.min(100, Math.max(0, p))).toFixed(2);
  const path = (pts) => pts.map(([ms, p], i) => `${i ? "L" : "M"}${x(ms)} ${y(p)}`).join("");
  const soc = !!b && n.soc !== null;
  // Runs of charge points no more than an hour and a half apart: a missing hour breaks the line.
  const pts = soc ? [...rows.filter((r) => r[1] !== null).map(([ms, p]) => [ms + H / 2, p]), [now, n.soc]] : [];
  const runs = pts.reduce((out, pt, i) => { if (!i || pt[0] - pts[i - 1][0] > 1.5 * H) out.push([]); out.at(-1).push(pt); return out; }, []);
  // The outlook's runs start from the floor at the lowest: a reading under it moves them by as much, as on the ring.
  const shift = soc ? n.soc - Math.min(100, Math.max(n.soc, b.floor)) : 0;
  const ahead = soc ? (data.outlook?.socAhead ?? []).map(([ms, p]) => [ms, p + shift]) : [];
  const was = new Map(rows.map((r) => [r[0], r])), will = new Map(ahead.map(([ms, p]) => [ms - H, p]));
  const expect = new Map((data.outlook?.hoursAhead ?? []).map((e) => [e[0], e]));
  // Each hour's [made, used, grid] in kWh, and whether it is the outlook's: an hour done from its row, this
  // one its row so far plus the outlook's rest, the next ones the outlook's; null where there is neither.
  const SERIES = [["--sun", 4, 1], ["--home", 5, 4], ["--grid", 6, 3]]; // colour, place in a row, in an outlook hour
  const hourly = hours.map((ms) => {
    const r = was.get(ms) ?? null, e = ms + H > now ? expect.get(ms) : null;
    return r || e ? { est: !!e, v: SERIES.map(([, ri, ei]) => sumKnown([r ? r[ri] : 0, e ? e[ei] : 0])) } : null;
  });
  const kwh = lineGrid(Math.max(...hourly.map((h) => (h ? Math.max(...h.v) : 0)), 0.1), f.num);
  // Across its hour (0 to 1): the middle, but the hour in progress on record alone (no outlook for its rest)
  // at now, as the charge line's dot, its figures so far.
  const across = (i) => (!hourly[i]?.est && hours[i] <= now && now < hours[i] + H ? (now - hours[i]) / H : 0.5);
  const cx = (i) => ((i + across(i)) / N) * 100;
  // Solid through the hours done, dashed from the last of them through the outlook's; a gap breaks both, and
  // each line breaks at its own unknown hours (an hour alone between two gaps is only its dot).
  const known = (h, k) => !!h && Number.isFinite(h.v[k]);
  const lineOf = (k, dashed) => hourly.map((h, i) => {
    const use = known(h, k) && (dashed ? h.est || hourly[i + 1]?.est : !h.est);
    return use ? `${known(hourly[i - 1], k) && (dashed ? true : !hourly[i - 1].est) ? "L" : "M"}${cx(i).toFixed(2)} ${y(h.v[k] / kwh.max * 100)}` : "";
  }).join("").replace(/^L/, "M");
  const series = SERIES.map(([color], k) => `<path class="series" style="--c:${markOf(color)}" d="${lineOf(k, false)}"/><path class="series later" style="--c:${markOf(color)}" d="${lineOf(k, true)}"/>`).join("");
  // Where the picked hour's dot sits on the charge line: the hour's mean in its middle, this hour's reading
  // now, an hour ahead's end at its end. [across the hour 0 to 1, %], or null.
  const socDot = (i) => {
    const ms = hours[i], r = was.get(ms), p = will.get(ms);
    if (!soc) return null;
    if (ms <= now && now < ms + H) return [(now - ms) / H, n.soc];
    return r?.[1] != null ? [0.5, r[1]] : p !== undefined ? [1, p] : null;
  };
  // The hour the clocks go back reads the same twice: both then name their offset.
  const labels = hours.map((ms) => f.time(new Date(ms)));
  const said = hours.map((ms, i) => {
    const r = was.get(ms), p = will.get(ms), e = expect.get(ms), h = labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i]) ? f.zoned(new Date(ms)) : labels[i];
    // One sentence an hour: the energy, then the battery's charge (its mean for an hour done, what the outlook
    // expects at the end of one ahead), either alone where the other is missing. The grid's 0 is "nothing".
    const one = (energy, batt, battOnly, v, pc) => {
      const g = { h, a: v && f.kwh(v[0]), b: v && f.kwh(v[1]), c: v && (Number.isFinite(v[2]) && v[2] < 0.05 ? t.nothing : f.kwh(v[2])), p: pc };
      return v ? say(pc == null ? energy : batt, g) + "." : pc == null ? "" : say(battOnly, g) + ".";
    };
    const pc = soc && r?.[1] != null ? Math.round(r[1]) : null;
    const past = one(t.hHourKwh, t.hHourBatt, t.hBattPast, r && [r[4], r[5], r[6]], pc);
    const coming = one(t.hHourAhead, t.hHourAheadBatt, t.hBattAhead, e && [e[1], e[4], e[3]], p === undefined ? null : Math.round(p));
    // An hour on record also as figures under the charts (an unknown one as a dash), this one's marked "so
    // far"; one ahead keeps its sentence.
    const figures = r && [
      [t.sun, f.kwh(r[4]), "--sun"],
      [t.homeUse, f.kwh(r[5]), "--home"],
      [t.colGrid, f.kwh(r[6]), "--grid"],
      pc == null ? null : [t.battAvg, `${f.num(pc)}%`, "--batt"],
    ].filter(Boolean);
    // No row 10 minutes into an hour (5 minute rows come every 5): nothing on record for it.
    return [h, past || (ms + 6e5 < now ? `${h}: ${t.noData}` : coming),
      figures?.length ? readout(ms <= now && now < ms + H ? `${h} · ${t.soFar}` : h, figures) : ""];
  });
  // The same hours over each chart, each with the hour's sentence as its hint: hovering either shows the
  // hour on both, a tap picks it on both (see _wireWeek). Only the top chart's row takes focus. A pick kept
  // from a longer day falls back to this hour.
  const at = pick?.battday >= 0 && pick.battday < N ? pick.battday : hours.indexOf(hourStart(now, clock));
  const dot = (color, v, across = 0.5) => `<i style="--c:${markOf(color)};--v:${Math.min(100, Math.max(0, v)).toFixed(1)}%;--x:${across.toFixed(2)}"></i>`;
  const cells = (named, dots) => said.map(([, name], i) => `<li${name ? (named ? ` ${hint(name, "")}` : ` data-hint="${name}"`) : ""} data-i="${i}"${name ? "" : ' class="future"'}${i === at ? ' aria-current="true"' : ""}>${dots(i)}</li>`).join("");
  // What is still to come shaded, now a line across both charts, named once over the top one (kept inside the card near midnight).
  const later = `<rect class="later" x="${x(now)}" y="0" width="${(100 - x(now)).toFixed(2)}" height="100"/><line class="now-line" x1="${x(now)}" x2="${x(now)}" y1="0" y2="100"/>`;
  const nowLabel = `<span class="now-label${+x(now) < 8 ? " start" : +x(now) > 92 ? " end" : ""}" style="--x:${x(now)}%">${t.nowMark}</span>`;
  const charge = lineGrid(100, (v) => `${v}%`);
  const legend = legendHtml([{ label: t.colMade, color: "--sun" }, { label: t.colUsed, color: "--home" }, { label: t.colGrid, color: "--grid" }]);
  const title = (name, unit) => `<h3 class="chart-title"><span>${name}</span> <span class="num">${unit}</span></h3>`;
  return `<section class="card battday" data-pick="battday">
      <h2>${t.battDay}</h2>${helpButton(t, "battday")}
      ${soc ? `${title(t.battCharge, "%")}<div class="plot charge">${nowLabel}
        <svg class="socline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${later}${charge.lines}<line class="floor" x1="0" x2="100" y1="${y(b.floor)}" y2="${y(b.floor)}"/>
          ${runs.map((run) => `<path class="past" d="${path(run)}"/>`).join("")}
          ${ahead.length ? `<path class="ahead" d="${path([[now, n.soc], ...ahead])}"/>` : ""}
          <line class="axis" x1="0" x2="100" y1="100" y2="100"/>
        </svg>${charge.ticks}<span class="floor-label" style="bottom:${b.floor}%">${say(t.battFloor, { p: b.floor })}</span>
        <ol class="hours24" style="--n:${N}">${cells(true, (i) => { const d = socDot(i); return d ? dot("--batt", d[1], d[0]) : ""; })}</ol>
      </div>` : ""}
      ${title(t.battEnergy, "kWh")}<div class="plot">${soc ? "" : nowLabel}
        <svg class="socline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${later}${kwh.lines}<line class="axis" x1="0" x2="100" y1="100" y2="100"/>${series}
        </svg>${kwh.ticks}
        <ol class="hours24" style="--n:${N}"${soc ? ' aria-hidden="true"' : ""}>${cells(!soc, (i) => SERIES.map(([color], k) => (known(hourly[i], k) ? dot(color, hourly[i].v[k] / kwh.max * 100, across(i)) : "")).join(""))}</ol>
      </div>
      <div class="ticks">${[0, 8, 16].map((h) => hours.findIndex((ms) => clock(ms).hour === h)).filter((i) => i >= 0).map((i) => `<span style="left:${(i / N) * 100}%">${f.hour(new Date(hours[i]))}</span>`).join("")}<span style="right:0">${f.time(new Date(day0 + N * H - 6e4))}</span></div>
      ${legend}
      ${rows.length ? "" : `<p class="note">${cap(t.noData)}</p>`}
      <div class="stepped">${steps(t, "Hour", at, said.findLastIndex(([, name]) => name))}<div class="picked" aria-live="polite" aria-atomic="true">${said.map(([h, name, figures], i) => `<div class="day" data-i="${i}"${i === at ? "" : " hidden"}>${figures || (name && name.replace(h, `<b>${h}</b>`))}</div>`).join("")}</div></div>
    </section>`;
}

function energyHtml(c) {
  return `
    <h1 class="title">${c.t.tabEnergy}</h1>
    ${todayCard(c)}${battDayCard(c)}${nextHoursCard(c)}${comingDaysCard(c)}${productionCard(c)}`;
}

// Where today's use came from, round a ring: straight from the sun, then the battery, then the grid, each
// named beside its part; the home made share in the middle, and under it each part's figure (plus what was
// sent, when something was). A part unknown leaves a plain ring (its figures as dashes), the share still in
// the middle when use and the grid are known.
// On Energy with no prediction for today at all.
function shareRing(data, t, f) {
  const d = data.today, share = ownShare(d);
  if (Number.isFinite(d.loadKwh) && d.loadKwh < MIN_USE_KWH) return `<p>${t.noUseYet}</p>`;
  const label = share === null ? cap(t.noData) : say(t.hShare, { p: f.num(pct(share)), a: f.kwh(Math.max(0, d.loadKwh - d.gridImportKwh)), b: f.kwh(d.loadKwh) });
  const fromGrid = Number.isFinite(d.gridImportKwh) ? Math.max(0, d.gridImportKwh) : null;
  const fromBatt = data.batt ? (Number.isFinite(d.batteryKwh) ? Math.max(0, d.batteryKwh) : null) : 0;
  const sun = [d.loadKwh, fromBatt, fromGrid].every(Number.isFinite) ? Math.max(0, d.loadKwh - fromBatt - fromGrid) : null;
  const parts = [
    { name: t.sun, color: "--sun", kwh: sun },
    ...(data.batt ? [{ name: t.battery, color: "--batt", kwh: fromBatt }] : []),
    { name: t.grid, color: "--grid", kwh: fromGrid },
  ];
  const complete = parts.every((p) => Number.isFinite(p.kwh));
  const used = complete ? parts.reduce((sum, p) => sum + p.kwh, 0) : 0;
  // A part that reads 0 kWh has no place on the ring (6 - 5.6 - 0.4 is not exactly 0).
  parts.forEach((p) => { p.frac = used > 0 && p.kwh >= 0.05 ? p.kwh / used : 0; });
  // The largest part goes in the middle, its label on top: the other two then share the ring's ends, the
  // top lead stays well clear of the side labels and none crosses another. Smaller in the middle, a tiny
  // first part (no sun on a winter morning) would bring the top lead down onto the left label.
  if (parts.length === 3) {
    const most = parts.reduce((m, p, i) => (p.frac > parts[m].frac ? i : m), 0);
    parts.splice(1, 0, ...parts.splice(most, 1));
  }
  parts.forEach((p, i) => { p.side = i === 0 ? "left" : i === parts.length - 1 ? "right" : "top"; });
  return `<div class="ring-box">
        ${complete ? splitRing(parts, label, f.kwh(d.loadKwh))
          : `<svg class="ring" viewBox="0 0 200 176" ${hint(label)}><path class="track" d="M${ringAt(0, 80)} ${ringArc(0, 1, 80)}"/>${ringSize(f.kwh(d.loadKwh))}</svg>`}
        <div class="ring-mid" aria-hidden="true">${share === null ? '<span class="big">—</span>' : big(pct(share))}</div>
        ${complete ? parts.map((p) => `<span class="part ${p.side}">${p.name}</span>`).join("") : ""}
      </div><p>${share === null ? t.shareIncomplete : t.shareToday}</p>
      ${readout(t.todaySoFar, [
        [t.directSolar, f.kwh(sun), "--sun"],
        data.batt ? [t.battery, f.kwh(fromBatt), "--batt"] : null,
        [t.grid, f.kwh(fromGrid), "--grid"],
        data.sends && (d.gridExportKwh == null || d.gridExportKwh >= SENT_KWH) ? [t.sent, f.kwh(d.gridExportKwh), "--sent"] : null,
      ])}`;
}

// MONEY: payback, this month's days, the prices now, the month balance. "" when no card has anything, and the page then goes.
function moneyHtml({ data, t, f, clock, pick }) {
  const p = data.price, now = Date.now();
  // The price now, for the prices card: the sensor's present hour when it is fresh, else the Energy settings' one.
  const hour = presentHour(data.ahead, now);
  const buy = hour?.buy ?? p.buy, sell = hour?.sell ?? p.sell;
  // The month money: the sensor's months when it is fresh (this month's as its month end), else the
  // statistics (see onRecord).
  const m = data.month, lm = data.lastMonth;
  const key = clock(now).key.slice(0, 7), months = data.ahead?.from === "sensor" ? data.ahead.months : null;
  // Money from the statistics: what the grid cost and paid as Home Assistant recorded it, when there is
  // some for the month (so a new price leaves past months as they were), else its kWh at today's price.
  // Saved has no statistic of its own: the house's own kWh at the month's average grid price (its cost
  // over its kWh), else at today's.
  // A recorded 0 stays 0; an unknown energy figure leaves the money unknown (null), never 0. With export off
  // nothing is earned.
  // ponytail: a month whose cost statistic started part way through counts only that part.
  const recorded = (v) => (Number.isFinite(v) ? v : null);
  const onRecord = {
    cost: (x) => recorded(x.costMoney) ?? pricedEnergy(x.gridImportKwh, p.buy),
    earned: (x) => (!data.sends ? 0 : recorded(x.earnedMoney) ?? pricedEnergy(x.gridExportKwh, p.sell)),
    saved: (x) => (![x.loadKwh, x.gridImportKwh].every(Number.isFinite) ? null
      : recorded(x.costMoney) !== null && x.gridImportKwh > 0 ? Math.max(0, x.loadKwh - x.gridImportKwh) * x.costMoney / x.gridImportKwh : savedMoney(x, p)),
  };
  // The bill's fixed part in a month: that month's mean of its entity, else the nearest month before with one,
  // else the first on record (the month is older than the entity), else its value now; null (unknown) when the
  // entity has neither. No bill_fixed at all is 0.
  const fx = data.billFixed ?? {}, fxKeys = Object.keys(fx.months ?? {}).sort();
  const fixedAt = (mk) => fx.months?.[mk] ?? fx.months?.[fxKeys.filter((k) => k < mk).at(-1) ?? fxKeys[0]] ?? (fx.now === undefined ? 0 : fx.now);
  // A row's money in a month: the sensor's figure for a finished month when it has one, else the statistics
  // (see onRecord); null when nobody can price it. The bill's fixed part goes on every month's cost whole,
  // as the bill charges it.
  const got = (k, x, mk) => {
    const v = months?.[mk]?.money?.[k], r = Number.isFinite(v) ? v : onRecord[k](x);
    return r === null ? null : k !== "cost" ? r : fixedAt(mk) === null ? null : r + fixedAt(mk);
  };
  // Net: what the system brought (saved and earned) less what the grid cost; unknown when any of them is.
  const back = (x, mk) => sumKnown([got("saved", x, mk), got("earned", x, mk)]);
  const net = (x, mk) => { const c = got("cost", x, mk), b = back(x, mk); return c === null || b === null ? null : b - c; };
  // This month's end, the sensor's (with the month end switch): [low, mid, high], for net its mid alone.
  const fee = fixedAt(key), v = months?.[key]?.money;
  const r = (j) => (Array.isArray(v?.[j]) && v[j].every(Number.isFinite) && (j !== "cost" || fee !== null) ? v[j].map((y) => y + (j === "cost" ? fee : 0)) : null);
  const end = { saved: r("saved"), earned: r("earned"), cost: r("cost") };
  end.net = end.saved && end.cost ? end.saved[1] + (end.earned?.[1] ?? 0) - end.cost[1] : null;
  const lastKey = shiftKey(key + "-01", -1).slice(0, 7), sign = f.money(0).split(" ").pop();
  // Finished months from the month rows, last month and this one from the day rows (as `lastMonth` and `month`).
  const byMonth = new Map(data.months ?? []).set(lastKey, lm).set(key, m);
  const row = (mk) => { const x = byMonth.get(mk); return x && !x.none ? x : null; };
  // Month balance: the 12 months' net as bars (see monthPicker), the picked one (this one at first) under
  // them: its grid cost to the left of a middle line, what it saved and earned to the right, on one scale,
  // with their figures, then saved, export and the net as figures (see readout; a net below 0 in the low
  // colour). A figure nobody can price, or unknown, is a dash, without a bar; a month with no numbers on
  // record says so. For this month, with the sensor, where its net should end. The card goes when no month
  // has any money known.
  const netOf = (mk) => (row(mk) ? net(row(mk), mk) : null);
  const at = yearKeys(key).includes(pick?.balanceMonth) ? pick.balanceMonth : key;
  const named = (mk) => (mk === key ? say(t.monthSoFar, { m: f.monthYear(mk) }) : f.monthYear(mk));
  const x = row(at), cost = x && got("cost", x, at), saved = x && got("saved", x, at), earned = x && got("earned", x, at);
  const brought = x && back(x, at), result = x && net(x, at), most = Math.max(cost ?? 0, brought ?? 0, 1e-9);
  // ponytail: a figure below 0 (a negative tariff) has its number but no bar; draw it to the other side if that ever matters.
  const side = (cls, label, v, color) => `<div class="side ${cls}"><span>${label}</span><span class="track">${!(v > 0) ? "" : `<i style="--c:${markOf(color)};--w:${((v / most) * 100).toFixed(1)}%"></i>`}</span><b>${f.money(v)}</b></div>`;
  const month = yearKeys(key).some((mk) => row(mk) && ["cost", "saved", "earned"].some((k) => got(k, row(mk), mk) !== null)) ? `<section class="card months" data-pick="balance">
      <h2><span>${t.monthTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "table")}
      ${monthPicker(t, f, key, at, netOf, (k, v) => `${named(k)}: ${v === null ? t.noData : say(t.hBalance, { v: f.money(v) })}`, "--batt", true)}
      <div class="stepped">${monthSteps(t, key, at, (k) => cap(named(k)))}<h3 class="chart-title">${cap(named(at))}</h3></div>
      ${x ? `<div class="split">${side("cost", t.gridCost, cost, "--grid")}${side("back", data.sends ? t.savedEarned : t.savedLabel, brought, "--sun")}</div>
      ${readout("", [
        [t.savedLabel, f.money(saved), "--sun"],
        data.sends ? [t.exportLabel, f.money(earned), "--sent"] : null,
        [t.netBenefit, f.money(result), result < 0 ? "--low" : "--batt", result < 0],
      ])}
      ${at === key && end.net !== null ? `<p class="note">${say(t.balEnd, { v: f.money(end.net) })}</p>` : ""}` : `<p class="note">${t.noData}</p>`}
    </section>` : "";
  // The prices now: buying from the grid, and selling to it while export is on, each with which way the energy goes.
  const flow = (label, v, out) => `<div class="price${out ? " out" : ""}"><p class="rate"><span>${label}</span> <b>${f.money(v)}<small> /kWh</small></b></p>
      <p class="route"><svg class="end" viewBox="-17 -17 34 34" role="img" aria-label="${t.home}">${HOUSE}</svg><span class="arrow" aria-hidden="true">${out ? '<i></i><svg viewBox="17 7 6 10"><path d="m18 8 4 4-4 4"/></svg>' : '<svg viewBox="1 7 6 10"><path d="M6 8 2 12l4 4"/></svg><i></i>'}</span><svg class="end" viewBox="0 0 24 24" role="img" aria-label="${t.grid}">${PLUG}</svg></p></div>`;
  const selling = data.sends && sell !== null;
  const prices = buy === null && !selling ? "" : `<section class="card prices">
      <h2>${t.pricesTitle}</h2>${helpButton(t, "prices")}
      ${buy === null ? "" : flow(t.buyGrid, buy, false)}${selling ? flow(t.sellGrid, sell, true) : ""}
    </section>`;
  // What each month brought back (saved and earned) and what its grid cost, for payback: finished months as
  // the month card reads them, this month so far from the statistics (the sensor's figure for it is the month end).
  // A month whose returns are unknown stays in, as null: payback then cannot say what came back. So does a month
  // missing from the month rows between the first on record and this one (last month from the day rows, which the
  // month rows lag).
  const ledger = [];
  if (data.payback) {
    const have = new Map(data.months ?? []);
    for (let mk = [...have.keys(), key].sort()[0]; mk <= key; mk = shiftKey(mk + "-28", 4).slice(0, 7)) {
      const x = mk === key ? m : have.get(mk) ?? (mk === lastKey ? lm : null);
      ledger.push({ key: mk, back: x ? back(x, mk) : null });
    }
  }
  // This month day by day: what each day brought back from its day rows, priced as above without the fixed
  // fees; null for a day with no numbers on record or nobody to price it.
  const days = (data.monthDays ?? []).map((x) => ({ date: x.date, back: x.none ? null : sumKnown([onRecord.saved(x), onRecord.earned(x)]), cost: x.none ? null : onRecord.cost(x) }));
  const rest = paybackCard(ledger, data.payback, { t, f }, !!(data.outlook || data.usualToday))
    + (days.some((x) => x.back !== null || x.cost !== null) ? recentCard(data, days, sign, { t, f, pick }) : "");
  return month || rest || prices ? `
    <h1 class="title">${t.tabMoney}</h1>
    ${rest}${prices}${month}` : "";
}

// This month day by day (see dayLine): what each day brought back, and the picked day's returns, grid cost
// and net under the chart (the month's total is on Month balance). A cost nobody can price leaves the net
// unknown too.
function recentCard(data, list, sign, { t, f, pick }) {
  const day = (x, v, lead) => {
    if (v === null) return readout(lead, [[t.noData, "—"]]);
    const net = x.cost == null ? null : v - x.cost;
    return readout(lead, [[t.returns, f.money(v), "--sun"], [t.gridCost, f.money(x.cost), "--grid"],
      [t.netBenefit, f.money(net), net < 0 ? "--low" : "--batt", net < 0]]);
  };
  return `<section class="card recent" data-pick="recent">
      <h2><span>${t.recentTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "recent")}
      ${dayLine(t, f, data.monthKey, list, (x) => x.back, (x, v) => `${f.date(new Date(x.date))}: ${v === null ? t.noData : f.money(v)}`, day, pick?.recent)}
    </section>`;
}

// Payback (see paybackLeft): what came back since the install date, plus what was saved before Home Assistant
// recorded, against what the system cost: a ring of the share with what came back in its middle and the cost
// in its gap, named under it, and how long is left (only while the page predicts anything, as with a forecast
// or a usual day). Once paid, a check in the full ring, the month it happened and what came back since.
// Hidden without a cost.
function paybackCard(all, pb, { t, f }, predicts) {
  if (!pb) return "";
  // The install date's month as written ("2026-11-01"), never moved by a time zone. A copy this browser
  // remembered from an older version holds it as UTC midnight in ms, which gives the same month in UTC.
  const from = typeof pb.since === "string" ? pb.since.slice(0, 7) : Number.isFinite(pb.since) ? new Date(pb.since).toISOString().slice(0, 7) : "";
  const done = all.filter((x) => x.key >= from);
  if (done.some((x) => x.back === null)) return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <p class="note">${t.paybackIncomplete}</p>
    </section>`;
  const got = pb.before + done.reduce((s, x) => s + x.back, 0), share = clamp01(got / pb.cost);
  // Finished months only: this month so far would pull the average down.
  const left = got >= pb.cost || !predicts ? null : paybackLeft(pb.cost - got, done.slice(0, -1), done.at(-1)?.key);
  const years = left && left[1] >= 24, span = (n) => (years ? f.years(Math.round(n / 1.2) / 10) : f.months(n));
  const of = say(t.paybackOf, { a: f.moneyWhole(got), b: f.moneyWhole(pb.cost) }), paid = got >= pb.cost;
  // Once paid: the month the running total passed the cost (none when it had before Home Assistant recorded),
  // and what came back since.
  let at = null;
  for (let s = pb.before, i = 0; paid && s < pb.cost && i < done.length; i++) if ((s += done[i].back) >= pb.cost) at = done[i].key;
  const head = !paid ? of : at ? say(t.paybackOn, { m: f.monthYear(at) }) : t.paidBack;
  const when = paid ? say(t.paybackGain, { v: f.moneyWhole(got - pb.cost) })
    : left && say(t.paybackLeft, { d: span(left[1]) }) + (left[0] !== left[2] ? ` (${say(t.paybackRange, { a: span(left[0]), b: span(left[2]) })})` : "");
  return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <div class="ring-box">
        ${ring(share, "--sun", paid ? head : of, paid ? "" : f.moneyWhole(pb.cost))}
        <div class="ring-mid" aria-hidden="true">${paid ? `<svg class="done" viewBox="0 0 24 24">${ADVICE_ICON.ok}</svg>` : `<span class="amount">${f.moneyWhole(got)}</span>`}</div>
      </div>
      ${paid ? `<p>${head}</p>` : `<p class="ring-name">${t.plantCost}</p>`}${when ? `<p class="money">${when}</p>` : ""}
    </section>`;
}

// Months until `owed` is back: each coming month brings what the same month brought a year before, or the
// average month while there is no such month yet. [low, mid, high] months: the range walks every month
// PAYBACK_SPREAD better and worse, one value once a full year is on record. null with nothing on record.
function paybackLeft(owed, past, lastKey) {
  const by = Object.fromEntries(past.map((x) => [x.key, x.back]));
  const avg = past.length ? past.reduce((s, x) => s + x.back, 0) / past.length : 0;
  if (!(avg > 0) || !lastKey) return null;
  const walk = (k) => {
    let rest = owed, n = 0, mk = lastKey;
    while (rest > 0 && n < PAYBACK_MAX_MONTHS) { mk = shiftMonth(mk, 1); n++; rest -= k * (by[shiftMonth(mk, -12)] ?? avg); }
    return n;
  };
  const spread = past.length >= 12 ? 0 : PAYBACK_SPREAD;
  return [walk(1 + spread), walk(1), walk(1 - spread)];
}
const shiftMonth = (key, n) => { const [y, m] = key.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

// ---- Element ----
class SolarView extends HTMLElement {
  constructor() {
    super();
    this._drawn = "";  // key of what is on screen, to skip identical redraws
    this._html = [];   // each page's markup on screen, to write only the pages that changed
    this._src = undefined;   // which entities to read (entitiesFrom), once the Energy settings answered
    this._stats = undefined; // totals from the statistics (totals)
    this._next = 0;          // when to load both again
    this._ahead = this._outlook = null; // the forecast and what follows from it (_lookAhead)
    // The host attributes (dark, ready) are set in _render: a custom element constructor must
    // not set attributes on itself.
    const root = this.attachShadow({ mode: "open" });
    // Rain is a few drops at fixed places across the width, each started at another point of its fall.
    root.innerHTML = `<style>${CSS}</style>
<div class="sky"></div><div class="stars"></div><div class="rain" aria-hidden="true" hidden>${[[6, 0], [19, 1.3], [31, 0.6], [44, 1.9], [56, 0.3], [68, 1.6], [81, 0.9], [93, 2.1]]
  .map(([x, d]) => `<i style="left:${x}%;animation-delay:-${d}s"></i>`).join("")}</div><div class="snow" aria-hidden="true" hidden>${[[4, 4, 0, 8], [11, 3, 5.1, 9.5], [18, 5, 2.4, 7.5], [26, 3, 6.8, 10], [33, 6, 1.2, 8.5], [41, 4, 4.3, 9], [48, 3, 7.4, 7.8], [55, 5, 0.6, 9.8], [62, 4, 3.6, 8.2], [70, 3, 5.9, 10.2], [77, 6, 2.1, 8.8], [84, 4, 6.3, 7.6], [91, 3, 1.7, 9.2], [96, 5, 4.8, 8.4]]
  .map(([x, s, d, t]) => `<i style="left:${x}%;--s:${s}px;--t:${t}s;animation-delay:-${d}s"></i>`).join("")}</div><div class="veil"></div><div class="hint" aria-hidden="true"></div><div class="status" role="status"></div>
<button type="button" class="gear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6v4.6M12 17.8v4.6M1.6 12h4.6M17.8 12h4.6M4.6 4.6l3.3 3.3M16.1 16.1l3.3 3.3M4.6 19.4l3.3-3.3M16.1 7.9l3.3-3.3" stroke-width="3.4"/><circle cx="12" cy="12" r="5.9" stroke-width="3"/></svg></button>
<main class="pager">${PAGES.map((p) => `<section class="page ${p}" id="${p}"></section>`).join("")}</main>
<footer><ha-menu-button hidden></ha-menu-button><nav class="tabs">${PAGES.map((p) =>
  `<button type="button" data-page="${p}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICON[p]}</svg><span></span></button>`).join("")}</nav></footer>
<dialog class="show" aria-labelledby="show-title"><form method="dialog"><h2 id="show-title" data-t="showTitle"></h2><p data-t="showNote"></p>
${Object.entries(SWITCHES).map(([group, names]) => `<fieldset><legend data-t="${group}"></legend>${names.map((n) =>
  `<label><span data-t="sw${n[0].toUpperCase() + n.slice(1)}"></span><input type="checkbox" role="switch" name="${n}"></label>`).join("")}</fieldset>`).join("")}
${languagePicker()}
<button data-t="showDone"></button></form></dialog>
${Object.entries(READ).map(([card, lines]) => `<dialog class="read" data-card="${card}" aria-labelledby="read-${card}"><form method="dialog"><h2 id="read-${card}" data-t="helpTitle"></h2>
${card === "battery" ? `<div class="pair"><figure>${battRing(60, 75, [69, 81], "--batt", null, "")}<figcaption data-t="helpRise"></figcaption></figure>
<figure>${battRing(60, 45, [40, 52], "--batt", null, "")}<figcaption data-t="discharging"></figcaption></figure></div>` : ""}
<ul>${lines.map(([mark, key]) => `<li>${mark}<span data-t="${key}"></span></li>`).join("")}</ul>
<button data-t="helpClose"></button></form></dialog>`).join("")}`;
    this._pager = root.querySelector(".pager");
    this._menu = root.querySelector("ha-menu-button");
    this._tabs = [...root.querySelectorAll(".tabs button")];
    this._hint = root.querySelector(".hint");
    this._status = root.querySelector(".status");
    this._rain = root.querySelector(".rain");
    this._snow = root.querySelector(".snow");
    this._gear = root.querySelector(".gear");
    this._dialog = root.querySelector("dialog.show");
    try { this._show = JSON.parse(localStorage.getItem(SHOW_KEY)) ?? {}; } catch (e) { this._show = {}; } // see SHOW_KEY
    try { const l = localStorage.getItem(LANGUAGE_KEY); this._language = Object.hasOwn(LANGUAGES, l ?? "") ? l : ""; } catch (e) { this._language = ""; } // see LANGUAGE_KEY
    this._wireHints(root);
    this._wireTabs(root);
    this._wireShow();
    this._wireWeek();
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
    // Still nothing from Home Assistant: show the veil's plain day sky, not a blank page. The theme
    // is not known yet, so the system's stands in for it.
    if (!this._hass) this._paint("l", skyAt(30, false, matchMedia("(prefers-color-scheme: dark)").matches).colors);
    // Back after being taken off the page: the load dropped then is asked again.
    else if (this._dropped) this._loadSoon();
    this._dropped = false;
  }
  // Taken off the page: a load still on its way is dropped (see the run check in _load), so a page nobody
  // sees neither draws nor overwrites the copy this browser remembers.
  disconnectedCallback() {
    this._run = (this._run || 0) + 1;
    this._dropped = true;
  }

  _paint(prefix, colors) { colors.slice(0, 3).forEach((c, i) => this.style.setProperty(`--${prefix}${i + 1}`, c)); }

  // Hovering, tapping or focusing anything with data-hint shows its sentence. Delegated, because
  // the pages are redrawn whenever the data changes.
  _wireHints(root) {
    const tip = this._hint;
    // Escape hides the hint and keeps it hidden until the viewer leaves that target. A redraw replaces
    // the element, so the target is known by its focus key (see focusKey), not by the element alone.
    let dismissed = null, dismissedKey = null;
    const keyOf = (el) => {
      const page = el.closest(".page"), key = page && focusKey(page, el);
      return key ? `${page.id}:${JSON.stringify(key)}` : el;
    };
    const reset = () => { dismissed = dismissedKey = null; };
    const hide = () => tip.classList.remove("on");
    const show = (e) => {
      const el = e.target.closest?.("[data-hint]");
      // The skeleton holds placeholder numbers: never put them in a hint.
      if (!el || this._pager.classList.contains("skel")) { hide(); return; }
      if (dismissed && keyOf(el) === dismissedKey) { dismissed = el; hide(); return; }
      reset();
      this._hintFor = el; // see _render
      // What the mark is, small, over its value, split at the sentence's first colon ("12:00 PM: about
      // 3 kW" splits after "PM"); a dot in the mark's colour when it has one (--c).
      const [, title, body] = el.dataset.hint.match(/^(?:(.+?)\s?:\s)?(.+)$/s);
      const line = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
      tip.replaceChildren(...(title ? [line("small", title)] : []), line("b", body[0].toUpperCase() + body.slice(1)));
      const dot = el.style.getPropertyValue("--c");
      tip.classList.toggle("dot", !!dot);
      tip.style.setProperty("--dot", dot);
      const box = this.getBoundingClientRect(), r = el.getBoundingClientRect(), mid = r.left - box.left + r.width / 2;
      const left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, mid - tip.offsetWidth / 2));
      // Above the mark, else below it; where neither has room, on the roomier side, kept inside the panel.
      const above = r.top - box.top - tip.offsetHeight - 10, below = r.bottom - box.top + 10;
      const up = above >= 8 || (below + tip.offsetHeight > box.height - 8 && r.top - box.top > box.bottom - r.bottom);
      tip.classList.toggle("below", !up);
      // The pointer stays on the mark, inside the rounded corners.
      tip.style.setProperty("--x", `${Math.round(Math.max(16, Math.min(tip.offsetWidth - 16, mid - left)))}px`);
      tip.style.transform = `translate(${Math.round(left)}px,${Math.round(up ? Math.max(8, above) : Math.min(below, box.height - tip.offsetHeight - 8))}px)`;
      tip.classList.add("on");
    };
    root.addEventListener("pointerover", show);
    root.addEventListener("focusin", show);
    // Moving between the parts of one target (a ring's arcs) is not leaving it.
    const leave = (e) => {
      const el = e.target.closest?.("[data-hint]");
      if (el && el.isConnected && el === dismissed && !el.contains(e.relatedTarget)) reset();
    };
    // Escape is taken only when it hides a hint; otherwise it goes on to close a dialog as usual.
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !tip.classList.contains("on")) return;
      dismissed = this._hintFor;
      dismissedKey = keyOf(dismissed);
      hide();
      e.preventDefault();
      e.stopPropagation();
    });
    root.addEventListener("focusout", (e) => { leave(e); hide(); });
    root.addEventListener("pointerout", (e) => { if (!dismissed?.contains(root.activeElement)) leave(e); });
    this.addEventListener("pointerleave", () => { if (!dismissed?.contains(root.activeElement)) reset(); hide(); });
  }

  // The tab bar follows the swipe, and a tab scrolls the pager.
  _wireTabs(root) {
    const mark = (id) => this._tabs.forEach((b) =>
      (b.dataset.page === id ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
    mark("now");
    // After a tap the pager scrolls past the pages in between: the tapped tab stays marked until
    // its page arrives. A touch or the wheel means the viewer took over, so the swipe leads again.
    let going = "";
    // A hidden page (the error message hides Energy and Money) is never marked or scrolled to.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (!e.target.hidden && e.isIntersecting && (!going || e.target.id === going)) { going = ""; mark(e.target.id); }
    }, { root: this._pager, threshold: 0.6 });
    [...this._pager.children].forEach((p) => io.observe(p));
    for (const type of ["pointerdown", "wheel"]) this._pager.addEventListener(type, () => { going = ""; }, { passive: true });
    this._activatePage = (id, instant = false) => {
      const page = root.getElementById(id);
      if (!page || page.hidden) return;
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      going = page.id;
      this._pager.scrollTo({ left: page.offsetLeft - this._pager.offsetLeft, behavior: instant || calm ? "instant" : "smooth" });
      mark(page.id);
    };
    this._tabs.forEach((b) => b.addEventListener("click", () => this._activatePage(b.dataset.page)));
  }

  // The gear opens the display switches. A switch redraws at once and is kept for this device; when
  // storage fails it still holds until the page is reloaded.
  _wireShow() {
    const boxes = [...this._dialog.querySelectorAll('input[role="switch"]')];
    boxes.forEach((b) => { b.checked = this._show[b.name] !== false; });
    this._gear.addEventListener("click", () => this._dialog.showModal());
    // Safari does not focus a tapped button, so the dialog would hand focus to the page instead.
    this._dialog.addEventListener("close", () => this._gear.focus());
    // The language: applied at once; Automatic clears it. Without storage it holds for this visit.
    const language = this._dialog.querySelector('select[name="language"]');
    language.value = this._language;
    language.addEventListener("change", () => {
      if (!Object.hasOwn(LANGUAGES, language.value) && language.value !== "") return;
      this._language = language.value;
      try { this._language ? localStorage.setItem(LANGUAGE_KEY, this._language) : localStorage.removeItem(LANGUAGE_KEY); } catch (e) { /* this visit only */ }
      this._render();
    });
    this._dialog.addEventListener("change", (e) => {
      if (!e.target.matches('input[role="switch"]')) return;
      this._show = Object.fromEntries(boxes.filter((b) => !b.checked).map((b) => [b.name, false]));
      try { localStorage.setItem(SHOW_KEY, JSON.stringify(this._show)); } catch (e) { /* this view only */ }
      this._render();
    });
    // A card's "?" opens how to read it, as the gear does. The button is redrawn with its page, so focus
    // goes back to the one on screen now.
    const root = this.shadowRoot;
    this._pager.addEventListener("click", (e) => {
      const help = e.target.closest?.(".help");
      const d = help && root.querySelector(`dialog.read[data-card="${help.dataset.card}"]`);
      if (!d) return;
      // Named as its button is, with the card's title.
      d.removeAttribute("aria-labelledby");
      d.setAttribute("aria-label", help.getAttribute("aria-label"));
      d.showModal();
    });
    // Its card gone meanwhile (an error message took the page), the gear takes focus instead.
    root.querySelectorAll("dialog.read").forEach((d) => d.addEventListener("close", () => {
      const help = root.querySelector(`.help[data-card="${d.dataset.card}"]`);
      (help?.checkVisibility() && !help.closest("[inert]") ? help : this._gear).focus();
    }));
  }

  // A day or an hour picked: highlighted, its figures under the chart (see dayLine and battDayCard). Changed
  // in place, and kept for the redraws. A day is picked by a tap, focus (the arrow keys move it) or a drag.
  // An hour only by a click, Enter or Space, or a finger's drag: hovering or focusing it shows it on both
  // charts with its hint (.hover), and a mouse moved with a button held changes nothing.
  // A month (Production, Month balance) is picked by a click, Enter or Space: its card is drawn again.
  _wireWeek() {
    const ROW = ":is(.week,.hours24) li", HOUR = ".hours24 li";
    const pick = (e) => {
      const bar = e.target.closest?.(ROW);
      if (!bar || bar.classList.contains("future")) return;
      // Each card keeps its own pick (by its data-pick: daily, recent, battday) across redraws.
      const card = bar.closest(".card");
      (this._pick ??= {})[card.dataset.pick] = +bar.dataset.i;
      card.querySelectorAll(ROW).forEach((li) => (li.dataset.i === bar.dataset.i ? li.setAttribute("aria-current", "true") : li.removeAttribute("aria-current")));
      card.querySelectorAll(".day").forEach((p) => { p.hidden = p.dataset.i !== bar.dataset.i; });
      // ‹ or › greyed when there is no hour or day that way (see steps).
      card.querySelectorAll("[data-step]").forEach((b) => {
        const to = bar.parentElement.children[+bar.dataset.i + +b.dataset.step];
        if (!to || to.classList.contains("future")) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
      });
      this._rove(card);
    };
    // ‹ and › beside the picked hour or day pick its neighbour, as a tap on it would (a month's go by month, below).
    const step = (e) => {
      const b = e.target.closest?.("[data-step]");
      if (!b) return false;
      const cells = [...b.closest(".card").querySelector(".week, .hours24").children];
      const to = cells[cells.findIndex((li) => li.hasAttribute("aria-current")) + +b.dataset.step];
      if (to) pick({ target: to });
      return true;
    };
    const month = (e) => {
      const b = e.target.closest?.("[data-month]");
      if (!b) return false;
      const card = b.closest(".card");
      // A new month starts from its last day.
      (this._pick ??= {})[`${card.dataset.pick}Month`] = b.dataset.month;
      if (card.dataset.pick === "daily") delete this._pick.daily;
      this._drawn = "";
      this._render();
      return true;
    };
    this._pager.addEventListener("click", (e) => {
      // Safari does not focus a button it clicks. A step takes focus itself, or a month's redraw would put it
      // back on the day that had it (see focusKey): that day's hint would open, and the day be picked.
      e.target.closest?.(".step")?.focus();
      if (!step(e) && !month(e)) pick(e);
    });
    this._pager.addEventListener("focusin", (e) => { if (!e.target.closest?.(HOUR)) pick(e); });
    // The hour under the pointer or focus, on both charts.
    const hover = (li) => this._pager.querySelectorAll(HOUR).forEach((c) => c.classList.toggle("hover", !!li?.dataset.hint && c.dataset.i === li.dataset.i));
    this._pager.addEventListener("pointerover", (e) => hover(e.target.closest?.(HOUR)));
    this._pager.addEventListener("focusin", (e) => hover(e.target.closest?.(HOUR)));
    this._pager.addEventListener("focusout", () => hover(null));
    this._pager.addEventListener("pointerleave", () => hover(null));
    // A drag picks whatever it passes over in the row it started in (the rows only scroll the page up and down).
    let row = null;
    this._pager.addEventListener("pointerdown", (e) => {
      const li = e.isPrimary ? e.target.closest?.(ROW) : null, hour = !!li?.matches(HOUR);
      row = li && (!hour || e.pointerType === "touch") ? li.parentElement : null;
      if (row && !hour) pick(e);
    });
    this._pager.addEventListener("pointermove", (e) => {
      const li = row && e.buttons ? [...row.children].find((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; }) : null;
      if (li && !li.hasAttribute("aria-current")) pick({ target: li });
    });
    this._pager.addEventListener("pointerup", () => { row = null; });
    this._pager.addEventListener("pointercancel", () => { row = null; });
    // Left and right move along a chart, and its one Tab stop moves along (see _rove).
    this._pager.addEventListener("keydown", (e) => {
      const li = e.target.closest?.(ROW), step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (li?.matches(HOUR) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(e); return; }
      const list = step && e.target.closest?.(ROVE), all = list ? [...list.querySelectorAll("[tabindex]")] : [], next = all[all.indexOf(e.target) + step];
      if (next) { e.preventDefault(); e.target.tabIndex = -1; next.tabIndex = 0; next.focus(); }
    });
  }

  // One Tab stop per chart or list, not one per hour, day or month: the picked one, else the first.
  // The arrows move it (see _wireWeek).
  _rove(page) {
    page.querySelectorAll(ROVE).forEach((list) => {
      const all = [...list.querySelectorAll("[tabindex]")], stop = all.find((c) => c.matches("[aria-current=true],[aria-pressed=true]")) ?? all[0];
      all.forEach((c) => { c.tabIndex = c === stop ? 0 : -1; });
    });
  }

  // Home Assistant's menu button is the only way out whenever its sidebar is not on screen:
  // on a narrow screen, or on any screen when the user chose to always hide the sidebar.
  _showMenu() { this._menu.hidden = !(this._narrow || this._hass?.dockedSidebar === "always_hidden"); }

  // Home Assistant passes the panel_custom entry here; its `config:` holds the owner's settings.
  set panel(p) { this._panel = p; this._drawn = ""; this._next = 0; if (this._hass) this._loadSoon(); this._render(); }
  get panel() { return this._panel; }

  set narrow(v) { this._narrow = v; this._menu.narrow = v; this._showMenu(); }
  get narrow() { return this._narrow; }

  set hass(hass) {
    this._hass = hass;
    this._menu.hass = hass;
    this._showMenu();
    // A forecast the sensor just wrote is worked through at once, without asking the statistics again.
    if (this._stats && findForecast(hass)?.state !== this._seen) this._lookAhead();
    if (Date.now() >= this._next) this._loadSoon();
    this._render();
  }
  get hass() { return this._hass; }

  // Home Assistant sets hass and panel one after the other when the page opens: one load for both.
  _loadSoon() {
    if (this._soon) return;
    this._soon = true;
    queueMicrotask(() => { this._soon = false; if (!this._dropped) this._load(); });
  }

  // The forecast and what follows from it (ghosts, lasts until, best time, money, month end): worked
  // out when the statistics load and when the sensor writes, not on every redraw (spec section 2 item 6).
  _lookAhead() {
    const hass = this._hass, src = this._src, stats = this._stats, now = Date.now();
    const sensor = findForecast(hass), clock = clockOf(hass.config?.time_zone);
    this._seen = sensor?.state;
    // A broken sensor must not take the rest of the page with it.
    try {
      const { now: n, price, batt } = readData(hass, src, stats);
      const usual = stats.usual && { solarW: stats.usual.solarW, loadW: stats.usual.balanceW };
      const ahead = forecastOf({ sensor, now, clock, solarWh: stats.solarWh, usual, price });
      // Hours already past are priced by the sensor's own hours when it is fresh, else at the flat price.
      const given = new Map((ahead?.from === "sensor" ? sensor.attributes.hours : []).map((h) => [Date.parse(h.t), h]));
      const priceAt = (field) => (t) => (given.has(t) ? given.get(t)[field] ?? null : price[field]);
      const standby = stats.standbyW / 1000;
      // Use as the balance, as the forecast counts it (a load sensor already leaves standby out).
      const soFar = { ...stats.today, loadKwh: balanceKwh(stats.today), ...moneySoFar(stats.todayHours, priceAt("buy"), priceAt("sell"), standby, now) };
      const battery = batt && { kwh: batt.kwh, floor: batt.floor, maxChargeKw: batt.maxChargeKw, efficiency: stats.efficiency };
      this._ahead = ahead;
      // Without house use (mode Weather) the sensor gives sun and sky only: no outlook, so the page shows
      // what it shows without a forecast (no ghosts, money, best time, lasts until). So does a day whose
      // statistics are incomplete: an unknown figure must not count as 0 in what follows from them.
      const known = ENERGY.every((part) => Number.isFinite(stats.today[part]));
      this._outlook = ahead?.left.use && known ? lookAhead(ahead, now, clock, n, battery, { exportMaxKw: src.exportMaxKw, standbyKwhPerHour: standby }, soFar) : null;
    } catch (e) {
      console.warn("solar-view: the forecast could not be read", e);
      this._ahead = this._outlook = null;
    }
  }

  // Which entities to read (Energy settings plus config), then their totals from the statistics.
  // Home Assistant writes its hour rows about 12 minutes past each hour (UTC), and makes the day and
  // month rows from them: everything but today's 5 minute rows is kept until a quarter past, so most
  // loads ask one thing. The Energy settings are kept as long, except while they are not set up.
  async _load() {
    const hass = this._hass, now = Date.now(), run = (this._run = (this._run || 0) + 1), clock = clockOf(hass.config?.time_zone);
    this._next = now + REFRESH_MS;
    const quarter = Math.floor(now / 36e5) * 36e5 + 9e5, until = quarter > now ? quarter : quarter + 36e5;
    try {
      let setup = this._setup && now < this._setup.until ? this._setup : null;
      if (!setup) {
        // "No prefs": the Energy page was never set up. The owner's config may still name entities.
        const [prefs, info] = await Promise.all([hass.callWS({ type: "energy/get_prefs" }).catch((e) => { if (e?.code === "not_found") return null; throw e; }),
          hass.callWS({ type: "energy/info" }).catch(() => ({}))]);
        // Not set up: asked again on the next load, so the page follows the owner setting it up.
        setup = { prefs, info, until: prefs ? until : 0 };
      }
      const src = entitiesFrom(setup.prefs, this._panel?.config || {}, setup.info?.cost_sensors);
      // The skeleton takes its shape from the settings while the statistics load (see placeholder).
      if (!this._src && run === this._run) { this._src = src; this._render(); }
      const ids = ENERGY.flatMap((k) => src[k]), all = PARTS.flatMap((k) => src[k]);
      const stat = (period, start, list = all, types = ["change"]) => (list.length ? hass.callWS({
        type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(),
        statistic_ids: list, period, types, units: { energy: "kWh" },
      }) : {});
      // The bill's fixed part from an entity: its month means, from the first on record.
      const fixedId = typeof src.billFixed === "string" ? [src.billFixed] : [];
      const asked = JSON.stringify([all, src.soc, src.usualDays, fixedId]);
      // A new day in Home Assistant's time zone asks again: the kept day rows end with yesterday as today.
      const kept = this._kept?.asked === asked && now < this._kept.until && this._kept.day === clock(now).key ? this._kept : null;
      // 366 days reach the first day of the oldest month Production shows (see yearKeys) from any day.
      // 25 hours cover today, even a long one. Month rows from the first on record: payback, Month balance.
      const slow = kept?.rows ?? Promise.all([stat("day", now - 366 * 864e5), stat("hour", now - src.usualDays * 864e5, ids),
        hass.callWS({ type: "energy/solar_forecast" }).catch(() => ({})), stat("month", Date.UTC(2000, 0, 1)), stat("hour", now - 25 * 36e5, src.soc, ["mean"]),
        stat("month", Date.UTC(2000, 0, 1), fixedId, ["mean"])]);
      const [recent, rows] = await Promise.all([stat("5minute", now - 25 * 36e5), slow]);
      // `hass` and `panel` can each start a load: only the newest may answer, or entities read without
      // the config could land last.
      if (run !== this._run) return;
      this._setup = setup;
      this._src = src;
      this._kept = kept || { asked, until, rows, day: clock(now).key };
      const [daily, hourly, forecast, monthly, socRows, fixedRows] = rows;
      this._stats = totals(src, daily, recent, hourly, forecast, clock, now, monthly);
      this._stats.socDay = socDay(socRows, src.socWeight, clock, now, src.soc);
      this._stats.fixedMonths = Object.fromEntries((fixedRows[fixedId[0]] ?? []).filter((r) => Number.isFinite(r.mean)).map((r) => [clock(r.start).key.slice(0, 7), r.mean]));
      this._lookAhead();
      // Just after midnight "today" must start from zero.
      this._next = Math.min(this._next, now + this._stats.msToMidnight + 5e3);
      this._render();
    } catch (e) {
      if (run !== this._run) return; // an older load: the newest one keeps its own schedule
      console.warn("solar-view: loading the numbers failed", e);
      this._next = Date.now() + 60e3; // try again in a minute, not in 5
    }
  }

  _render() {
    const hass = this._hass;
    if (!hass) return;
    // This device's language (see LANGUAGE_KEY), else the viewer's, when its texts exist ("pt-BR", then
    // "pt"), else English. Numbers and dates follow that language either way.
    const locale = String(this._language || hass.locale?.language || hass.language || "en");
    const lang = [locale, locale.split("-")[0], "en"].find((l) => Object.hasOwn(LANGUAGES, l) && !failedLanguages.has(l));
    // Texts not loaded yet: the page stays as it is until they come, so texts and numbers change together.
    if (!STRINGS[lang]) { loadLanguage(lang).then(() => this._render()); return; }
    this.setAttribute("lang", locale);
    const dark = !!hass.themes?.darkMode;
    // The texts, and the labels outside the pages, only again when the language or the config changes:
    // this runs on every state change in the house.
    if (this._lang !== lang || this._tConfig !== this._panel?.config) {
      this._lang = lang;
      this._tConfig = this._panel?.config;
      this._t = withOwnAdvice(STRINGS[lang], this._panel?.config, lang);
      STRINGS[lang].adviceGo.forEach((l, i) => GO_ICON.set(l, APPLIANCE[GO_ORDER[i]]));
      const t = this._t;
      this._pager.setAttribute("aria-label", t.pages);
      [t.tabNow, t.tabEnergy, t.tabMoney].forEach((label, i) => { this._tabs[i].lastChild.textContent = label; });
      this._gear.setAttribute("aria-label", t.gearLabel);
      this.shadowRoot.querySelectorAll("dialog [data-t]").forEach((el) => { el.textContent = t[el.dataset.t]; });
      // Automatic in this language (plain text where options are, see languagePicker), picked again so the
      // closed select's copy of it (selectedcontent) shows the new name.
      const pick = this._dialog.querySelector('select[name="language"]'), auto = pick.querySelector('option[value=""]');
      (auto.querySelector("span") ?? auto).textContent = t.languageAuto;
      pick.selectedIndex = -1;
      pick.value = this._language;
    }
    const t = this._t;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.toggleAttribute("dark", dark);

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
    // A message gets one plain page instead of the dashboard's rows and columns (see .pager.message).
    this._pager.classList.toggle("message", offline || setup);
    // The veil is a plain day sky over the real one. It fades out once there is data, so the
    // real sky colour arrives as a transition instead of a jump.
    this._paint("l", skyAt(30, false, dark).colors);
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
      const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${line(body)}</svg>`;
      const message = offline ? `${icon(OFFLINE_ICON)}<h2>${t.offlineTitle}</h2><p>${t.offline}</p>`
        : `${icon(SETUP_ICON)}<h2>${t.setupTitle}</h2><p>${src.solarW.length ? t.setupGone : t.setup}</p>
          <p class="lead">${t.setupLead}</p><ol class="path">${t.setupPath.split(" › ").map((s) => `<li>${s}</li>`).join("")}</ol><p>${t.setupEnd}</p>${
          missing.length && hass.user?.is_admin ? `<h3>${t.missing}</h3><ul class="ids">${missing.map((id) => `<li>${esc(id)}</li>`).join("")}</ul>` : ""}`;
      if (this._drawn === message) return;
      this._drawn = message;
      this.removeAttribute("ready");
      this._hint.classList.remove("on");
      this._rain.hidden = this._snow.hidden = true; // rain from a forecast nobody can see would only distract
      // Energy and Money have nothing to show: they and their tabs go, and Now comes into view at once, from
      // its top, even after a swipe to another page or a scroll down this one.
      const lost = PAGES.some((p) => $(p).contains(this.shadowRoot.activeElement));
      PAGES.forEach((p, i) => {
        $(p).innerHTML = p === "now" ? `<section class="card empty">${message}</section>` : "";
        $(p).hidden = this._tabs[i].hidden = p !== "now";
      });
      // Said once to a screen reader (the readings just went), and focus that was on them goes to the message.
      this._status.textContent = `${offline ? t.offlineTitle : t.setupTitle}. ${offline ? t.offline : src.solarW.length ? t.setupGone : t.setup}`;
      const head = $("now").querySelector("h2");
      head.tabIndex = -1;
      if (lost) head.focus({ preventScroll: true });
      this._activatePage("now", true);
      $("now").scrollTop = this._pager.scrollTop = 0;
      this._html = [];
      return;
    }

    // Loading draws the real markup from placeholder numbers and .skel greys it out, so the
    // skeleton has exactly the size of what replaces it.
    // A first visit draws nothing for up to a second, until the Energy settings answer (see _load): they say
    // which pages there are, and a skeleton without one would jump when it comes.
    if (loading && !src && !remembered() && Date.now() < (this._holdUntil ??= Date.now() + 1000)) {
      this._held ??= setTimeout(() => this._render(), 1000);
      return;
    }
    const data = loading ? placeholder(hass, src) : readData(hass, src, this._stats, { ahead: this._ahead, outlook: this._outlook });
    const day = this.testDay ?? Math.round(new Date(Date.now()).setHours(0, 0, 0, 0) / 864e5); // testDay: preview harness only (?day=)
    const cycle = hourCycle(this._panel?.config, hass.locale);
    const tz = hass.config?.time_zone, currency = hass.config?.currency || "EUR", fKey = [locale, currency, cycle, tz].join("|");
    const json = JSON.stringify(data), key = loading + fKey + dark + day + JSON.stringify(this._show) + json;
    if (key === this._drawn) return; // same data again: leave the DOM (and its motion) alone
    this._drawn = key;
    this._status.textContent = ""; // the error message, if one was said, is gone
    if (loading) this.removeAttribute("ready");
    else {
      // The skeleton's copy needs the shape, not every watt: kept at most once a minute.
      if (!(Date.now() - this._saved < 6e4)) {
        this._saved = Date.now();
        try { localStorage.setItem(LAST_KEY, json); } catch (e) { /* storage is optional */ }
      }
      if (!this.hasAttribute("ready")) { // first real data: fade the veil out, let the content rise in
        this.setAttribute("ready", "");
        this._pager.classList.add("fresh");
        setTimeout(() => this._pager.classList.remove("fresh"), 900);
      }
    }

    // The display switches (see SHOW_KEY). Without the sun's height the sky goes straight from night to
    // day at sunrise, with no dawn or dusk: the colours of a high sun by day, of the deep night by night.
    const shown = (name) => this._show[name] !== false;
    const elevation = shown("sunHeight") ? data.sun.elevation : data.sun.elevation > 0 ? 90 : -90;
    const sky = skyAt(elevation, data.sun.dawn ?? data.sun.rising, dark, shown("clouds") ? data.weather.grey : 0);
    this._paint("sv-sky", sky.colors);
    // The first sky is set at once (read back, so the browser has it); from then on it glides, see :host([glide]).
    if (!this.hasAttribute("glide")) { getComputedStyle(this).getPropertyValue("--sv-sky1"); this.setAttribute("glide", ""); }
    this._rain.hidden = !(data.weather.rain && shown("rain"));
    this._snow.hidden = !(data.weather.snow && shown("rain")); // the rain switch is for snow too
    this.style.setProperty("--glow", sky.colors[3]);
    this.style.setProperty("--stars", dark ? (0.7 * (1 - sky.up)).toFixed(2) : "0");

    if (this._fKey !== fKey) {
      this._fKey = fKey;
      this._f = formats(locale, currency, cycle, tz);
      this._clock = clockOf(tz);
    }
    const f = this._f;
    const c = { data, t, f, sky, loading, day, clock: this._clock, pick: this._pick };
    let html;
    try {
      html = [nowHtml(c), energyHtml(c), moneyHtml(c)];
    } catch (e) {
      // Never a blank page: what is drawn stays. While loading the likely cause is a remembered
      // copy from an older version, so drop it and draw the typical numbers instead.
      console.error("solar-view: draw failed", e);
      let had = false;
      try { had = localStorage.getItem(LAST_KEY) !== null; localStorage.removeItem(LAST_KEY); } catch (e2) { /* no storage */ }
      if (loading && had) this._render();
      return;
    }
    // Only a page whose markup changed is written: the live values redraw Now alone, and a hint or focus on
    // another page stays. A written page has new elements: its hint goes (the sentence belonged to the old
    // numbers), and keyboard focus moves to the same control on it (see focusKey), or nowhere if it is gone.
    const changed = PAGES.filter((p, i) => html[i] !== this._html[i]);
    const redrawn = (el) => !!el && changed.some((p) => $(p).contains(el));
    if (redrawn(this._hintFor)) this._hint.classList.remove("on");
    const active = this.shadowRoot.activeElement;
    const focusedPage = active ? changed.find((p) => $(p).contains(active)) : null;
    const focused = focusedPage ? focusKey($(focusedPage), active) : null;
    changed.forEach((p) => {
      $(p).innerHTML = html[PAGES.indexOf(p)];
      this._rove($(p));
      // Each "?" named with its card's title, so a list of buttons tells them apart.
      $(p).querySelectorAll(".card > h2 + .help").forEach((b) => {
        const h = b.previousElementSibling;
        b.setAttribute("aria-label", `${t.helpTitle}: ${(h.querySelector("span") ?? h).textContent}`);
      });
    });
    this._html = html;
    // How to read each card leaves out the lines for marks it does not draw now (no forecast, no battery charge,
    // no export price): a line about a mark nobody can find only puzzles.
    const noSoc = !data.batt || data.now.soc === null, sell = presentHour(data.ahead, Date.now())?.sell ?? data.price.sell;
    const off = {
      battery: data.outlook?.inHour ? [] : ["helpGain", "helpUse", "helpRange", "helpRise"],
      today: [...(data.outlook ? [] : ["helpTodayGhost", "helpLikely"]), ...(data.usualToday ? [] : ["helpTodayUsual"])],
      battday: [...(data.outlook ? [] : ["helpBattDayGhost", "helpBattDayAhead"]), ...(noSoc ? ["helpBattDayLine", "helpBattDayAhead", "helpBattDayFloor"] : [])],
      payback: data.outlook || data.usualToday ? [] : ["helpPaybackLeft"],
      share: data.batt ? [] : ["helpShareBatt"],
      prices: data.sends && sell != null ? [] : ["helpPricesSell"],
    };
    this.shadowRoot.querySelectorAll("dialog.read :is(li,.pair)").forEach((el) => {
      const gone = off[el.closest("dialog").dataset.card] ?? [];
      el.hidden = [...el.querySelectorAll("[data-t]")].some((x) => gone.includes(x.dataset.t));
    });
    // Pages come back after an error message; Money only with something to show (a price).
    PAGES.forEach((p, i) => { $(p).hidden = this._tabs[i].hidden = !html[i]; });
    if (focused) focusTarget($(focusedPage), focused)?.focus({ preventScroll: true });
  }
}

// The sky's colours as colours, so they can glide (see :host's transition). Registered for the whole page,
// as an @property inside a shadow root is ignored, under names nothing else in Home Assistant uses
// (window.CSS: CSS here is the stylesheet).
for (const i of [1, 2, 3]) try { window.CSS.registerProperty({ name: `--sv-sky${i}`, syntax: "<color>", inherits: true, initialValue: "transparent" }); } catch (e) { /* registered already, by an older copy of this file */ }

// A tab left open across an update loads the new version beside the old one: keep the old
// element until the page is refreshed instead of throwing.
if (!customElements.get("solar-view")) customElements.define("solar-view", SolarView);
export { STRINGS, LANGUAGES, loadLanguage, formats, entitiesFrom, clockOf, totals, ring, SKY, skyAt, dawnOf, greyOf, moonPhase, paybackLeft, yearKeys, shareRing, paybackCard, socDay, moneyHtml, battDayCard }; // for the checks in the preview harness

/*
 * Most icons in solar-view.js are taken from Lucide (https://lucide.dev): sun, cloud, cloud-sun,
 * cloud-rain (drops slanted), plug, zap, chart-column, coins, circle-question-mark, washing-machine,
 * triangle-alert and clock. The moon, battery, house and tick are drawn by this project.
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * ---
 *
 * The Lucide icon clock is derived from the Feather project.
 *
 * The MIT License (MIT) (for the icons listed above)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
