/* Solar page in plain words: a Home Assistant custom panel (panel_custom in configuration.yaml).
   Home Assistant sets `hass` on the element, so login, live states and language come for free.
   Served WITHOUT login, under /hacsfiles/ (HACS) or /local/ (copied by hand): never put a secret here.
   /local/ is cached hard: there, bump ?v= in configuration.yaml after every edit of any file. /hacsfiles/ tells the browser not to cache.

   Files: this one (rules, logic, drawing, the element), core.js (time, numbers and text helpers shared by all),
   format.js (numbers, money and dates as written), config.js (the panel config and the entities to read), forecast.js (the day simulation and what follows from the
   forecast), strings-en.js and one strings-xx.js per language (every text), styles.js (the CSS).
   Sections here: entities, rules, sky, parts, logic, data, drawing, pages, element. */

// ---- Entities (which ones: config.js) ----
const SUN = "sun.sun";
// The charts and lists the arrow keys move along, each one Tab stop (see _rove).
const ROVE = ":is(ul.days,ol.week,ol.year,ol.hours24,svg.cols)";
const ENERGY = ["solarKwh", "batteryKwh", "chargeKwh", "gridImportKwh", "gridExportKwh", "loadKwh"];
const PARTS = [...ENERGY, "costMoney", "earnedMoney"]; // everything summed from the statistics
const zero = () => Object.fromEntries(PARTS.map((k) => [k, 0])); // every part at 0, to add into
const WATTS = { W: 1, kW: 1e3, MW: 1e6 };

// ---- Rules (tune here) ----
const POOR_SHARE = 0.55;      // a forecast for today under this share of a usual day is a poor day
const BETTER_TIMES = 1.5;     // tomorrow must beat today by this factor before saying "wait for tomorrow"
const LASTS_MIN_H = 0.5;      // "enough until" is only shown from this many hours up to LASTS_MAX_H
const TRIM_MIN = 5;       // an hour of the usual day's sun with this many days or more leaves out its lowest and highest
const PARTIAL_SHARE = 0.75; // a solar forecast day with fewer hours than this share of its fullest day's counts as not forecast
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
// Battery wear (see wearOf): a warning below this state of health, or this many years after the battery
// was installed (most warranties end at 10).
const WEAR_HEALTH_PCT = 70;
const WEAR_YEARS = 9.5;
const MACHINE_DAYS = 90;    // a machine's runs are looked for in this many days of hour rows
const FIVE_MIN_DAYS = 10;   // and its lengths in this many days of 5 minute rows (what Home Assistant keeps by default)
const PRICE_DAYS = 28;      // a tariff sensor's band prices are learned over this many days

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

// ---- Parts: helpers, texts and stylesheet live in their own files ----
// They must load with this file's own ?v=, or under /local/ the browser keeps stale copies. All start here,
// in one wave: a file's own import of a sibling (forecast.js of core.js) then finds it already loading.
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
  (e) => { failedLanguages.add(code); console.warn("solar-view: the texts for", code, "did not load", e); });
// The first language is guessed, so its file comes with the others: this device's choice in the gear, else
// the page's language, which Home Assistant sets to the viewer's. A wrong guess costs one file; _render
// then loads the right one.
const supported = (l) => [l, l.split("-")[0]].find((c) => Object.hasOwn(LANGUAGES, c));
let guess = "";
try { guess = localStorage.getItem(LANGUAGE_KEY) ?? ""; } catch (e) { /* no storage */ }
guess = supported(guess) ?? supported(document.documentElement.lang || navigator.language || "") ?? "en";
const [, , { CSS }, { findForecast, forecastOf, lookAhead, SOLAR_SPREAD, efficiencyOf, moneySoFar, machineOf, bandOf, bandPrices },
  { MINUTE, FIVE_MIN, HALF_HOUR, HOUR, DAY, NOON, FULL_SOC, LASTS_MAX_H, clockOf, hourStart, shiftKey, shiftMonth, daysIn, yearKeys,
    dayHours, num, numberOrEntity, stateNum, sumKnown, clamp01, pct, say, cap, esc, warnOnce }, { formats, hourCycle },
  { BATTERY_FLOOR_SOC, USUAL_MIN, readConfig, requiredIds, optionalIds }] = await Promise.all([
  english, loadLanguage(guess), import(`./styles.js${version}`), import(`./forecast.js${version}`), import(`./core.js${version}`),
  import(`./format.js${version}`), import(`./config.js${version}`)]);

// ---- Logic (pure) ----
// "go": spare sun now: sun over the house's use while the battery is nearly full, or there is no charge
// reading (until then the sun is filling the battery), or sending to the grid with a nearly full battery
// (a few watts sent out by a house without one would not run a washing machine).
// "soon": spare sun now, but the forecast says it fades within 3 hours (a cycle would run into it).
// Not with a nearly full battery, which carries the cycle to its end: so only without a charge reading.
// "low": the battery word is low or empty (see batteryWord) and there is no real sun, or the grid helps.
// "wait": today's forecast is poor against a usual day here (the usual day's sun; without one, the
// average of the days with sun among the last 7), and tomorrow's is clearly better.
// "later": no spare sun now, but the next 3 hours are forecast to be clearly sunnier.
function advice(n, forecast, daytime, word) {
  const high = isHigh(word);
  if ((n.solarW - n.loadW > SURPLUS_W && (high || !word)) || (high && n.gridExportW > EXPORT_W))
    return !high && forecast && forecast.fade.now >= FADE_MIN_W && forecast.fade.next < forecast.fade.now * FADE_SHARE ? "soon" : "go";
  if (isLow(word) && (n.solarW < LOW_SOLAR_W || n.gridImportW > IMPORT_W)) return "low";
  if (daytime && forecast && forecast.tomorrow !== null && forecast.usual !== null
    && forecast.today < forecast.usual * POOR_SHARE && forecast.tomorrow >= forecast.today * BETTER_TIMES && forecast.tomorrow > forecast.today) return "wait";
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

// Whether the battery nears its end, or null. A state of health sensor (`health` in %, Infinity without
// one) alone decides when it reads; else the years since `batt.since`.
function wearOf(batt, health, now) {
  if (health !== Infinity) return health < WEAR_HEALTH_PCT ? { kind: "health", p: Math.round(health) } : null;
  const years = batt.since ? (now - Date.parse(batt.since)) / (365.25 * DAY) : 0;
  return years >= WEAR_YEARS ? { kind: "age", y: Math.floor(years) } : null;
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
function withOwnAdvice(strings, cfg, lang) {
  const own = cfg.advice?.[lang];
  if (!own) return strings;
  const t = { ...strings };
  for (const [name, lines] of Object.entries(own)) {
    const key = "advice" + name[0].toUpperCase() + name.slice(1);
    // An empty YAML entry arrives as null.
    const clean = [].concat(lines).filter((s) => s != null).map(String).filter((s) => s.trim());
    if (!Array.isArray(strings[key])) warnOnce(`advice.${lang}.${name}: no such pool (see Your own advice lines in docs/setup.md)`);
    else if (clean.length) t[key] = cfg.adviceReplace ? clean : [...strings[key], ...clean];
  }
  return t;
}

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
  const h = ((until ?? now) - now) / HOUR;
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
const hourIndex = (ahead, now) => ahead?.hours.findIndex((h) => h.t <= now && now < h.t + HOUR) ?? -1;
// That hour, from a fresh sensor only: the forecast the page builds has no cloud, rain or prices.
const presentHour = (ahead, now) => (ahead?.from === "sensor" ? ahead.hours[hourIndex(ahead, now)] : undefined);
// The first weather entity, by id. Looked for again only when it goes, or after a minute (one added that
// sorts first): every id in the house is a long list to go through on each state change.
let weatherId, weatherAt = 0;
function weatherOf(hass) {
  if (!hass.states[weatherId] || Date.now() - weatherAt > MINUTE) {
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
const cloudNow = (ahead, coverage, now) => (ahead?.from === "sensor" ? presentHour(ahead, now)?.cloud : num(coverage));
// Snow now: only the weather entity knows it (the sensor has no snow).
const snowing = (state) => ["snowy", "snowy-rainy"].includes(state);
// What covers the sun or moon icon this hour, by the sky's thresholds: "snow", "rain", "overcast" (cloud
// from 90 %), "partly" (50 to 90 %) or "" (clear, or no cloud known).
const coverOf = (cloud, rain, snow = false) => (snow ? "snow" : rain ? "rain" : cloud >= CLOUD_GREY_FULL ? "overcast" : cloud >= CLOUD_GREY_FROM ? "partly" : "");
// The moon's phase in 8 steps (0 new, 2 first quarter, 4 full, 6 last quarter), from a known new moon
// and the mean length of a lunar month.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14), LUNAR_DAYS = 29.530588853;
const moonPhase = (ms) => Math.round(((((ms - NEW_MOON) / DAY / LUNAR_DAYS) % 1) + 1) % 1 * 8) % 8;

// ---- Data ----

// Statistics rows summed into buckets (`keyOf` gives a row's bucket): Map of key to { solarKwh, ... }.
// A part is known only when every meter it sums has a valid row for every energy interval of the bucket;
// else it is null (unknown), never a partial sum. A part with no meter is 0 for energy (nothing to
// count) and null for money (nothing on record: the price stands in, see moneyHtml). Minutes no meter has a
// row for are not looked for: a meter that only counts up puts what it counted while unavailable (a restart,
// a cloud integration offline) into its first row after, so the sum is still whole. A meter added later (a
// second inverter) did not exist before its first row: see missingOk.
function statisticsBuckets(res, src, keyOf) {
  const buckets = new Map(), energyIds = new Set(ENERGY.flatMap((part) => src[part])), first = firstRows(res, src);
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
      const has = (id, s) => b.meters.get(id)?.valid.has(s);
      // A meter with no row in the bucket counts only when the bucket has energy intervals, all excused.
      const complete = ids.every((id) => { const m = b.meters.get(id); return !m?.invalid && (m?.valid.size || b.starts.size) && [...b.starts].every((s) => has(id, s) || missingOk(ids, id, s, first, has)); });
      value[part] = complete ? ids.reduce((s, id) => s + (b.meters.get(id)?.sum ?? 0), 0) : null;
    }
    return [key, value];
  }));
}
// Each meter's first row in `res` (Infinity without one).
function firstRows(res, src) {
  const first = {};
  for (const id of PARTS.flatMap((part) => src[part])) first[id] = (res[id] || []).reduce((a, r) => Math.min(a, r.start), Infinity);
  return first;
}
// A meter with no row at `start` counts as 0 there when its rows start later (it was added later, as a second
// inverter) and another meter of the same part (`ids`) has one: that part was counted. A meter missing a row
// after its first one, a meter with no rows at all (misnamed, never recorded), or the only meter of its part
// leaves the part unknown. `has(id, start)`: a valid row.
// ponytail: the first row is the first in the rows asked for, so a meter down at their start also counts as 0
// there; ask Home Assistant for each meter's first row if that ever matters.
const missingOk = (ids, id, start, first, has) => start < first[id] && first[id] < Infinity && ids.some((other) => other !== id && has(other, start));

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
// behind it. An hour some sensor has no row for is skipped: its share would be missing (but see missingOk).
// machineW: the machines' own runs (`machineRows`, sensor id to hour rows) at each hour, inside house use;
// only the machine advice takes them out, as it adds each run where it plans it. spread: the whole days'
// sun and use at their 25th and 75th percentile over their mean ([1, 1] with too few), the page's own
// forecast's low and high. scale(t): how much more or less sun the hour starting at `t` gets in clear sky than
// that hour of the usual days did, from Home Assistant's location (`src.geo`, [lat, lon]), so the usual day follows
// the season: in autumn each day has less sun than the days before it. 1 without a location or at night.
function usualDay(res, src, clock, machineRows = {}) {
  const parts = ENERGY.filter((k) => src[k].length), ids = parts.flatMap((k) => src[k]), first = firstRows(res, src);
  const hours = new Map();
  for (const part of parts) for (const id of src[part]) {
    // A row after a missing one (not a sensor's first) is the recorder catching up: all the hours it missed
    // land in it. Its hour is left out.
    const rows = res[id] || [], had = new Set(rows.map((r) => r.start)), firstStart = Math.min(...had);
    for (const r of rows) {
      if (!hours.has(r.start)) hours.set(r.start, { ids: new Set(), ...zero() });
      const h = hours.get(r.start);
      if (r.start > firstStart && !had.has(r.start - HOUR)) h.catchUp = true;
      if (!Number.isFinite(r.change)) continue;
      h.ids.add(id);
      h[part] += Math.max(0, r.change || 0);
    }
  }
  const machine = new Map();
  for (const rows of Object.values(machineRows)) for (const r of rows ?? []) if (r.change > 0) machine.set(r.start, (machine.get(r.start) ?? 0) + r.change);
  const whole = (start, h) => parts.every((part) => src[part].every((id) => h.ids.has(id) || missingOk(src[part], id, start, first, (other) => h.ids.has(other))));
  const list = () => Array.from({ length: 24 }, () => []);
  const load = list(), bal = list(), sun = list(), mach = list(), sky = list(), days = new Map();
  const [lat, lon] = src.geo ?? [], geo = Number.isFinite(lat) && Number.isFinite(lon);
  for (const [start, h] of hours) if (!h.catchUp && whole(start, h)) {
    const c = clock(start), b = balanceKwh(h);
    load[c.hour].push(houseKwh(h, src));
    bal[c.hour].push(b);
    sun[c.hour].push(h.solarKwh);
    if (geo) sky[c.hour].push(clearSky(start, lat, lon));
    mach[c.hour].push(machine.get(start) ?? 0);
    const d = days.get(c.key) ?? days.set(c.key, { n: 0, sun: 0, use: 0 }).get(c.key);
    d.n++; d.sun += h.solarKwh; d.use += b;
  }
  if (!ids.length || sun.some((v) => v.length < USUAL_MIN)) return null;
  const sorted = (v) => [...v].sort((x, y) => x - y), sumOf = (v) => v.reduce((s, x) => s + x, 0);
  // kWh in one hour is the average kW over it. balanceW is house use as the forecast counts it (standby
  // included), which differs from loadW only when the owner named a load sensor. The sun, with TRIM_MIN
  // or more hours behind it, leaves out each hour's lowest and highest: one odd row (a recorder catching
  // up) cannot carry it. Use is not trimmed: an oven or a car charged now and then is real energy.
  const avg = (lists, trim = false) => lists.map((v) => { const s = trim && v.length >= TRIM_MIN ? sorted(v).slice(1, -1) : v; return Math.round((sumOf(s) / s.length) * 1000); });
  // A day counts whole with 23 hours or more (a 23 hour day is whole too).
  const fullDays = [...days.values()].filter((d) => d.n >= 23);
  const at = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const spreadOf = (v) => { const s = sorted(v), m = sumOf(s) / s.length; return s.length >= USUAL_MIN && m > 0 ? [at(s, 0.25) / m, at(s, 0.75) / m] : [1, 1]; };
  // Hour rows start on UTC hours: in a half hour zone (India, at :30 local) a row filed under h covers
  // h:30 to h+1:30. Each local hour takes its share of the two rows it spans, energy taken as even
  // inside an hour; nothing changes in a whole hour zone.
  const m = clock(hours.keys().next().value).minute / 60;
  const local = (w) => (m ? w.map((v, h) => Math.round(v * (1 - m) + w[(h + 23) % 24] * m)) : w);
  // ponytail: the clear sky is not shifted in a half hour zone like the rest (see local); a few percent at dawn and dusk there.
  const skyW = sky.map((v) => (v.length ? sumOf(v) / v.length : 0));
  const scale = (t) => { const m = geo ? skyW[clock(t).hour] : 0; return m > 20 ? Math.min(2, clearSky(t, lat, lon) / m) : 1; };
  return { loadW: local(avg(load)), balanceW: local(avg(bal)), solarW: local(avg(sun, true)), machineW: local(avg(mach)), scale, spread: { sun: spreadOf(fullDays.map((d) => d.sun)), use: spreadOf(fullDays.map((d) => d.use)) } };
}

// Everything that comes from the statistics, as plain numbers: today, both months, this month's days,
// the usual day so far and the forecast, plus what the forecast part needs (see _lookAhead). `daily` holds
// day rows, `recent` 5 minute rows that cover today (day rows lag by up to an hour), `hourly` hour
// rows of the last `usual_days` days, `forecast` the answer of energy/solar_forecast, `monthly` month rows.
function totals(src, daily, recent, hourly, forecast, clock, now, monthly = {}, machineHours = {}) {
  const at = clock(now), today = at.key;
  const month = today.slice(0, 7), last = shiftMonth(month, -1);
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
    const length = prefix === month ? +today.slice(8) : daysIn(prefix);
    return Array.from({ length }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
  };
  const before = [7, 6, 5, 4, 3, 2, 1].map((back) => shiftKey(today, -back));
  // This month day by day, today last (from its 5 minute rows), each at noon UTC of its day: the page
  // formats these dates in UTC, so every viewer sees the same day. The rest of a day's figures show when
  // its day is picked (see productionCard), its money on Money (see moneyHtml).
  const dayOf = (key) => ({ date: Date.parse(key) + NOON, ...sum([key]) });
  const monthDays = Array.from({ length: +today.slice(8) }, (_, i) => dayOf(`${month}-${String(i + 1).padStart(2, "0")}`));
  // The other 11 months Production shows, day by day, with only what a picked day says (see picked),
  // rounded: the copy this browser remembers stays small.
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const pastDays = Object.fromEntries(yearKeys(month).filter((k) => k !== month).map((k) => {
    return [k, Array.from({ length: daysIn(k) }, (_, i) => {
      const d = dayOf(`${k}-${String(i + 1).padStart(2, "0")}`);
      return d.none ? { date: d.date, none: true } : { date: d.date, ...Object.fromEntries(["solarKwh", "loadKwh", "gridImportKwh", "gridExportKwh"].map((p) => [p, r2(d[p])])) };
    })];
  }));
  // The last 7 full days that have numbers: the standby, and the usual sun without a usual day.
  const full = before.filter((key) => days.has(key)).map((key) => sum([key]));
  // What flows in and out but the load sensor never sees, a day on average.
  const known = full.filter((d) => Number.isFinite(balanceKwh(d)) && Number.isFinite(d.loadKwh));
  const gap = known.reduce((s, d) => s + balanceKwh(d) - d.loadKwh, 0) / (known.length || 1);
  const sunny = full.filter((w) => w.solarKwh > 0);
  // Each value goes to the hour its time falls in, as the Energy dashboard draws it, keyed by that hour's
  // start: the repeated hour of the night the clocks go back is two hours, not one.
  const wh = {}, whHour = {};
  // Level usual_days leaves the Energy settings' solar forecast out: its sun is the usual day's.
  for (const f of Object.values(src.level === "usual_days" ? {} : forecast || {})) for (const [time, v] of Object.entries(f.wh_hours || {})) {
    const t = Date.parse(time), c = clock(t), hour = hourStart(t, clock);
    wh[c.key] = (wh[c.key] || 0) + v;
    whHour[hour] = (whHour[hour] || 0) + v;
  }
  // A day the solar forecast covers only in part (fewer hours than PARTIAL_SHARE of its fullest day's, as
  // the last day of a forecast cut at noon) is left to the usual day, on every card that looks ahead.
  // Today never is: a forecast may list only the hours still to come. But a today covered in part is no
  // total to call poor, so the "wait" advice then has no tomorrow to wait for.
  const hoursOf = {};
  for (const t of Object.keys(whHour)) { const k = clock(+t).key; hoursOf[k] = (hoursOf[k] || 0) + 1; }
  const most = Math.max(0, ...Object.values(hoursOf)), whole = (k) => hoursOf[k] >= most * PARTIAL_SHARE, fullDay = (k) => k === today || whole(k);
  const solarWh = Object.fromEntries(Object.entries(whHour).filter(([t]) => fullDay(clock(+t).key)));
  // Level none predicts nothing: no usual day either (no page forecast, no use line on the coming days, no
  // payback time left).
  const usual = src.level === "none" ? null : usualDay(hourly, src, clock, machineHours);
  const tomorrow = shiftKey(today, 1);
  // The sun forecast of this hour, and the average of the next 3.
  const fcHour = (i) => whHour[hourStart(now + i * HOUR, clock)] || 0;
  const fade = { now: fcHour(0), next: (fcHour(1) + fcHour(2) + fcHour(3)) / 3 };
  // The usual day's kWh by now and in all, over today's real hours: a 23 or 25 hour day has as many.
  const hours = dayHours(now, clock);
  const usualBy = (w, k = () => 1) => {
    let by = 0, all = 0;
    for (const t of hours) { const v = w[clock(t).hour] * k(t); all += v; by += v * clamp01((now - t) / HOUR); }
    return [by / 1000, all / 1000];
  };
  // The usual day's sun on each day after today to the month's end, kWh by date, as the season moves it.
  const usualSunDays = {};
  if (usual) for (let t = hours.at(-1) + HOUR; clock(t).key.startsWith(month); t += HOUR)
    usualSunDays[clock(t).key] = (usualSunDays[clock(t).key] ?? 0) + (usual.solarW[clock(t).hour] * usual.scale(t)) / 1000;
  return {
    today: sum([today]), lastMonth: sum(of(last)), monthDays, pastDays, monthKey: month, // "2026-10": this month
    // Every finished month on record before this one, oldest first, as [key, kWh]: payback.
    // This month comes from the day rows (as `month`), which the month rows lag.
    months: [...byDay(monthly, src, clock)].map(([key, d]) => [key.slice(0, 7), { ...d, loadKwh: houseKwh(d, src) }])
      .filter(([key]) => key < month).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    usualToday: usual && { used: usualBy(usual.loadW) },
    month: sum(of(month)),
    // `tomorrow` and `usual` are null when not known: only the "wait" advice needs them.
    // `usual` is the usual day's sun, as the rest of the page counts it; without a usual day, the mean of the
    // days with sun among the last 7. Level none predicts nothing: no "soon", "later" or "wait" advice either.
    forecast: src.level !== "none" && today in wh ? { fade, today: wh[today] / 1000, tomorrow: tomorrow in wh && whole(tomorrow) && whole(today) ? wh[tomorrow] / 1000 : null,
      usual: usual ? usualBy(usual.solarW, usual.scale)[1] : sunny.length ? sunny.reduce((a, w) => a + w.solarKwh, 0) / sunny.length : null } : null,
    msToMidnight: ((23 - at.hour) * 60 + 60 - at.minute) * MINUTE,
    // For the forecast part only (readData leaves them out): the solar forecast by hour, the usual day,
    // the battery round trip, the inverter's standby (the owner's standby_w, else worked out from a
    // load sensor, else 0).
    todayHours, solarWh, usual,
    // Where today's sun so far ends: the end of the 5 minute rows of the solar sensor that lags most (the
    // sum so far reaches no further). -Infinity while one has none: today's sun then scales nothing.
    sunUntil: src.solarKwh.length ? Math.min(...src.solarKwh.map((id) => Math.max(...(recent[id] ?? []).map((r) => r.start)))) + FIVE_MIN : null,
    // The solar forecast's kWh of each whole day after today, by date (Production's days to come, see monthAhead,
    // and the coming days without the sensor), and the usual day's sun in kWh (null without a usual day).
    sunDays: Object.fromEntries(Object.entries(wh).filter(([k]) => k > today && fullDay(k)).map(([k, v]) => [k, v / 1000])),
    usualSun: usual && usual.solarW.reduce((a, v) => a + v, 0) / 1000, usualSunDays,
    efficiency: efficiencyOf(kwhOf("batteryKwh"), kwhOf("chargeKwh"), battDays.length),
    standbyW: src.standbyW ?? (src.loadKwh.length && gap >= STANDBY_MIN_KWH ? (gap / 24) * 1000 : 0),
  };
}

// Everything the page shows, as one plain object: live states from `hass`, the rest from
// `stats` (see totals). `src` says which entities to read (see readConfig). `lookedAhead` holds the
// forecast and what follows from it (see _lookAhead): { ahead, outlook, bands }.
function readData(hass, src, stats, lookedAhead = {}) {
  const watts = (ids) => ids.reduce((sum, id) => sum + (stateNum(hass, id) ?? 0) * (WATTS[hass.states[id]?.attributes?.unit_of_measurement] ?? 1), 0);
  const raw = watts(src.solarW);
  const solar = raw < SOLAR_NOISE_W ? 0 : raw;
  const batt = watts(src.battW);   // positive: discharging
  const grid = watts(src.gridW);   // positive: importing
  const socs = src.soc.map((id) => [stateNum(hass, id), src.socWeight[id] || 1]).filter((s) => s[0] !== null);
  const sun = hass.states[SUN];
  const elevation = parseFloat(sun?.attributes?.elevation); // NaN while sun.sun has no value
  // Text is an entity id, unless it is a number typed as text.
  const price = (v) => numberOrEntity(v, hass);
  // The forecast's inputs stay out: they are not drawn, and the copy this browser remembers stays small.
  const { msToMidnight, todayHours, solarWh, usual, efficiency, standbyW, socDay, fixedMonths, machines, priceRows, gridMonth, sunUntil, ...rest } = stats;
  const round = (v, to) => (Number.isFinite(v) ? Math.round(v * to) / to : null), socAt = new Map(socDay);
  const now = Date.now(), weather = weatherOf(hass), wx = weather?.state, cloud = cloudNow(lookedAhead.ahead, weather?.attributes?.cloud_coverage, now), rain = raining(lookedAhead.ahead, wx, now), snow = snowing(wx);
  return {
    now: {
      solarW: solar,
      loadW: src.loadW.some((id) => stateNum(hass, id) !== null) ? watts(src.loadW) : Math.max(0, solar + batt + grid),
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
    ahead: lookedAhead.ahead ?? null, outlook: lookedAhead.outlook ?? null,
    // The tariff's bands and their prices ({ type, prices: { f1, ... } }), or null.
    bands: lookedAhead.bands ?? null,
    // No battery at all: its card, its place in the flow and its rows are left out.
    batt: src.battW.length || src.soc.length ? src.batt : null,
    wear: src.battW.length || src.soc.length
      ? wearOf(src.batt, Math.min(...src.healthPct.map((id) => stateNum(hass, id) ?? Infinity)), now) : null,
    sends: src.exportMaxKw !== 0, // export is on: what is sent, the sell price and what it earned show

    payback: src.payback,
    lat: hass.config?.latitude ?? null, // payback's seasons
    // The bill's fixed part: its month means (see fixedAt), and its value now.
    billFixed: { months: fixedMonths ?? {}, now: numberOrEntity(src.billFixed, hass) },
    // Today by the hour, oldest first: [hour start, mean charge %, then in kWh what the battery took in and
    // gave back, the sun made, the house used and the grid gave, and the house's use as the balance (as the
    // forecast counts it)], rounded; null where the statistics have no row.
    battDay: [...new Set([...socAt.keys(), ...Object.keys(todayHours).map(Number)])].sort((a, b) => a - b).map((t) => {
      const p = socAt.get(t), h = todayHours[t];
      return [t, p === undefined ? null : round(p, 10), ...["chargeKwh", "batteryKwh", "solarKwh", "houseKwh", "gridImportKwh", "loadKwh"].map((k) => (h ? round(h[k], 100) : null))];
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
  // Today in Home Assistant's time zone, as the loaded page counts it, not the browser's.
  const now = Date.now(), clock = clockOf(hass.config?.time_zone), today = clock(now).key, month = today.slice(0, 7);
  const hours = dayHours(now, clock).filter((t) => t <= now);
  return {
    ...fresh,
    now: { solarW, loadW: 400, gridImportW: solarW || battery ? 0 : 400, gridExportW: solarW && !battery ? 1100 : 0,
      batteryChargeW: solarW && battery ? 1100 : 0, batteryDischargeW: solarW || !battery ? 0 : 400, soc },
    // A month nearly always sends something to the grid, a single day often does not.
    // Whole months on record, so no "numbers for some days" line shows while loading.
    today: day(8, 6), month: day(200, 190, 5), lastMonth: day(400, 390, 10),
    usualToday: null, monthKey: month,
    // Whole days, not the present moment: a date that moved would redraw the skeleton on every update.
    monthDays: Array.from({ length: +today.slice(8) }, (_, i) => ({ ...day(12, 14), date: Date.parse(`${month}-${String(i + 1).padStart(2, "0")}`) + NOON })),
    batt: battery ? { kwh: 10, floor: src?.batt.floor ?? BATTERY_FLOOR_SOC } : null, sends: src?.exportMaxKw !== 0, forecast: null,
    price: { buy: src?.price.buy != null ? 0.25 : null, sell: src?.price.sell != null ? 0.08 : null }, payback: src?.payback ?? null,
    // The hours done since midnight and this one so far (its figures show under the charts, with no charge mean
    // until it ends), a day the clocks change too (see battDayCard).
    battDay: hours.map((t, i) => [t, i < hours.length - 1 ? 50 : null, 0, 0, 0.5, 0.5, 0]),
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
// The whole-page messages: the inverter not answering (a crossed out wifi), and setting up (the sun).
// The help button's "?" in a circle, and the tab bar's icons (24 x 24, drawn with the text colour).
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
// How to read each card: one line per mark, its drawing and its text. The battery's has its two
// example rings above the lines (see the element).
const READ = {
  battery: ["solid", "gain", "use", "range", "low"].map((k) => [`<i class="${k}"></i>`, `help${k[0].toUpperCase() + k.slice(1)}`]),
  days: [[sw("pill", "--sun"), "helpDaysPill"], [sw("mark", "--ink"), "helpDaysUse"], [wxIcon("partly"), "helpDaysSky"]],
  daily: [[sw("solid", "--sun"), "helpProdMonths"], [sw("ghost", "--sun"), "helpProdEnd"], [sw("line", "--sun"), "helpWeekBar"], [sw("lineAhead", "--sun"), "helpProdAhead"],
    [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpWeekPick"]],
  share: [[sw("arc", "--sun"), "helpShareSun"], [sw("arc", "--batt"), "helpShareBatt"], [sw("arc", "--grid"), "helpShareGrid"],
    [`<b class="sw-num">%</b>`, "helpShareNum"], ["", "helpShareTotal"], ["", "helpShareAhead"], ["", "helpShareAheadFc"]],
  recent: [[sw("line", "--sun"), "helpRecentBar"], ["", "helpRecentSold"], [sw("lineAhead", "--sun"), "helpRecentAhead"], [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpRecentPick"]],
  payback: [[sw("arc", "--sun"), "helpPaybackArc"], ["", "helpPaybackCost"], ["", "helpPaybackLeft"]],
  battday: [[sw("line", "--sun"), "helpBattDayBars"], [sw("lineAhead", "--sun"), "helpBattDayGhost"], [sw("line", "--batt"), "helpBattDayLine"], [sw("lineAhead", "--batt"), "helpBattDayAhead"], [sw("usual", "--low"), "helpBattDayFloor"], [sw("dotPick", "--batt"), "helpBattDayPick"]],
  table: [[sw("solid", "--batt"), "helpBalMonths"], [sw("ghost", "--batt"), "helpBalEnd"], [sw("arc", "--grid"), "helpBalSplit"], ["", "helpBalNet"]],
  prices: [[sw("buy", "--grid"), "helpPricesBuy"], ["", "helpPricesBands"], [sw("sell", "--sent"), "helpPricesSell"], ["", "helpPricesRates"]],
};
// A three-quarter ring, open at the bottom like a car gauge, from 0 at the lower left to 1 at the lower
// right: ringAt is the point at u, ringArc the arc on to u1. ring() is solid to `frac` (a fraction of the
// whole ring; NaN reads as an empty ring).
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
// Round steps for chart gridlines (see lineGrid).
const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
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
    // The grid already in the headline needs no line of its own.
    : n.gridImportW > IMPORT_W ? (names.includes("grid") ? "" : t.subGrid)
    : exporting ? t.subExport
    : charging ? t.subCharge
    // The battery already in the headline needs no line of its own.
    : discharging && !names.includes("battery") ? t.subBattery : "";
  const batt = data.batt;
  const word = n.soc === null ? "" : batteryWord(n.soc, batt ? batt.floor : 0);
  const stored = batt?.kwh ? f.kwh(n.soc / 100 * batt.kwh) : "";
  const sunCharging = charging && !gridCharging(n);
  const now = Date.now();
  const lastsH = batt && data.outlook ? outlookLastsH(n, batt, data.outlook.lastsUntil, now) : 0;
  // Rounded to the half hour of Home Assistant's clock (a zone may be 45 minutes off UTC's): the estimate is
  // rough, and the text stays still between updates.
  const half = (ms) => { const h = hourStart(ms, clock); return h + Math.round((ms - h) / HALF_HOUR) * HALF_HOUR; };
  const until = lastsH && lastsH !== Infinity ? f.time(new Date(half(now + lastsH * HOUR))) : "";
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
  // At its floor at night the battery rests as it should, with the grid carrying the house: no alarm colours.
  const rests = !daytime && word === "empty" && Math.round(n.soc) >= (batt ? batt.floor : 0);
  const battColor = isLow(word) && !rests ? "--low" : "--batt";
  // The washer line alone says when to run something: beside it, the card keeps to the house and the battery.
  const plain = advice(n, data.forecast, daytime, word), timing = data.outlook?.best && ["go", "soon", "later", "wait"].includes(plain);
  const kind = outlookAdvice(timing ? "ok" : plain, data.outlook, word, sunCharging, daytime, evening, lastsH);
  const lines = advicePool(t, kind, word, sunCharging, daytime);
  // One line per calendar day, so it stays put between redraws and changes tomorrow.
  const adviceText = lines[day % lines.length];
  // The battery in an hour, from the outlook's three runs. They start from the floor at the lowest, so
  // a reading under it moves them by the same amount. Its likely range only from the sensor's forecast.
  const p = Math.round(n.soc), ahead = n.soc !== null && batt?.kwh && data.outlook?.inHour;
  const hour = ahead && ahead.map((v) => v + n.soc - Math.min(100, Math.max(n.soc, batt.floor)));
  const soon = hour && Math.abs(hour[1] - n.soc) >= SOON_PCT ? hour[1] : null;
  const range = soon !== null && data.ahead?.from === "sensor" && hour[2] - hour[0] >= SOON_PCT ? [hour[0], hour[2]] : null;
  const ringName = soon === null ? say(stored ? t.hRing : t.hRingNoSize, { p, k: stored })
    : say(range ? t.hRingSoon : t.hRingSoonMid, { p, a: Math.round(soon), b: Math.round(range?.[0]), c: Math.round(range?.[1]) });
  return `
    <header><h1${loading ? ` data-wait="${t.loading}"` : ""}>${sentence}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</header>
    <div class="flowbox">${flowSvg(n, sky, night, t, sub ? `${sentence}. ${sub}` : sentence, hints, !!batt, battColor, data.weather.cover, data.moon)}</div>
    ${data.wear ? `<section class="card wear" aria-label="${t.wearTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${ADVICE_ICON.low}</svg></span>
      <p>${esc(say(t["wear" + data.wear.kind[0].toUpperCase() + data.wear.kind.slice(1)], data.wear))}</p>
    </section>` : ""}
    <section class="card advice${rests ? " rest" : ""}" data-kind="${kind}" aria-label="${t.adviceTitle}">
      <span class="tile"><svg viewBox="0 0 24 24" aria-hidden="true">${(kind === "go" && GO_ICON.get(adviceText)) || (rests ? ADVICE_ICON.ok : ADVICE_ICON[kind])}</svg></span>
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
      ${bestLine(data.outlook, t, f, clock)}
    </section>`}${n.soc === null && data.outlook?.best ? `<section class="card machines">${bestLine(data.outlook, t, f, clock)}</section>` : ""}${comingDaysCard({ data, t, f, clock })}`;
}

// Round numbers for what is still to come: one decimal under 10, whole above.
const near = (f, v) => f.num(v >= 10 ? Math.round(v) : v);
// The weather words of an icon (see coverOf): "" is clear.
const wxWord = (t, cover) => ({ "": t.wxSunny, partly: t.wxPartly, overcast: t.wxCloudy, rain: t.wxRain }[cover]);

// When to start each movable machine (see advise in forecast.js), and why: on the battery card, else (no
// charge reading) on a card of its own, named by its type's word.
const bestLine = (o, t, f, clock) => (o?.best ?? []).map((b) => {
  const name = esc(t[b.type]);
  const what = b.kind === "wait" ? say(t.adviseWait, { n: name, a: `${f.num(Math.round(b.kw * 10) / 10)} kW` })
    : b.kind === "now" ? say(t.adviseNow, { n: name })
      : say(clock(b.t).key === clock(Date.now()).key ? t.adviseAt : t.adviseTomorrow, { n: name, a: f.time(new Date(b.t)) });
  const why = b.why && say(t[`why${cap(b.why)}`], { a: b.band?.toUpperCase() });
  const icon = b.kind === "wait" ? ADVICE_ICON.wait : APPLIANCE[b.type === "dishwasher" ? "dishes" : b.type] ?? ADVICE_ICON.go;
  return `<div class="best" data-kind="${b.kind}"><span class="tile" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><p>${what}${why ? `<small>${why}</small>` : ""}</p></div>`;
}).join("");

// ENERGY: today, hour by hour, this month's days.
// Power origin: the ring of where the power came from, and what the sun made and sent under it. An outlook
// (a forecast with house use, no battery of unknown size) adds two small rings: the same split in an hour
// and at the end of the day.

function todayCard({ data, t, f }) {
  const d = data.today;
  // No numbers on record today (the inverter or the connection down): only that, no zeros.
  if (d.none) return `<section class="card today share">
      <h2>${t.todayNumbers}</h2>
      <p>${cap(t.noData)}</p>
    </section>`;
  const ahead = ringsAhead(data);
  return `<section class="card today share">
      <h2>${t.todayNumbers}</h2>${helpButton(t, "share")}
      ${shareRing(ahead ? onBalance(data) : data, t, f, ahead)}
    </section>`;
}

// Up to 7 days from tomorrow, from the sensor, else from the Energy settings' solar forecast beside the
// page's own forecast (as far as it reaches, SOLAR_SPREAD either way, no weather): the day, its weather (the
// day's `cloud` by the sky's thresholds, rain from RAIN_DAY_MM; none when the sensor gives no cloud), a bar
// from 0 to the likely sun with a thin line from low to high over it, and the likely figure. One track from
// 0 to the highest high (or the usual day's use, when higher), crossed by an upright line at that use, named
// over the first row as the hour charts name now.
function comingDaysCard({ data, t, f, clock }) {
  const a = data.ahead, today = clock(Date.now()).key;
  const days = (a?.from === "sensor" ? a.days : a?.from === "page" ? Object.entries(data.sunDays ?? {}).sort()
    .map(([d, v]) => ({ d, sun: [v * (1 - SOLAR_SPREAD), v, v * (1 + SOLAR_SPREAD)] })) : [])
    .filter((d) => d.d > today && d.sun?.every(Number.isFinite)).slice(0, 7);
  if (!days.length) return "";
  const use = weatherOnly(data) ? null : data.usualToday?.used?.[1], line = Number.isFinite(use) && use > 0;
  const top = Math.max(...days.map((d) => d.sun[2]), line ? use : 0, 0.1), at = (v) => Math.round(clamp01(v / top) * 1000) / 10;
  const u = line ? at(use) : 0;
  const mark = line ? `<span class="use" aria-hidden="true"></span>` : "";
  const label = line ? `<span class="now-label${u < 8 ? " start" : u > 92 ? " end" : ""}" style="--x:${u}%">${t.usualUseMark}</span>` : "";
  const rows = days.map((d, i) => {
    const cover = Number.isFinite(d.cloud) ? coverOf(d.cloud, d.rain >= RAIN_DAY_MM) : null;
    const date = new Date(Date.parse(d.d) + NOON), [lo, mid, hi] = d.sun;
    const w = cover === null ? "" : `${wxWord(t, cover)}, `;
    const name = say(near(f, lo) === near(f, hi) ? t.hDayAheadMid : t.hDayAhead, { d: f.date(date), w, a: near(f, lo), b: near(f, hi) });
    return `<li ${hint(name, "")} style="--c:${SUN_DOT}"><span>${f.weekday(date)}</span>${wxIcon(cover)}
      <span class="track"><i style="--v:${at(mid)}%"></i><b style="--a:${at(lo)}%;--b:${at(hi)}%"></b>${mark}${i ? "" : label}</span><span class="num">${near(f, mid)}</span></li>`;
  }).join("");
  return `<section class="card coming">
      <h2><span>${t.comingDays}</span> <span class="num">kWh</span></h2>${helpButton(t, "days")}
      <ul class="days${line ? " with-use" : ""}" style="--u:${u}%">${rows}</ul>
    </section>`;
}

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
// This month's days still to come and where the month should end. From the page's own forecast: tomorrow
// from the forecast's days, later days from the Energy settings' solar forecast as far as it reaches, then
// the usual day's sun. From a fresh sensor: its days' likely sun as far as they reach, then (with its house
// use) the usual day's; with weather alone the days stop there, and the month's end shows only once they
// reach it. { days: [{ date, kwh, usual }], end } (end null while a day of the month has no numbers on
// record), or null without a forecast or a day to come.

function monthAhead(data) {
  const a = data.ahead, list = data.monthDays, sensor = a?.from === "sensor";
  if (!list?.length || !(sensor || a?.from === "page" && Number.isFinite(data.usualSun))) return null;
  const [y, m] = data.monthKey.split("-").map(Number), n = daysIn(data.monthKey);
  const all = Array.from({ length: n - list.length }, (_, i) => {
    const date = Date.UTC(y, m - 1, list.length + i + 1, 12), key = new Date(date).toISOString().slice(0, 10);
    // Tomorrow's forecast is the solar forecast where it has hours, else the usual day (see forecastOf).
    const dayKwh = a.days.find((d) => d.d === key)?.sun?.[1] ?? (sensor ? null : data.sunDays?.[key]);
    if (!sensor) return { date, kwh: dayKwh ?? data.usualSunDays?.[key] ?? data.usualSun, usual: !(key in (data.sunDays ?? {})) };
    const usual = weatherOnly(data) ? null : data.usualSunDays?.[key];
    return Number.isFinite(dayKwh) ? { date, kwh: dayKwh, usual: false } : Number.isFinite(usual) && { date, kwh: usual, usual: true };
  });
  const cut = all.indexOf(false), days = cut < 0 ? all : all.slice(0, cut);
  if (sensor && !days.length && list.length < n) return null;
  const soFar = sumKnown(list.map((d) => (d.none ? null : d.solarKwh))), rest = a.left?.sun?.[1];
  return { days, end: soFar === null || cut >= 0 || !Number.isFinite(rest) ? null : soFar + rest + days.reduce((s, d) => s + d.kwh, 0) };
}

// Production: what the sun made each of the 12 months (see monthPicker), the picked month's total under
// them, then its days (see dayLine). This month at first. With a forecast (see monthAhead),
// this month's days to come are dashed on, and its bar and total say where it should end.
function productionCard({ data, t, f, pick }) {
  const cur = data.monthKey, at = yearKeys(cur).includes(pick?.dailyMonth) ? pick.dailyMonth : cur;
  const daysOf = (k) => (k === cur ? data.monthDays : data.pastDays?.[k]) ?? [];
  const solar = (d) => (d.none ? null : d.solarKwh);
  // A month with a day missing has no total: a part of it would read as the whole.
  const total = (k) => { const v = daysOf(k).map(solar); return v.length ? sumKnown(v) : null; };
  const named = (k) => (k === cur ? say(t.monthSoFar, { m: f.monthYear(k) }) : f.monthYear(k));
  const kwh = (v) => f.kwh(v >= 10 ? Math.round(v) : v);
  const sum = total(at), coming = monthAhead(data), end = coming?.end ?? null;
  // Each day's sentence as its hint, and with its date in bold under the chart: {d} comes first in it, so
  // the date sits where {d} is.
  const ahead = at === cur && coming ? coming.days.map((d) => {
    const date = f.date(new Date(d.date)), said = d.usual ? t.hDayUsual : t.hDayFc, i = said.indexOf("{d}");
    const plain = cap(say(said, { d: date, k: f.kwh(d.kwh) }));
    return [d.kwh, plain, `${plain.slice(0, i)}<b>${plain.slice(i, i + date.length)}</b>${plain.slice(i + date.length)}`];
  }) : [];
  const hintOf = (k, v) => (v === null ? `${named(k)}: ${t.noData}` : k === cur && end !== null ? say(t.prodEndHint, { m: named(k), a: kwh(v), e: kwh(end) }) : `${named(k)}: ${kwh(v)}`);
  return `<section class="card daily" data-pick="daily">
      <h2><span>${t.production}</span> <span class="num">kWh</span></h2>${helpButton(t, "daily")}
      <h3 class="chart-title">${t.prodMonths}</h3>
      ${monthPicker(t, f, cur, at, total, hintOf, "--sun", false, (k) => (k === cur ? end : null))}
      <div class="stepped total">${monthSteps(t, cur, at, (k) => cap(named(k)))}${monthTotal(cap(named(at)), [[t.prodMonths, kwh(sum), "--sun"],
        at === cur && end !== null ? [t.prodEnd, say(t.prodEndAbout, { k: kwh(end) }), "--sun", false, true] : null])}</div>
      <h3 class="chart-title"><span>${t.daily}</span> <span class="num">${cap(f.monthYear(at))}</span></h3>
      ${dayLine(t, f, at, daysOf(at), solar,
        (d, v) => (v === null ? `${f.date(new Date(d.date))}: ${t.noData}` : say(t.hDay, { d: f.date(new Date(d.date)), k: f.kwh(v) })), (d, v, lead) => picked(t, f, d, lead), pick?.daily, { live: at === cur, ahead })}
    </section>`;
}

// Today hour by hour, midnight to midnight, on two charts with one timeline (see lineGrid), each under its
// title and unit. Above, with a battery and a charge reading, its mean charge in percent (solid, broken where
// an hour has no row), where the mid run takes it until midnight (dashes), and the floor (red dashes). Below,
// a line each for what the sun made, what the house used and what the grid gave, a point an hour; solid for
// the hours done, dashed from there on, this hour with it, as the outlook's mid run expects them. What is
// still to come is shaded. One hour is picked (this one at first, see dayLine), a dot on each line, its
// figures under the charts. Nothing is drawn for an hour without a row; its sentence says so. Hidden in the
// first hour of a day with no row yet.
function battDayCard({ data, t, f, clock, pick }) {
  // With an outlook the house's use is the balance, so far as ahead (see onBalance).
  const hasOutlook = data.outlook?.hoursAhead?.length > 0;
  const b = data.batt, n = data.now, rows = (data.battDay ?? []).map((r) => (hasOutlook && r.length > 7 ? [...r.slice(0, 5), r[7], r[6]] : r));
  // Now to the 5 minutes, so the page is not redrawn every few seconds for a line that barely moves.
  const H = HOUR, now = Math.floor(Date.now() / FIVE_MIN) * FIVE_MIN;
  // The day's real hours, midnight to midnight.
  const hours = dayHours(now, clock), day0 = hours[0], N = hours.length;
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
  // Weather alone (no outlook): the sensor's sun for the hours ahead, this one's rest by its share; no use or grid.
  const sunOnly = weatherOnly(data) ? data.ahead.hours.map((h) => [h.t, h.sun[1] * clamp01((h.t + H - now) / H), null, null, null]) : [];
  const expect = new Map((data.outlook?.hoursAhead ?? sunOnly).map((e) => [e[0], e]));
  // Each hour's [made, used, grid] in kWh, and whether it is the outlook's: an hour done from its row, this
  // one its row so far plus the outlook's rest, the next ones the outlook's; null where there is neither.
  const SERIES = [["--sun", 4, 1], ["--home", 5, 4], ["--grid", 6, 3]]; // colour, place in a row, in an outlook hour
  const hourly = hours.map((ms) => {
    const r = was.get(ms) ?? null, e = ms + H > now ? expect.get(ms) : null;
    // A series the outlook leaves out (null: use and grid beside weather alone) keeps only its row.
    return r || e ? { est: !!e, v: SERIES.map(([, ri, ei]) => (r || e[ei] != null ? sumKnown([r ? r[ri] : 0, e?.[ei] ?? 0]) : null)) } : null;
  });
  const kwh = lineGrid(Math.max(...hourly.map((h) => (h ? Math.max(...h.v) : 0)), 0.1), f.num);
  // Across its hour (0 to 1): the middle, but the hour in progress at now, on the now line as the charge
  // line's dot.
  const across = (i) => (hours[i] <= now && now < hours[i] + H ? (now - hours[i]) / H : 0.5);
  const cx = (i) => ((i + across(i)) / N) * 100;
  // Solid through the hours done up to this one's dot at now, dashed from there through the outlook's; a gap
  // breaks both, and each line breaks at its own unknown hours (an hour alone between two gaps is only its dot).
  const known = (h, k) => !!h && Number.isFinite(h.v[k]);
  const lineOf = (k, dashed) => hourly.map((h, i) => {
    const open = hours[i] + H > now; // this hour or one ahead
    const use = known(h, k) && (dashed ? h.est || (open && hourly[i + 1]?.est) : !h.est || hours[i] <= now && open);
    if (!use) return "";
    // The day's first and last hour carry their level on to the chart's edge, as the charge line reaches it
    // (not the hour in progress: its dot sits at now).
    const v = y(h.v[k] / kwh.max * 100), whole = across(i) === 0.5;
    return `${known(hourly[i - 1], k) && (dashed ? true : !hourly[i - 1].est) ? "L" : !i && whole ? `M0 ${v}L` : "M"}${cx(i).toFixed(2)} ${v}${i === N - 1 && whole ? `L100 ${v}` : ""}`;
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
    const coming = e && e[4] == null ? (Number.isFinite(e[1]) ? `${say(t.hHourAheadSun, { h, a: f.kwh(e[1]) })}.` : "")
      : one(t.hHourAhead, t.hHourAheadBatt, t.hBattAhead, e && [e[1], e[4], e[3]], p === undefined ? null : Math.round(p));
    // An hour on record also as figures under the charts (an unknown one as a dash), this one's marked "so
    // far"; one ahead keeps its sentence.
    const figures = r && [
      [t.sun, f.kwh(r[4]), "--sun"],
      [t.homeUse, f.kwh(r[5]), "--home"],
      [t.colGrid, f.kwh(r[6]), "--grid"],
      pc == null ? null : [t.battAvg, `${f.num(pc)}%`, "--batt"],
    ].filter(Boolean);
    // No row 10 minutes into an hour (5 minute rows come every 5): nothing on record for it.
    return [h, past || (ms + 10 * MINUTE < now ? `${h}: ${t.noData}` : coming),
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
  const legend = legendHtml([{ label: t.sun, color: "--sun" }, { label: t.homeUse, color: "--home" }, { label: t.colGrid, color: "--grid" }]);
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
      <div class="ticks">${[0, 8, 16].map((h) => hours.findIndex((ms) => clock(ms).hour === h)).filter((i) => i >= 0).map((i) => `<span style="left:${(i / N) * 100}%">${f.hour(new Date(hours[i]))}</span>`).join("")}<span style="right:0">${f.time(new Date(day0 + N * H - MINUTE))}</span></div>
      ${legend}
      ${rows.length ? "" : `<p class="note">${cap(t.noData)}</p>`}
      <div class="stepped">${steps(t, "Hour", at, said.findLastIndex(([, name]) => name))}<div class="picked" aria-live="polite" aria-atomic="true">${said.map(([h, name, figures], i) => `<div class="day" data-i="${i}"${i === at ? "" : " hidden"}>${figures || (name && name.replace(h, `<b>${h}</b>`))}</div>`).join("")}</div></div>
    </section>`;
}

function energyHtml(c) {
  return `
    <h1 class="title">${c.t.tabEnergy}</h1>
    ${todayCard(c)}${battDayCard(c)}${productionCard(c)}`;
}

// Where use came from, by part: straight from the sun, the battery, the grid (kWh, null when unknown), and
// each part's share of the ring. `d` holds loadKwh, batteryKwh and gridImportKwh.
function splitOf(d, batt) {
  const fromGrid = Number.isFinite(d.gridImportKwh) ? Math.max(0, d.gridImportKwh) : null;
  const fromBatt = batt ? (Number.isFinite(d.batteryKwh) ? Math.max(0, d.batteryKwh) : null) : 0;
  const sun = [d.loadKwh, fromBatt, fromGrid].every(Number.isFinite) ? Math.max(0, d.loadKwh - fromBatt - fromGrid) : null;
  const parts = [
    { key: "sun", color: "--sun", kwh: sun },
    ...(batt ? [{ key: "batt", color: "--batt", kwh: fromBatt }] : []),
    { key: "grid", color: "--grid", kwh: fromGrid },
  ];
  const complete = parts.every((p) => Number.isFinite(p.kwh));
  const used = complete ? parts.reduce((sum, p) => sum + p.kwh, 0) : 0;
  // A part that reads 0 kWh has no place on the ring (6 - 5.6 - 0.4 is not exactly 0).
  parts.forEach((p) => { p.frac = used > 0 && p.kwh >= 0.05 ? p.kwh / used : 0; });
  return { parts, complete, sun, fromBatt, fromGrid };
}
const sided = (parts) => parts.forEach((p, i) => { p.side = i === 0 ? "left" : i === parts.length - 1 ? "right" : "top"; });

// The forecast counts use as the balance (what flows in less what flows out, the inverter's own use with
// it): beside it, today so far counts the same way, even with a load sensor, so so far and ahead add up and
// the battery and grid match their meters.
const onBalance = (data) => ({ ...data, today: { ...data.today, loadKwh: balanceKwh(data.today) ?? data.today.loadKwh } });

// The forecast sensor without house use (its mode Weather): sun and sky only. Nothing from the usual day
// shows beside it (the coming days' use line, payback's time left), nor money it cannot know (month end).
const weatherOnly = (data) => data.ahead?.from === "sensor" && !data.ahead.left?.use;
// Payback's time left: while the page predicts anything, as with a forecast or a usual day; not beside weather alone.
const paybackPredicts = (data) => !weatherOnly(data) && !!(data.outlook || data.usualToday);
// The small rings come with an outlook that has hours left today (the mid run).
const ringsAhead = (data) => data.outlook?.hoursAhead?.length > 0;
// Today so far plus the outlook's mid run up to `until`, an hour part way through by its share. The first
// entry of hoursAhead starts at now, and it holds today's hours only.
function shareBy(d, hoursAhead, now, until) {
  const x = { loadKwh: d.loadKwh, batteryKwh: d.batteryKwh, gridImportKwh: d.gridImportKwh };
  for (const [t, , batt, grid, use] of hoursAhead) {
    const from = Math.max(t, now), part = clamp01((until - from) / (t + HOUR - from));
    x.loadKwh += use * part; x.batteryKwh += batt * part; x.gridImportKwh += grid * part;
  }
  return x;
}
// The same split in an hour and at the end of the day, as the forecast expects: small rings in the big
// one's order (`order`, part keys), without labels, the share in the middle, when and how much under each.
// Less than an hour left today: the end of the day alone.
function aheadRings(data, t, f, order) {
  const now = Date.now(), rows = data.outlook.hoursAhead, end = rows.at(-1)[0] + HOUR;
  const ring = (until, when, text) => {
    const x = shareBy(data.today, rows, now, until), s = splitOf(x, data.batt), share = ownShare(x);
    if (!s.complete || share === null) return "";
    const parts = order.map((k) => s.parts.find((p) => p.key === k));
    sided(parts);
    const label = say(text, { h: when, p: f.num(pct(share)), a: f.kwh(Math.max(0, x.loadKwh - x.gridImportKwh)), b: f.kwh(x.loadKwh) });
    return `<li><div class="ring-box">${splitRing(parts, label, "")}<div class="ring-mid" aria-hidden="true">${big(pct(share))}</div></div><span>${when} · ${f.kwh(x.loadKwh)}</span></li>`;
  };
  const list = (now + HOUR < end ? ring(now + HOUR, f.time(new Date(now + HOUR)), t.hShareBy) : "") + ring(end, t.endOfDay, t.hShareEnd);
  return list && `<ul class="rings-ahead">${list}</ul>`;
}

// Where today's use came from, round a ring: straight from the sun, then the battery, then the grid, each
// named beside its part; the home made share in the middle, and under it each part's figure (plus what was
// sent, when something was). A part unknown leaves a plain ring (its figures as dashes), the share still in
// the middle when use and the grid are known.
// On Energy with no prediction for today at all, or with a forecast (`ahead`: the small rings beside it).
function shareRing(data, t, f, ahead) {
  const d = data.today, share = ownShare(d);
  if (Number.isFinite(d.loadKwh) && d.loadKwh < MIN_USE_KWH) return `<p>${t.noUseYet}</p>`;
  const label = share === null ? cap(t.noData) : say(t.hShare, { p: f.num(pct(share)), a: f.kwh(Math.max(0, d.loadKwh - d.gridImportKwh)), b: f.kwh(d.loadKwh) });
  const { parts, complete, sun, fromBatt, fromGrid } = splitOf(d, data.batt);
  const names = { sun: t.sun, batt: t.battery, grid: t.colGrid };
  // The largest part goes in the middle, its label on top: the other two then share the ring's ends, the
  // top lead stays well clear of the side labels and none crosses another. Smaller in the middle, a tiny
  // first part (no sun on a winter morning) would bring the top lead down onto the left label.
  if (parts.length === 3) {
    const most = parts.reduce((m, p, i) => (p.frac > parts[m].frac ? i : m), 0);
    parts.splice(1, 0, ...parts.splice(most, 1));
  }
  sided(parts);
  const small = ahead && complete ? aheadRings(data, t, f, parts.map((p) => p.key)) : "";
  const ring = `<div class="ring-box">
        ${complete ? splitRing(parts, label, f.kwh(d.loadKwh))
          : `<svg class="ring" viewBox="0 0 200 176" ${hint(label)}><path class="track" d="M${ringAt(0, 80)} ${ringArc(0, 1, 80)}"/>${ringSize(f.kwh(d.loadKwh))}</svg>`}
        <div class="ring-mid" aria-hidden="true">${share === null ? '<span class="big">—</span>' : big(pct(share))}</div>
        ${complete ? parts.map((p) => `<span class="part ${p.side}">${names[p.key]}</span>`).join("") : ""}
      </div>`;
  const said = `<p>${share === null ? t.shareIncomplete : t.shareToday}</p>`;
  return `${small ? `<div class="rings"><div>${ring}${said}</div>${small}</div>` : ring + said}
      ${readout(t.todaySoFar, [
        [t.sun, f.kwh(sun), "--sun"],
        data.batt ? [t.battery, f.kwh(fromBatt), "--batt"] : null,
        [t.colGrid, f.kwh(fromGrid), "--grid"],
        data.sends && (d.gridExportKwh == null || d.gridExportKwh >= SENT_KWH) ? [t.sent, f.kwh(d.gridExportKwh), "--sent"] : null,
      ])}`;
}

// MONEY: payback, this month's days, the prices now, the month balance. "" when no card has anything, and the page then goes.
// This month's money still to come, from the outlook (see lookAhead): each whole day after today in this month
// as { date, back, cost } (back: saved, plus earned while export is on), up to the first a price leaves unknown;
// `rest`, `cost` and `back`: what the rest of the month should add to its net, grid cost and savings once those
// days reach its last day (else null).
// null without an outlook that has them (none with weather alone: it has no house use).
function moneyAhead(data) {
  const o = data.outlook, key = data.monthKey, sends = data.sends;
  if (!o?.daysMoney || !o.restToday || !key) return null;
  const days = [];
  for (const [d, saved, cost, earned] of o.daysMoney) {
    const back = sumKnown([saved, sends ? earned : 0]);
    if (!d.startsWith(key) || back === null || cost === null) break;
    days.push({ date: Date.parse(`${d}T12:00:00Z`), back, cost });
  }
  const r = o.restToday, back = sumKnown([r.saved, sends ? r.earned : 0]), cost = r.cost ?? null;
  const reach = days.length ? new Date(days.at(-1).date).getUTCDate() : data.monthDays?.length;
  if (reach !== daysIn(key) || back === null || cost === null) return { days, rest: null, cost: null, back: null };
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  return { days, rest: back - cost + sum("back") - sum("cost"), cost: cost + sum("cost"), back: back + sum("back") };
}

function moneyHtml({ data, t, f, clock, pick }) {
  const p = data.price, now = Date.now();
  // The price now, for the prices card: the tariff's band now when it has bands, else the sensor's present hour
  // when it is fresh, else the Energy settings' one.
  const hour = presentHour(data.ahead, now), bd = data.bands, c = clock(now), bandNow = bd && bandOf(c.key, c.hour, bd.type);
  const buy = bd ? bd.prices[bandNow] : hour?.buy ?? p.buy, sell = hour?.sell ?? p.sell;
  // The month money: the sensor's months when it is fresh (this month's as its month end), else the
  // statistics (see onRecord).
  const m = data.month, lm = data.lastMonth;
  const key = clock(now).key.slice(0, 7), months = data.ahead?.from === "sensor" && !weatherOnly(data) ? data.ahead.months : null;
  // Money from the statistics: what the grid cost and paid as Home Assistant recorded it, when there is
  // some for the month (so a new price leaves past months as they were), else its kWh at today's price.
  // Saved has no statistic of its own: the house's own kWh at the month's average grid price (its cost
  // over its kWh), else at today's.
  // A recorded 0 stays 0; an unknown energy figure leaves the money unknown (null), never 0. With export off
  // nothing is earned.
  // ponytail: a month whose cost statistic started part way through counts only that part.
  const onRecord = {
    cost: (x) => num(x.costMoney) ?? pricedEnergy(x.gridImportKwh, p.buy),
    earned: (x) => (!data.sends ? 0 : num(x.earnedMoney) ?? pricedEnergy(x.gridExportKwh, p.sell)),
    saved: (x) => (![x.loadKwh, x.gridImportKwh].every(Number.isFinite) ? null
      : num(x.costMoney) !== null && x.gridImportKwh > 0 ? Math.max(0, x.loadKwh - x.gridImportKwh) * x.costMoney / x.gridImportKwh : savedMoney(x, p)),
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
  // This month's end, the sensor's: [low, mid, high], for net its mid alone.
  const fee = fixedAt(key), v = months?.[key]?.money;
  const r = (j) => (Array.isArray(v?.[j]) && v[j].every(Number.isFinite) && (j !== "cost" || fee !== null) ? v[j].map((y) => y + (j === "cost" ? fee : 0)) : null);
  const end = { saved: r("saved"), earned: r("earned"), cost: r("cost") };
  end.net = end.saved && end.cost ? end.saved[1] + (data.sends ? end.earned?.[1] ?? 0 : 0) - end.cost[1] : null;
  // Without the sensor's month: this month's net so far plus what the outlook expects to its end (see moneyAhead).
  const coming = moneyAhead(data), soFarNet = m && !m.none ? net(m, key) : null;
  if (!months && coming?.rest != null && soFarNet !== null) end.net = soFarNet + coming.rest;
  const lastKey = shiftMonth(key, -1), sign = f.money(0).split(" ").pop();
  // Finished months from the month rows, last month and this one from the day rows (as `lastMonth` and `month`).
  const byMonth = new Map(data.months ?? []).set(lastKey, lm).set(key, m);
  const row = (mk) => { const x = byMonth.get(mk); return x && !x.none ? x : null; };
  // A card of money shows only when something prices it: a price, the sensor's month money or a money statistic.
  // A day or month that bought or sent 0 kWh is a known 0 even then, which alone would draw a card of dashes.
  const stat = (list) => list.some((x) => Number.isFinite(x?.costMoney) || Number.isFinite(x?.earnedMoney));
  const anyPrice = p.buy != null || p.sell != null;
  // Month balance: the 12 months' net as bars (see monthPicker), the picked one (this one at first) under
  // them: its grid cost to the left of a middle line, what it saved and earned to the right, on one scale,
  // with their figures, then saved, export and the net as figures (see readout; a net below 0 in the low
  // colour). A figure nobody can price, or unknown, is a dash, without a bar; a month with no numbers on
  // record says so. For this month, where its net should end (the sensor's month, else see moneyAhead). The
  // card goes when no month has any money known.
  const netOf = (mk) => (row(mk) ? net(row(mk), mk) : null);
  const at = yearKeys(key).includes(pick?.balanceMonth) ? pick.balanceMonth : key;
  const named = (mk) => (mk === key ? say(t.monthSoFar, { m: f.monthYear(mk) }) : f.monthYear(mk));
  const x = row(at), cost = x && got("cost", x, at), saved = x && got("saved", x, at), earned = x && got("earned", x, at);
  const brought = x && back(x, at), result = x && net(x, at);
  // This month's grid cost and savings at its end, a faded bar behind each: the sensor's month, else this month so
  // far plus what the outlook expects to its end (see moneyAhead); null when nobody can tell.
  const endCost = at !== key ? null : months ? end.cost?.[1] ?? null : coming?.cost != null && cost !== null ? cost + coming.cost : null;
  const endBack = at !== key ? null : months ? (end.saved ? end.saved[1] + (data.sends ? end.earned?.[1] ?? 0 : 0) : null) : coming?.back != null && brought !== null ? brought + coming.back : null;
  const most = Math.max(cost ?? 0, brought ?? 0, endCost ?? 0, endBack ?? 0, 1e-9), w = (v) => ((v / most) * 100).toFixed(1);
  // ponytail: a figure below 0 (a negative tariff) has its number but no bar; draw it to the other side if that ever matters.
  const side = (cls, label, v, color, ahead) => `<div class="side ${cls}"><span>${label}</span><span class="track">${ahead > 0 ? `<i class="ghost" style="--c:${markOf(color)};--w:${w(ahead)}%"></i>` : ""}${!(v > 0) ? "" : `<i style="--c:${markOf(color)};--w:${w(v)}%"></i>`}</span><b>${f.money(v)}</b></div>`;
  const month = (anyPrice || Object.values(months ?? {}).some((x) => x?.money) || stat([...byMonth.values()])) && yearKeys(key).some((mk) => row(mk) && ["cost", "saved", "earned"].some((k) => got(k, row(mk), mk) !== null)) ? `<section class="card months" data-pick="balance">
      <h2><span>${t.monthTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "table")}
      ${monthPicker(t, f, key, at, netOf, (k, v) => `${named(k)}: ${v === null ? (row(k) ? t.noPrice : t.noData) : say(t.hBalance, { v: f.money(v) })}`, "--batt", true, (k) => (k === key ? end.net : null))}
      <div class="stepped">${monthSteps(t, key, at, (k) => cap(named(k)))}<h3 class="chart-title">${cap(named(at))}</h3></div>
      ${x ? `<div class="split">${side("cost", t.gridCost, cost, "--grid", endCost)}${side("back", data.sends ? t.savedEarned : t.savedLabel, brought, "--sun", endBack)}</div>
      ${readout("", [
        [t.savedLabel, f.money(saved), "--sun"],
        data.sends ? [t.exportLabel, f.money(earned), "--sent"] : null,
        [t.netBenefit, f.money(result), result < 0 ? "--low" : "--batt", result < 0],
      ])}
      ${at === key && end.net !== null ? `<p class="note">${say(t.balEnd, { v: f.money(Math.round(end.net * 10) / 10) })}</p>` : ""}` : `<p class="note">${t.noData}</p>`}
    </section>` : "";
  // Today's hours of each band, as runs of whole hours in Home Assistant's time zone (a day the clocks change has
  // 23 or 25). A run over midnight is one: F3 from 23:00 to 7:00. [{ band, from, to }] in ms.
  const bandRuns = (type) => {
    const runs = [];
    for (const at of dayHours(now, clock)) {
      const b = bandOf(c.key, clock(at).hour, type), last = runs.at(-1);
      if (last?.band === b) last.to = at + HOUR; else runs.push({ band: b, from: at, to: at + HOUR });
    }
    if (runs.length > 1 && runs[0].band === runs.at(-1).band) runs.at(-1).to = runs.shift().to;
    return runs;
  };
  // With two or three bands, one box each under buying: its name, its hours today, the share of this month's grid
  // energy bought in it and its price; the band now outlined.
  const runs = bd && bd.type !== "single" ? bandRuns(bd.type) : null;
  const bandList = !runs ? "" : `<ul class="bands">${Object.entries(bd.prices).map(([b, v]) => {
    const mine = runs.filter((r) => r.band === b);
    const when = !mine.length ? `<span>${t.notToday}</span>` : runs.length === 1 ? `<span>${t.allDay}</span>` : mine.map((r) => `<span>${f.time(r.from)} - ${f.time(r.to)}</span>`).join("");
    return `<li${b === bandNow ? ' aria-current="true"' : ""}><span class="name">${b.toUpperCase()}</span>${when}${bd.share ? `<span class="band-pct">${say(t.bandShare, { p: f.num(pct(bd.share[b])) })}</span>` : ""}<span class="num">${f.money(v)}</span></li>`;
  }).join("")}</ul>`;
  const nowTag = runs ? ` <span class="band-now">${say(t.bandNow, { b: bandNow.toUpperCase() })}</span>` : "";
  // The prices now: buying from the grid, and selling to it while export is on, each with which way the energy goes.
  const flow = (label, v, out, more = "") => `<div class="price${out ? " out" : ""}"><p class="rate"><span>${label}</span> <b>${f.money(v)}<small> /kWh</small></b></p>
      <p class="route"><svg class="end" viewBox="-17 -17 34 34" role="img" aria-label="${t.home}">${HOUSE}</svg><span class="arrow" aria-hidden="true">${out ? '<i></i><svg viewBox="17 7 6 10"><path d="m18 8 4 4-4 4"/></svg>' : '<svg viewBox="1 7 6 10"><path d="M6 8 2 12l4 4"/></svg><i></i>'}</span><svg class="end" viewBox="0 0 24 24" role="img" aria-label="${t.grid}">${PLUG}</svg></p>${more}</div>`;
  const selling = data.sends && sell !== null;
  const prices = buy === null && !selling ? "" : `<section class="card prices">
      <h2>${t.pricesTitle}</h2>${helpButton(t, "prices")}
      ${buy === null ? "" : flow(t.buyGrid + nowTag, buy, false, bandList)}${selling ? flow(t.sellGrid, sell, true) : ""}
    </section>`;
  // What each month brought back (saved and earned) and what its grid cost, for payback: finished months as
  // the month card reads them, this month so far from the statistics (the sensor's figure for it is the month end).
  // A month whose savings are unknown stays in, as null: payback then cannot say what came back. So does a month
  // missing from the month rows between the first on record and this one (last month from the day rows, which the
  // month rows lag).
  const ledger = [];
  if (data.payback) {
    const have = new Map(data.months ?? []);
    for (let mk = [...have.keys(), key].sort()[0]; mk <= key; mk = shiftMonth(mk, 1)) {
      const x = mk === key ? m : have.get(mk) ?? (mk === lastKey ? lm : null);
      ledger.push({ key: mk, back: x ? back(x, mk) : null, ...(x && {
        sun: x.solarKwh, load: x.loadKwh, out: x.gridExportKwh,
        self: [x.loadKwh, x.gridImportKwh].every(Number.isFinite) ? Math.max(0, x.loadKwh - x.gridImportKwh) : null,
        saved: got("saved", x, mk), earned: got("earned", x, mk) }) });
    }
  }
  // This month day by day: what each day brought back from its day rows, priced as above without the fixed
  // fees; null for a day with no numbers on record or nobody to price it.
  const days = (data.monthDays ?? []).map((x) => ({ date: x.date, none: x.none, back: x.none ? null : sumKnown([onRecord.saved(x), onRecord.earned(x)]), cost: x.none ? null : onRecord.cost(x) }));
  const rest = paybackCard(ledger, data.payback, { t, f }, paybackPredicts(data),{ lat: data.lat, sell: data.sends ? p.sell ?? 0 : 0 })
    + ((anyPrice || stat(data.monthDays ?? [])) && days.some((x) => x.back !== null || x.cost !== null) ? recentCard(data, days, sign, { t, f, pick }, coming?.days ?? []) : "");
  return month || rest || prices ? `
    <h1 class="title">${t.tabMoney}</h1>
    ${rest}${prices}${month}` : "";
}

// This month day by day (see dayLine): what each day brought back, and the picked day's savings, grid cost
// and balance under the chart (the month's total is on Month balance). A cost nobody can price leaves the
// balance unknown too. `coming`: the days still to come (see moneyAhead), dashed on, each with its sentence, to 10 cents.
function recentCard(data, list, sign, { t, f, pick }, coming = []) {
  const cents = (v) => f.money(Math.round(v * 10) / 10);
  const ahead = coming.map((d) => {
    const date = f.date(new Date(d.date)), plain = cap(say(t.hDayMoney, { d: date, v: cents(d.back), c: cents(d.cost) })), i = plain.indexOf(date);
    return [d.back, plain, `${plain.slice(0, i)}<b>${date}</b>${plain.slice(i + date.length)}`];
  });
  const day = (x, v, lead) => {
    if (v === null) return readout(lead, [[x.none ? t.noData : t.noPrice, "—"]]);
    const net = x.cost == null ? null : v - x.cost;
    return readout(lead, [[t.returns, f.money(v), "--sun"], [t.gridCost, f.money(x.cost), "--grid"],
      [t.netBenefit, f.money(net), net < 0 ? "--low" : "--batt", net < 0]]);
  };
  return `<section class="card recent" data-pick="recent">
      <h2><span>${t.recentTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "recent")}
      ${dayLine(t, f, data.monthKey, list, (x) => x.back, (x, v) => `${f.date(new Date(x.date))}: ${v === null ? (x.none ? t.noData : t.noPrice) : f.money(v)}`, day, pick?.recent, { ahead })}
    </section>`;
}

// Payback (see paybackLeft): what came back since the install date, plus what was saved before Home Assistant
// recorded, against what the system cost: a ring of the share with what came back in its middle and the cost
// in its gap, named under it, and how long is left (only while the page predicts anything, as with a forecast
// or a usual day). Once paid, a check in the full ring, the month it happened and what came back since.
// Hidden without a cost.
function paybackCard(all, pb, { t, f }, predicts, at = {}) {
  if (!pb) return "";
  // The install date's month as written ("2026-11-01"), never moved by a time zone. A copy this browser
  // remembered from an older version holds it as UTC midnight in ms, which gives the same month in UTC.
  const since = typeof pb.since === "string" ? pb.since : Number.isFinite(pb.since) ? new Date(pb.since).toISOString().slice(0, 10) : "";
  const from = since.slice(0, 7), done = all.filter((x) => x.key >= from);
  if (done.some((x) => x.back === null)) return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <p class="note">${t.paybackIncomplete}</p>
    </section>`;
  const got = pb.before + done.reduce((s, x) => s + x.back, 0), share = clamp01(got / pb.cost);
  // Finished months only: this month so far would pull the guess down. Its rest still comes back first. So would
  // an install month that started after its 1st (the house's whole month against part of the sun), while there
  // are other months to go by.
  const past = done.slice(0, -1), part = since.slice(8, 10) > "01" && past.length > 1 && past[0].key === from;
  const left = got >= pb.cost || !predicts ? null : paybackLeft(pb.cost - got, part ? past.slice(1) : past, done.at(-1)?.key, done.at(-1)?.back, at);
  // The range names the unit once, in the main figure: "About 7.5 years left (6.3 to 9.3)".
  const years = left && left[1] >= 24, round = (n) => (years ? Math.round(n / 1.2) / 10 : n);
  const span = (n) => (years ? f.years(round(n)) : f.months(n)), bare = (n) => f.num(round(n));
  const of = say(t.paybackOf, { a: f.moneyWhole(got), b: f.moneyWhole(pb.cost) }), paid = got >= pb.cost;
  // Once paid: the month the running total passed the cost (none when it had before Home Assistant recorded),
  // and what came back since.
  let on = null;
  for (let s = pb.before, i = 0; paid && s < pb.cost && i < done.length; i++) if ((s += done[i].back) >= pb.cost) on = done[i].key;
  const head = !paid ? of : on ? say(t.paybackOn, { m: f.monthYear(on) }) : t.paidBack;
  const when = paid ? say(t.paybackGain, { v: f.moneyWhole(got - pb.cost) })
    : left && say(t.paybackLeft, { d: span(left[1]) }) + (left[0] !== left[2] ? ` (${say(t.paybackRange, { a: bare(left[0]), b: bare(left[2]) })})` : "");
  return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <div class="ring-box">
        ${ring(share, "--sun", paid ? head : of, paid ? "" : f.moneyWhole(pb.cost))}
        <div class="ring-mid" aria-hidden="true">${paid ? `<svg class="done" viewBox="0 0 24 24">${ADVICE_ICON.ok}</svg>` : `<span class="amount">${f.moneyWhole(got)}</span>`}</div>
      </div>
      ${paid ? `<p>${head}</p>` : `<p class="ring-name">${t.plantCost}</p>`}${when ? `<p class="money">${when}</p>` : ""}
    </section>`;
}

// Months until `owed` is back: each coming month brings what the same calendar month brought when last on
// record (the latest January for every coming January, years ahead too), or, while that month has not been
// on record yet, what seasonGuess makes of the months on record (the average month when it cannot tell).
// [low, mid, high] months: the range walks every month PAYBACK_SPREAD better and worse, one value once a full
// year is on record. null with nothing on record.
// soFar: what month `lastKey` (under way) brought so far; its rest, what such a month brings less that,
// comes back first (at least 1 month is said all the same).
function paybackLeft(owed, past, lastKey, soFar = null, { lat, sell = 0 } = {}) {
  const by = Object.fromEntries(past.map((x) => [x.key.slice(5), x.back])); // oldest first: the latest wins
  const avg = past.length ? past.reduce((s, x) => s + x.back, 0) / past.length : 0;
  if (!(avg > 0) || !lastKey) return null;
  const guess = seasonGuess(past, lat, sell);
  const month = (mk) => by[mk.slice(5)] ?? (guess ? guess(mk) : avg);
  const walk = (k) => {
    let rest = owed - (Number.isFinite(soFar) ? Math.max(0, k * month(lastKey) - soFar) : 0), n = 0, mk = lastKey;
    while (rest > 0 && n < PAYBACK_MAX_MONTHS) { mk = shiftMonth(mk, 1); n++; rest -= k * month(mk); }
    return Math.max(1, n);
  };
  const spread = past.length >= 12 ? 0 : PAYBACK_SPREAD;
  return [walk(1 + spread), walk(1), walk(1 - spread)];
}

// Clear-sky sunlight on flat ground at the middle of the hour starting at `t` (ms), in W/m2: the sun's height
// from the date, the hour and the longitude, then Haurwitz's clear sky. The equation of time is left out (a
// quarter hour at most): the usual day only compares nearby days by it, which shifts them alike.
function clearSky(t, lat, lon) {
  const rad = Math.PI / 180, d = new Date(t + HALF_HOUR), n = (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY;
  const decl = 23.45 * rad * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const ha = (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 - 12) * 15 * rad;
  const c = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
  return c > 0.01 ? 1098 * c * Math.exp(-0.057 / c) : 0;
}

// Sunlight on flat ground above the air at latitude `lat` over month `key`, summed by day, in no particular
// unit: only months against each other matter. Clouds and the panels' tilt are left to the scale fitted below.
function monthSun(key, lat) {

  const rad = Math.PI / 180, f = lat * rad, [y, m] = key.split("-").map(Number);
  const first = Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(y, 0, 1)) / DAY);
  let s = 0;
  for (let n = first + 1; n <= first + daysIn(key); n++) {
    const decl = 23.45 * rad * Math.sin((2 * Math.PI * (284 + n)) / 365);
    const set = Math.acos(Math.max(-1, Math.min(1, -Math.tan(f) * Math.tan(decl))));
    s += (1 + 0.033 * Math.cos((2 * Math.PI * n) / 365)) * (Math.cos(f) * Math.cos(decl) * Math.sin(set) + set * Math.sin(f) * Math.sin(decl));
  }
  return s;
}

// What a month with no year before it should bring back, from the finished months on record (each with its
// kWh: sun made, house used, house took from the sun and battery (self), sent; and its money: saved, earned).
// Months differ more in sun than in money: in summer the house cannot use most of it and it goes out cheap.
// So: the sun follows monthSun times one scale; the house's use per day follows the sun's per day in a straight
// line (heating in winter; flat with under 3 months, too few to tell a season from an odd month), at least half
// the lowest on record; the share of its use the sun covers saturates, 1 - e^(-b·sun/use), b fitted to the
// months with sun; that part earns what a kWh saved earned, the rest what a kWh sent did (`sell` when nothing
// went out yet). A month without its kWh or money is left out (a month with no sun stays: polar night, snow).
// null without a latitude or a month to fit, and the caller takes the average month. One value per calendar
// month: the walk asks for the same months again and again.
// ponytail: use saturates at all of it, which takes a battery; without one the guess is high in summer. A second
// fitted ceiling once that shows. A summer-only record cannot see winter heating: the guess then runs about 15%
// long until winter is on record. An odd month (a holiday) bends the use line: about 30% off with 3 months.
function seasonGuess(all, lat, sell) {
  const past = all.filter((x) => [x.sun, x.load, x.self, x.saved, x.earned].every(Number.isFinite) && x.sun >= 0 && x.load > 0);
  if (!Number.isFinite(lat) || !past.length) return null;
  const sum = (list, g) => list.reduce((s, x) => s + g(x), 0), n = past.length, sky = (k) => monthSun(k, lat) / daysIn(k);
  const scale = sum(past, (x) => x.sun) / sum(past, (x) => monthSun(x.key, lat));
  const xs = past.map((x) => sky(x.key)), ys = past.map((x) => x.load / daysIn(x.key));
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n, vx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
  const slope = n >= 3 && vx > 0 ? xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / vx : 0, floor = Math.min(...ys) / 2;
  const lit = past.filter((x) => x.sun > 0), b = sum(lit, (x) => (-Math.log(1 - Math.min(0.99, x.self / x.load)) * x.load) / x.sun) / lit.length;
  const self = sum(past, (x) => x.self), sent = past.filter((x) => Number.isFinite(x.out)), out = sum(sent, (x) => x.out);
  if (!Number.isFinite(scale) || !(scale >= 0) || !(self > 0) || !(b > 0)) return null;
  const perSelf = sum(past, (x) => x.saved) / self, perOut = out >= 1 ? sum(sent, (x) => x.earned) / out : sell;
  const seen = new Map();
  return (key) => {
    if (seen.has(key.slice(5))) return seen.get(key.slice(5));
    const sun = scale * monthSun(key, lat), use = Math.max(floor, my + slope * (sky(key) - mx)) * daysIn(key);
    const covered = use * (1 - Math.exp((-b * sun) / use)), v = perSelf * covered + perOut * Math.max(0, sun - covered);
    seen.set(key.slice(5), v);
    return v;
  };
}

// How much the browser enlarges text on its own: [page text, chart text], 1 where it does not. The
// Home Assistant app on Android shows the panel in a web view that grows text by the phone's font size
// but leaves the layout alone, so lines overflow their cards. A word in a fixed size on the page, against
// the same word on a canvas (which the web view leaves alone), gives the factor; an SVG word gives it for
// chart text, which may differ. The panel then zooms as a whole by it (see the :host rule in styles.js).
function textScale() {
  const font = "100px sans-serif", word = "Mmmmmmmmmm";
  const box = document.createElement("div");
  box.style.cssText = `position:fixed;left:-9999px;top:0;font:${font};white-space:nowrap;-webkit-text-size-adjust:100%;text-size-adjust:100%`;
  box.innerHTML = `<span>${word}</span><svg width="2000" height="200"><text y="150" style="font:${font}">${word}</text></svg>`;
  document.body.append(box);
  const page = box.firstChild.getBoundingClientRect().width, chart = box.querySelector("text").getComputedTextLength();
  box.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = font;
  const plain = ctx.measureText(word).width;
  // Small differences are font rounding, not a setting.
  return [page, chart].map((w) => (w / plain > 1.05 ? Math.round((w / plain) * 100) / 100 : 1));
}
let zoom; // textScale's answer, measured once per load: it forces a layout of the whole document

// ---- Element ----
class SolarView extends HTMLElement {
  constructor() {
    super();
    this._drawn = "";  // key of what is on screen, to skip identical redraws
    this._html = [];   // each page's markup on screen, to write only the pages that changed
    this._src = undefined;   // which entities to read and the settings (readConfig), once the Energy settings answered
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
    try { this._show = JSON.parse(localStorage.getItem(SHOW_KEY)) ?? {}; } catch (e) { this._show = {}; }
    try { const l = localStorage.getItem(LANGUAGE_KEY); this._language = Object.hasOwn(LANGUAGES, l ?? "") ? l : ""; } catch (e) { this._language = ""; }
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
    const [zf, zs] = (zoom ??= textScale());
    this.style.setProperty("--zf", zf);
    this.style.setProperty("--zs", zs);
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
      // Rects come zoomed (see textScale), the hint is placed in the panel's own pixels.
      const z = this.currentCSSZoom || 1, unzoom = (b) => ({ left: b.left / z, top: b.top / z, bottom: b.bottom / z, width: b.width / z, height: b.height / z });
      const box = unzoom(this.getBoundingClientRect()), r = unzoom(el.getBoundingClientRect()), mid = r.left - box.left + r.width / 2;
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
      const usual = stats.usual && { solarW: stats.usual.solarW, loadW: stats.usual.balanceW, spread: stats.usual.spread, machineW: stats.usual.machineW, scale: stats.usual.scale };
      // Export capped and the battery full at some point today: the sun so far was held back (see forecastOf).
      const throttled = src.exportMaxKw != null && ((stats.socDay ?? []).some(([, p]) => p >= FULL_SOC) || n.soc >= FULL_SOC);
      const ahead = src.level === "none" ? null : forecastOf({ sensor: ["usual_days", "usual_days_weather"].includes(src.level) ? null : sensor, now, clock, solarWh: stats.solarWh, usual, price, sunSoFar: stats.today.solarKwh, sunUntil: stats.sunUntil, throttled });
      // Hours already past are priced by the sensor's own hours when it is fresh, else at the flat price.
      const given = new Map((ahead?.from === "sensor" ? sensor.attributes.hours : []).map((h) => [Date.parse(h.t), h]));
      const priceAt = (field) => (t) => (given.has(t) ? given.get(t)[field] ?? null : price[field]);
      const standby = stats.standbyW / 1000;
      const soFar = moneySoFar(stats.todayHours, priceAt("buy"), priceAt("sell"), standby, now);
      const battery = batt && { kwh: batt.kwh, floor: batt.floor, maxChargeKw: batt.maxChargeKw, maxDischargeKw: batt.maxDischargeKw, efficiency: stats.efficiency };
      this._ahead = ahead;
      // Without house use (mode Weather) the sensor gives sun and sky only: no outlook, so the page shows
      // what it shows without a forecast (no ghosts, money, best time, lasts until). So does a day whose
      // statistics are incomplete: an unknown figure must not count as 0 in what follows from them.
      const known = ENERGY.every((part) => Number.isFinite(stats.today[part]));
      // The tariff: each band's price typed (a number or an entity), else learned from the price sensor's
      // hour means and its value now. A band left without one: prices are left out of the advice.
      const tf = src.tariff, bands = tf && bandPrices(tf.type, Object.fromEntries(Object.entries(tf.prices).map(([k, v]) => [k, numberOrEntity(v, hass)])),
        tf.sensor ? [...stats.priceRows, { start: now, mean: stateNum(hass, tf.sensor) }] : [], clock);
      if (tf && !bands) warnOnce("tariff needs a type (single, two, three) and a price for each of its bands, from prices or sensor");
      // Kept for the prices card, which shows them at any level, with the share of this month's grid energy
      // bought in each band (null with nothing bought yet).
      // ponytail: from the hour rows, so the hour under way is not in it yet; add todayHours if that ever matters.
      const used = {}, month = clock(now).key.slice(0, 7);
      for (const id of src.gridImportKwh) for (const r of stats.gridMonth?.[id] ?? []) {
        const c = clock(r.start);
        if (r.change > 0 && c.key.startsWith(month)) { const b = bandOf(c.key, c.hour, tf.type); used[b] = (used[b] ?? 0) + r.change; }
      }
      const bought = Object.values(used).reduce((a, v) => a + v, 0);
      this._bands = bands && { type: tf.type, prices: bands, share: bought > 0 ? Object.fromEntries(Object.keys(bands).map((b) => [b, (used[b] ?? 0) / bought])) : null };
      const bandAt = bands && ((t) => { const c = clock(t), band = bandOf(c.key, c.hour, tf.type); return { band, buy: bands[band] }; });
      const settings = { exportMaxKw: src.exportMaxKw, standbyKwhPerHour: standby, machines: (stats.machines ?? []).filter(Boolean),
        quiet: src.quiet, gridMaxKw: src.gridMaxKw, marginPct: src.marginPct, bandAt };
      const outlook = ahead?.left.use && known ? lookAhead(ahead, now, clock, n, battery, settings, soFar) : null;
      this._outlook = outlook;
    } catch (e) {
      console.warn("solar-view: the forecast could not be read", e);
      this._ahead = this._outlook = this._bands = null;
    }
  }

  // Which entities to read (Energy settings plus config), then their totals from the statistics.
  // Home Assistant writes its hour rows about 12 minutes past each hour (UTC), and makes the day and
  // month rows from them: everything but today's 5 minute rows is kept until a quarter past, so most
  // loads ask one thing. The Energy settings are kept as long, except while they are not set up.
  async _load() {
    const hass = this._hass, now = Date.now(), run = (this._run = (this._run || 0) + 1), clock = clockOf(hass.config?.time_zone);
    this._next = now + REFRESH_MS;
    const quarter = Math.floor(now / HOUR) * HOUR + 15 * MINUTE, until = quarter > now ? quarter : quarter + HOUR;
    try {
      let setup = this._setup && now < this._setup.until ? this._setup : null;
      if (!setup) {
        // "No prefs": the Energy page was never set up. The owner's config may still name entities.
        const [prefs, info] = await Promise.all([hass.callWS({ type: "energy/get_prefs" }).catch((e) => { if (e?.code === "not_found") return null; throw e; }),
          hass.callWS({ type: "energy/info" }).catch(() => ({}))]);
        // Not set up: asked again on the next load, so the page follows the owner setting it up.
        setup = { prefs, info, until: prefs ? until : 0 };
      }
      const read = readConfig(setup.prefs, this._panel?.config, setup.info?.cost_sensors);
      // One object for the functions here, until data.js takes ids and settings apart. geo: the usual day's seasons (see usualDay).
      const src = { ...read.ids, ...read.cfg, geo: [hass.config?.latitude, hass.config?.longitude] };
      // The skeleton takes its shape from the settings while the statistics load (see placeholder).
      if (!this._src && run === this._run) { this._src = src; this._render(); }
      const ids = ENERGY.flatMap((k) => src[k]), all = PARTS.flatMap((k) => src[k]);
      const stat = (period, start, list = all, types = ["change"]) => (list.length ? hass.callWS({
        type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(),
        statistic_ids: list, period, types, units: { energy: "kWh" },
      }) : {});
      // The bill's fixed part from an entity: its month means, from the first on record.
      const fixedId = typeof src.billFixed === "string" ? [src.billFixed] : [];
      // The machines' energy sensors (their runs, see machineOf) and the tariff's price sensor (its band means).
      const machineIds = [...new Set(src.machines.map((a) => a.sensor).filter(Boolean))], priceId = src.tariff?.sensor ? [src.tariff.sensor] : [];
      // With a tariff of two or three bands, the grid's hour rows of this month: the share bought in each band.
      const bandIds = src.tariff && src.tariff.type !== "single" ? src.gridImportKwh : [];
      const asked = JSON.stringify([all, src.soc, src.usualDays, fixedId, machineIds, priceId, bandIds]);
      // A new day in Home Assistant's time zone asks again: the kept day rows end with yesterday as today.
      const kept = this._kept?.asked === asked && now < this._kept.until && this._kept.day === clock(now).key ? this._kept : null;
      // 366 days reach the first day of the oldest month Production shows (see yearKeys) from any day.
      // 25 hours cover today, even a long one. Month rows from the first on record: payback, Month balance.
      const slow = kept?.rows ?? Promise.all([stat("day", now - 366 * DAY), stat("hour", now - src.usualDays * DAY, ids),
        hass.callWS({ type: "energy/solar_forecast" }).catch(() => ({})), stat("month", Date.UTC(2000, 0, 1)), stat("hour", now - 25 * HOUR, src.soc, ["mean"]),
        stat("month", Date.UTC(2000, 0, 1), fixedId, ["mean"]), stat("hour", now - MACHINE_DAYS * DAY, machineIds),
        stat("5minute", now - FIVE_MIN_DAYS * DAY, machineIds), stat("hour", now - PRICE_DAYS * DAY, priceId, ["mean"]),
        stat("hour", now - (+clock(now).key.slice(8) + 1) * DAY, bandIds)]);
      // 5 minute rows from an hour before midnight (a day the clocks change still fits), asked on every load. In the
      // first hour of a day, 25 hours: totals takes yesterday from them while its day row is missing.
      const at = clock(now), since = at.hour === 0 ? now - 25 * HOUR : hourStart(now, clock) - (at.hour + 1) * HOUR;
      const [recent, rows] = await Promise.all([stat("5minute", since), slow]);
      // `hass` and `panel` can each start a load: only the newest may answer, or entities read without
      // the config could land last.
      if (run !== this._run) return;
      this._setup = setup;
      this._src = src;
      this._kept = kept || { asked, until, rows, day: clock(now).key };
      const [daily, hourly, forecast, monthly, socRows, fixedRows, machineHours, machineFive, priceRows, gridMonth] = rows;
      this._stats = totals(src, daily, recent, hourly, forecast, clock, now, monthly, machineHours);
      this._stats.socDay = socDay(socRows, src.socWeight, clock, now, src.soc);
      this._stats.fixedMonths = Object.fromEntries((fixedRows[fixedId[0]] ?? []).filter((r) => Number.isFinite(r.mean)).map((r) => [clock(r.start).key.slice(0, 7), r.mean]));
      this._stats.machines = src.machines.map((a) => machineOf(a, machineHours?.[a.sensor], machineFive?.[a.sensor]));
      this._stats.priceRows = priceRows?.[priceId[0]] ?? [];
      this._stats.gridMonth = gridMonth ?? {};
      this._lookAhead();
      // Just after midnight "today" must start from zero.
      this._next = Math.min(this._next, now + this._stats.msToMidnight + 5e3);
      this._render();
    } catch (e) {
      if (run !== this._run) return; // an older load: the newest one keeps its own schedule
      console.warn("solar-view: loading the numbers failed", e);
      this._next = Date.now() + MINUTE; // try again in a minute, not in 5
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
    // Even the same value restyles the whole panel, and this runs on every state change in the house.
    if (this.getAttribute("lang") !== locale) this.setAttribute("lang", locale);
    const dark = !!hass.themes?.darkMode;
    // The texts, and the labels outside the pages, only again when the language or the config changes:
    // this runs on every state change in the house.
    if (this._lang !== lang || this._tConfig !== this._panel?.config) {
      this._lang = lang;
      this._tConfig = this._panel?.config;
      this._cfg = readConfig(null, this._panel?.config).cfg; // what the page needs before the Energy settings answer
      this._t = withOwnAdvice(STRINGS[lang], this._cfg, lang);
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
    // Not set up: no solar power sensor, or a required sensor that does not exist. Offline: every sensor
    // of a required kind exists but has no value. Drawing zeros instead would read as "battery empty".
    // An optional sensor never blanks the page (see requiredIds).
    const src = this._src, kinds = src ? requiredIds(src) : [];
    const missing = kinds.flat().filter((id) => !hass.states[id]);
    const started = !hass.config || hass.config.state === "RUNNING";
    const setup = !!src && (!src.solarW.length || (missing.length > 0 && started));
    const silent = kinds.some((kind) => kind.every((id) => stateNum(hass, id) === null));
    if (src && started) for (const id of optionalIds(src)) if (!hass.states[id]) warnOnce(`${id} does not exist, so house use is worked out from the flows`);
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
    const data = loading ? placeholder(hass, src) : readData(hass, src, this._stats, { ahead: this._ahead, outlook: this._outlook, bands: this._bands });
    const day = this.testDay ?? Date.parse(clockOf(hass.config?.time_zone)(Date.now()).key) / DAY; // testDay: preview harness only (?day=)
    const cycle = hourCycle(this._cfg.timeFormat, hass.locale);
    const tz = hass.config?.time_zone, currency = hass.config?.currency || "EUR", fKey = [locale, currency, cycle, tz].join("|");
    const json = JSON.stringify(data), key = loading + fKey + dark + day + JSON.stringify(this._show) + json;
    if (key === this._drawn) return; // same data again: leave the DOM (and its motion) alone
    this._drawn = key;
    this._status.textContent = ""; // the error message, if one was said, is gone
    if (loading) this.removeAttribute("ready");
    else {
      // The skeleton's copy needs the shape, not every watt: kept at most once a minute.
      if (!(Date.now() - this._saved < MINUTE)) {
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
    // The first sky is set at once (read back, so the browser has it); from then on it glides, see :host([glide]) .sky.
    if (!this.hasAttribute("glide")) { getComputedStyle(this.shadowRoot.querySelector(".sky")).getPropertyValue("--sv-sky1"); this.setAttribute("glide", ""); }
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
    // no export price, no weather): a line about a mark nobody can find only puzzles. The small rings' line
    // names where they come from: the sensor's forecast or a usual day.
    const noSoc = !data.batt || data.now.soc === null, sell = presentHour(data.ahead, Date.now())?.sell ?? data.price.sell;
    const fromSensor = data.ahead?.from === "sensor";
    const off = {
      battery: data.outlook?.inHour ? (fromSensor ? [] : ["helpRange"]) : ["helpGain", "helpUse", "helpRange", "helpRise"],
      daily: [...(monthAhead(data)?.end != null ? [] : ["helpProdEnd"]), ...(monthAhead(data)?.days.length ? [] : ["helpProdAhead"])],
      days: [...(data.ahead?.days?.some((d) => Number.isFinite(d.cloud)) ? [] : ["helpDaysSky"]), ...(!weatherOnly(data) && data.usualToday?.used?.[1] > 0 ? [] : ["helpDaysUse"])],
      battday: [...(data.outlook ? [] : weatherOnly(data) ? ["helpBattDayAhead"] : ["helpBattDayGhost", "helpBattDayAhead"]), ...(noSoc ? ["helpBattDayLine", "helpBattDayAhead", "helpBattDayFloor"] : [])],
      payback: paybackPredicts(data) ? [] : ["helpPaybackLeft"],
      share: [...(data.batt ? [] : ["helpShareBatt"]), ...(!ringsAhead(data) ? ["helpShareAhead", "helpShareAheadFc"] : [fromSensor ? "helpShareAhead" : "helpShareAheadFc"])],
      prices: [...(data.sends && sell != null ? [] : ["helpPricesSell"]), ...(data.bands && data.bands.type !== "single" ? [] : ["helpPricesBands"])],
      recent: [...(moneyAhead(data)?.days.length ? [] : ["helpRecentAhead"]), ...(data.sends ? [] : ["helpRecentSold"])],
      table: this.shadowRoot.querySelector(".months i.ghost") ? [] : ["helpBalEnd"],
    };
    this.shadowRoot.querySelectorAll("dialog.read :is(li,.pair)").forEach((el) => {
      const gone = off[el.closest("dialog").dataset.card] ?? [];
      el.hidden = [...el.querySelectorAll("[data-t]")].some((x) => gone.includes(x.dataset.t));
    });
    // Pages come back after an error message; Money only with a card to show.
    PAGES.forEach((p, i) => { $(p).hidden = this._tabs[i].hidden = !html[i]; });
    if (focused) focusTarget($(focusedPage), focused)?.focus({ preventScroll: true });
  }
}

// The sky's colours as colours, so they can glide (see .sky's transition). Registered for the whole page,
// as an @property inside a shadow root is ignored, under names nothing else in Home Assistant uses
// (window.CSS: CSS here is the stylesheet).
for (const i of [1, 2, 3]) try { window.CSS.registerProperty({ name: `--sv-sky${i}`, syntax: "<color>", inherits: false, initialValue: "transparent" }); } catch (e) { /* registered already, by an older copy of this file */ }

// A tab left open across an update loads the new version beside the old one: keep the old
// element until the page is refreshed instead of throwing.
if (!customElements.get("solar-view")) customElements.define("solar-view", SolarView);
export { STRINGS, LANGUAGES, loadLanguage, formats, clockOf, totals, ring, SKY, skyAt, dawnOf, greyOf, moonPhase, paybackLeft, monthSun, seasonGuess, yearKeys, shareRing, paybackCard, socDay, moneyHtml, battDayCard, wearOf }; // for the checks in the preview harness

/*
 * Most icons in solar-view.js are taken from Lucide (https://lucide.dev): sun, cloud, cloud-sun,
 * cloud-rain (drops slanted), cloud-snow, plug, plug-zap, zap, chart-column, coins,
 * circle-question-mark, washing-machine, cake, utensils, shirt, sparkle, smartphone-charging, wind,
 * wifi-off, move-left, move-right, triangle-alert and clock. The moon, battery, house, gear and tick
 * are drawn by this project.

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
