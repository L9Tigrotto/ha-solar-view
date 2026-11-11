/* What the advice card says: the advice kind, its lines, and the battery's word. Pure. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
const { DAY, HOUR, LASTS_MAX_H, warnOnce } = await import(`./core.js${v}`);

// ---- Rules (tune here) ----
const POOR_SHARE = 0.55;      // a forecast for today under this share of a usual day is a poor day
const BETTER_TIMES = 1.5;     // tomorrow must beat today by this factor before saying "wait for tomorrow"
const LASTS_MIN_H = 0.5;      // "enough until" is only shown from this many hours up to LASTS_MAX_H
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
const LOW_SOLAR_W = 100;  // "no real sun" for the low battery warning
const MIN_FLOW_W = 20;    // below this a flow is treated as off
// Battery wear (see wearOf): a warning below this state of health, or this many years after the battery
// was installed (most warranties end at 10).
const WEAR_HEALTH_PCT = 70;
const WEAR_YEARS = 9.5;

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

export { advice, outlookAdvice, wearOf, advicePool, withOwnAdvice, outlookLastsH, batteryWord, isLow, isHigh, gridCharging, sources, MIN_FLOW_W, EXPORT_W, IMPORT_W };
