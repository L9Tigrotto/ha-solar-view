/* What the page shows, as one plain object (readData): the live states (live), what the statistics give
   (project), and the forecast with what follows from it (predict), worked out at the level the page predicts
   at (modeOf). Also the copy this browser keeps for the next visit's skeleton (slim), and the skeleton's
   numbers (placeholder). */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("./core.js"), typeof import("./sky.js"), typeof import("./advice.js"),
 *   typeof import("./config.js"), typeof import("./forecast.js"), typeof import("./stats.js"),
 *   typeof import("./money.js")]} */
const [{ HOUR, NOON, FULL_SOC, clockOf, dayHours, hourStart, inHour, shiftKey, stateNum, numberOrEntity, sumKnown, warnOnce },
  { SKY_LOW_DEG, weatherOf, cloudNow, raining, snowing, dawnOf, greyOf, coverOf, moonPhase }, { wearOf }, { BATTERY_FLOOR_SOC },
  { sensorOf, forecastOf, lookAhead, bandOf, bandPrices }, { ENERGY }, { moneySoFar }] = await Promise.all([
  import(`./core.js${v}`), import(`./sky.js${v}`), import(`./advice.js${v}`), import(`./config.js${v}`), import(`./forecast.js${v}`), import(`./stats.js${v}`), import(`./money.js${v}`)]);

const SUN = "sun.sun";
const WATTS = { W: 1, kW: 1e3, MW: 1e6 };
const SOLAR_NOISE_W = 15; // an inverter can report a few watts all night (7 to 8 W measured)

// ---- How far the page predicts (decision 1 in docs/audit/06-fix-plan.md) ----
// none: nothing. usual_days: the usual day's sun (the season scaling it, see usualDay) and use, no Solar
// Forecast. weather: the sensor's sun, no house use. usual_days_weather: the Energy settings' Solar Forecast for
// the sun, the usual day for use once one is on record. learned_weather: the sensor's sun and use. The last three without their data
// step down (STEP), again while data is missing; each step is said once in the console, nothing on screen.
/** @typedef {"none" | "usual_days" | "weather" | "usual_days_weather" | "learned_weather"} Level */
/** @typedef {{ level: Level, sensorFresh: boolean }} Mode the level in use after any step down; the sensor is fresh (see sensorOf) */
/** @type {Record<string, Level>} */
const STEP = { weather: "none", learned_weather: "usual_days_weather", usual_days_weather: "usual_days", usual_days: "none" };
/** @type {Mode} */
const NO_MODE = { level: "none", sensorFresh: false };
// `level` is the config's (null: auto, which says nothing when it settles lower: the fresh sensor, else the page's own
// forecast, else none). The Solar Forecast alone is enough for usual_days_weather, at auto and when set: it gives
// the advice its "soon", "later" and "wait" before a usual day is on record. `usual`: a usual day is on record
// (3 days); `solar`: the Solar Forecast answered.
/** @param {Level | null} level @returns {Mode} */
function modeOf(level, { usual = false, solar = false } = {}, sensor, now) {
  const s = sensorOf(sensor, now), sensorFresh = !!s;
  const has = { none: true, usual_days: usual, weather: sensorFresh, usual_days_weather: solar, learned_weather: sensorFresh && s.withUse };
  if (level == null) return { level: has.learned_weather ? "learned_weather" : sensorFresh ? "weather" : solar ? "usual_days_weather" : usual ? "usual_days" : "none", sensorFresh };
  const NOUSUAL = "no usual day yet (it needs 3 days on record)";
  const why = { weather: "no fresh forecast sensor (sensor.solar_view_forecast)", learned_weather: "no fresh forecast sensor with house use",
    usual_days_weather: "no Solar Forecast in the Energy settings", usual_days: NOUSUAL };
  let l = level;
  while (!has[l]) { warnOnce(`level ${l}: ${why[l]}, so ${STEP[l]} is used`); l = STEP[l]; }
  return { level: l, sensorFresh };
}
// The sensor is the forecast in use: its days, hours and ranges, not the page's own.
/** @param {Mode} mode */
const fromSensor = (mode) => mode?.level === "weather" || mode?.level === "learned_weather";
// The forecast sensor without house use (its mode Weather): sun and sky only. Nothing from the usual day
// shows beside it (the coming days' use line, payback's time left), nor money it cannot know (month end).
/** @param {Data} data */
const weatherOnly = (data) => data.mode?.level === "weather" && !!data.ahead;
// Payback's time left: while the page predicts anything, as with a forecast or a usual day; not beside weather alone.
/** @param {Data} data */
const paybackPredicts = (data) => !weatherOnly(data) && !!(data.outlook || data.usualToday);

// The figures the advice reads for "soon", "later" and "wait" (see advice): the sensor's hours and days when it is
// the forecast in use (B5), the Energy settings' Solar Forecast at usual_days_weather (see totals), else none
// (usual_days has the usual day's sun only, no forecast of it). fade in W: this hour's sun and the next 3 hours'
// mean; today and tomorrow in kWh; usual the usual day's sun (see sunUsual in totals).
function adviceForecast(mode, stats, ahead, now, clock) {
  if (mode.level === "usual_days_weather") return stats.forecast ?? null;
  if (!ahead || !fromSensor(mode)) return null;
  const at = (i) => (ahead.hours.find((h) => h.t === hourStart(now + i * HOUR, clock))?.sun[1] ?? 0) * 1000; // kWh in an hour is its mean kW
  const day = (k) => { const x = ahead.days.find((d) => d.d === k)?.sun?.[1]; return Number.isFinite(x) ? x : null; };
  const today = clock(now).key, sun = day(today);
  return sun === null ? null : { fade: { now: at(0), next: (at(1) + at(2) + at(3)) / 3 }, today: sun, tomorrow: day(shiftKey(today, 1)), usual: stats.sunUsual ?? null };
}

// The tariff's bands and their prices ({ type, prices: { f1, ... }, share }), or null: each band's price typed (a
// number or an entity), else learned from the price sensor's hour means and its value now. A band left without
// one: no bands, and prices are left out of the advice. share: what part of this month's grid energy was bought
// in each band (null with nothing bought yet). Worked out apart from the forecast: a sensor that cannot be read
// must not take the prices card with it (B11).
// ponytail: from the hour rows, so the hour under way is not in the share yet; add todayHours if that ever matters.
function bandsOf(hass, ids, cfg, stats, now, clock) {
  const tf = cfg.tariff;
  if (!tf) return null;
  const prices = bandPrices(tf.type, Object.fromEntries(Object.entries(tf.prices).map(([k, p]) => [k, numberOrEntity(p, hass)])),
    tf.sensor ? [...(stats.priceRows ?? []), { start: now, mean: stateNum(hass, tf.sensor) }] : [], clock);
  if (!prices) { warnOnce("tariff needs a type (single, two, three) and a price for each of its bands, from prices or sensor"); return null; }
  const used = {}, month = clock(now).key.slice(0, 7);
  for (const id of ids.gridImportKwh) for (const r of stats.gridMonth?.[id] ?? []) {
    const c = clock(r.start);
    if (r.change > 0 && c.key.startsWith(month)) { const b = bandOf(c.key, c.hour, tf.type); used[b] = (used[b] ?? 0) + r.change; }
  }
  const bought = Object.values(used).reduce((a, x) => a + x, 0);
  return { type: tf.type, prices, share: bought > 0 ? Object.fromEntries(Object.keys(prices).map((b) => [b, (used[b] ?? 0) / bought])) : null };
}

// The forecast and what follows from it (ghosts, lasts until, best time, money, month end), worked out when the
// statistics load and when the sensor writes, not on every redraw.
// facts: the fresh sensor (see sensorOf), whose sky, prices and months are facts used at every level (B7); null
// when it is not fresh. A sensor that cannot be read leaves the page without a forecast, nothing else.
/** @typedef {import("./forecast.js").Ahead} Ahead */
/** @typedef {import("./forecast.js").Outlook} Outlook */
/** bands: see bandsOf; forecast: see adviceForecast.
 * @typedef {{ mode: Mode, ahead: Ahead | null, outlook: Outlook | null, bands: any, forecast: any, facts: any }} Looked */
/** @param {import("./config.js").Config} cfg @returns {Looked} */
function predict(hass, ids, cfg, stats, sensor, now, clock) {
  const out = { mode: NO_MODE, ahead: null, outlook: null, bands: bandsOf(hass, ids, cfg, stats, now, clock), forecast: null, facts: null };
  try {
    const facts = sensorOf(sensor, now), n = reading(hass, ids), price = pricesOf(hass, ids);
    const mode = modeOf(cfg.level, { usual: !!stats.usual, solar: Object.keys(stats.solarWh ?? {}).length > 0 }, sensor, now);
    const usual = stats.usual && { solarW: stats.usual.solarW, loadW: stats.usual.balanceW, spread: stats.usual.spread, machineW: stats.usual.machineW, scale: stats.usual.scale };
    // Export capped and the battery full at some point today: the sun so far was held back (see forecastOf).
    const throttled = cfg.exportMaxKw != null && ((stats.socDay ?? []).some(([, p]) => p >= FULL_SOC) || n.soc >= FULL_SOC);
    const base = { now, clock, solarWh: stats.solarWh, usual, price, sunSoFar: stats.today.solarKwh, sunUntil: stats.sunUntil, throttled };
    const l = mode.level, ahead = l === "none" ? null : l === "weather" ? forecastOf({ ...base, sensor, sunOnly: true })
      : forecastOf({ ...base, sensor: l === "learned_weather" ? sensor : null, solarWh: l === "usual_days" ? {} : stats.solarWh });
    // Hours already past are priced by the sensor's own hours while it is fresh, else at the flat price.
    const given = new Map((facts?.hours ?? []).map((h) => [h.t, h]));
    const priceAt = (field) => (t) => (given.has(t) ? given.get(t)[field] : price[field]);
    const standby = stats.standbyW / 1000, soFar = moneySoFar(stats.todayHours, priceAt("buy"), priceAt("sell"), standby, now);
    const batt = hasBattery(ids) ? cfg.batt : null;
    const battery = batt && { kwh: batt.kwh, floor: batt.floor, maxChargeKw: batt.maxChargeKw, maxDischargeKw: batt.maxDischargeKw, efficiency: stats.efficiency };
    // Without house use (level weather) there is no outlook: the page shows what it shows without a forecast (no
    // ghosts, money, best time, lasts until). So does a day whose statistics are incomplete: an unknown figure must
    // not count as 0 in what follows from them.
    const known = ENERGY.every((part) => Number.isFinite(stats.today[part]));
    const bands = out.bands, bandAt = bands && ((t) => { const c = clock(t), band = bandOf(c.key, c.hour, bands.type); return { band, buy: bands.prices[band] }; });
    const settings = { exportMaxKw: cfg.exportMaxKw, standbyKwhPerHour: standby, machines: (stats.machines ?? []).filter(Boolean),
      quiet: cfg.quiet, gridMaxKw: cfg.gridMaxKw, marginPct: cfg.marginPct, bandAt };
    const outlook = ahead?.left.use && known ? lookAhead(ahead, now, clock, n, battery, settings, soFar) : null;
    Object.assign(out, { mode, ahead, outlook, facts, forecast: adviceForecast(mode, stats, ahead, now, clock) });
  } catch (e) {
    console.warn("solar-view: the forecast could not be read", e);
  }
  return out;
}

// ---- The live states ----
const hasBattery = (ids) => ids.battW.length > 0 || ids.soc.length > 0;
// Watts summed over some entities, each in its own unit.
const watts = (hass, list) => list.reduce((sum, id) => sum + (stateNum(hass, id) ?? 0) * (WATTS[hass.states[id]?.attributes?.unit_of_measurement] ?? 1), 0);
// The present reading: power in W each way, and the charge (several batteries weighted, see readConfig).
function reading(hass, ids) {
  const raw = watts(hass, ids.solarW);
  const solar = raw < SOLAR_NOISE_W ? 0 : raw;
  const batt = watts(hass, ids.battW);   // positive: discharging
  const grid = watts(hass, ids.gridW);   // positive: importing
  const socs = ids.soc.map((id) => [stateNum(hass, id), ids.socWeight[id] || 1]).filter((s) => s[0] !== null);
  return {
    solarW: solar,
    loadW: ids.loadW.some((id) => stateNum(hass, id) !== null) ? watts(hass, ids.loadW) : Math.max(0, solar + batt + grid),
    gridImportW: Math.max(0, grid), gridExportW: Math.max(0, -grid),
    batteryChargeW: Math.max(0, -batt), batteryDischargeW: Math.max(0, batt),
    // null: there is a battery, but nothing tells how full it is.
    soc: socs.length ? socs.reduce((a, s) => a + s[0] * s[1], 0) / socs.reduce((a, s) => a + s[1], 0) : null,
  };
}
// The Energy settings' prices now: text is an entity id, unless it is a number typed as text.
const pricesOf = (hass, ids) => ({ buy: numberOrEntity(ids.price.buy, hass), sell: numberOrEntity(ids.price.sell, hass) });

// What `hass` says now: the reading, the sun, the sky (the fresh sensor's present hour wins for cloud and rain,
// at every level, B7), the moon, the battery's wear, the prices, and the settings the cards read.
function live(hass, ids, cfg, facts, now) {
  const sun = hass.states[SUN];
  const elevation = parseFloat(sun?.attributes?.elevation); // NaN while sun.sun has no value
  const raw = watts(hass, ids.solarW);
  // The fresh sensor's hour holding now ({} when it has none), null without a fresh sensor.
  const hour = facts ? facts.hours.find((h) => inHour(h.t, now)) ?? {} : null;
  const weather = weatherOf(hass), wx = weather?.state, cloud = cloudNow(hour, weather?.attributes?.cloud_coverage), rain = raining(hour, wx), snow = snowing(wx);
  const battery = hasBattery(ids);
  return {
    now: reading(hass, ids),
    // Kept simple: without sun.sun the sky falls back to three steps from solar power.
    sun: Number.isFinite(elevation) ? { elevation, rising: !!sun.attributes.rising, dawn: dawnOf(sun.attributes) }
      : { elevation: raw >= 500 ? 30 : raw >= SOLAR_NOISE_W ? SKY_LOW_DEG : -10, rising: false },
    // Grey rounded, so the redraw key does not move with every digit.
    weather: { grey: Math.round(greyOf(cloud) * 100) / 100, rain, snow, cover: coverOf(cloud, rain, snow) },
    // The moon as it is seen here: south of the equator it is lit from the other side.
    moon: { phase: moonPhase(now), south: hass.config?.latitude < 0 },
    // No battery at all: its card, its place in the flow and its rows are left out.
    batt: battery ? cfg.batt : null,
    wear: battery ? wearOf(cfg.batt, Math.min(...ids.healthPct.map((id) => stateNum(hass, id) ?? Infinity)), now) : null,
    sends: cfg.exportMaxKw !== 0, // export is on: what is sent, the sell price and what it earned show
    payback: cfg.payback,
    lat: hass.config?.latitude ?? null, // payback's seasons
    price: pricesOf(hass, ids),
    // The fresh sensor's prices this hour (B7): the prices card's sell price, and its buy price without bands.
    priceNow: hour && { buy: hour.buy ?? null, sell: hour.sell ?? null },
    billFixedNow: numberOrEntity(cfg.billFixed, hass),
  };
}

// ---- What the statistics give ----
// The part of the statistics (see totals) the cards draw: an allow-list, so what only the forecast reads (its
// inputs, a month of grid hours, the price sensor's rows) stays out of the redraw key and the saved copy.
function project(stats) {
  const { today, lastMonth, month, monthDays, pastDays, monthKey, months, usualToday, sunDays, usualSun, usualSunDays, fixedMonths, socDay, todayHours } = stats;
  const round = (x, to) => (Number.isFinite(x) ? Math.round(x * to) / to : null), socAt = new Map(socDay);
  return { today, lastMonth, month, monthDays, pastDays, monthKey, months, usualToday, sunDays, usualSun, usualSunDays, fixedMonths,
    // Today by the hour, oldest first: { t: hour start, soc: mean charge %, then in kWh what the battery took in
    // (charge) and gave back (batt), the sun made, the house used, the grid gave, and the house's use as the balance
    // (as the forecast counts it) }, rounded; null where the statistics have no row.
    battDay: [...new Set([...socAt.keys(), ...Object.keys(todayHours).map(Number)])].sort((a, b) => a - b).map((t) => {
      const p = socAt.get(t), h = todayHours[t], kwh = (k) => (h ? round(h[k], 100) : null);
      return { t, soc: p === undefined ? null : round(p, 10), charge: kwh("chargeKwh"), batt: kwh("batteryKwh"), sun: kwh("solarKwh"),
        house: kwh("houseKwh"), grid: kwh("gridImportKwh"), balance: kwh("loadKwh") };
    }),
  };
}

// Everything the page shows, as one plain object: live states from `hass`, the rest from `stats` (see totals) and
// `looked` (see predict). `ids` are the entities to read, `cfg` the owner's settings (see readConfig).
// project() once per statistics load, not on every state change.
const projected = new WeakMap();
/** @returns {ReturnType<typeof project>} */
const projectOnce = (stats) => projected.get(stats) ?? projected.set(stats, project(stats)).get(stats);
/** Everything the page shows: its fields are readData's, live's and project's.
 * @typedef {ReturnType<typeof readData>} Data */
/** @param {import("./config.js").Config} cfg @param {Partial<Looked>} [looked] */
function readData(hass, ids, cfg, stats, looked = {}, now = Date.now()) {
  const { billFixedNow, ...state } = live(hass, ids, cfg, looked.facts, now), { fixedMonths, ...drawn } = projectOnce(stats);
  return { ...state, ...drawn,
    // The bill's fixed part: its month means (see fixedAt), and its value now.
    billFixed: { months: fixedMonths ?? {}, now: billFixedNow },
    mode: looked.mode ?? NO_MODE, ahead: looked.ahead ?? null, outlook: looked.outlook ?? null, forecast: looked.forecast ?? null,
    // The tariff's bands and their prices ({ type, prices: { f1, ... } }), or null.
    bands: looked.bands ?? null,
    // The fresh sensor's months (B7): finished months' money as it counted it, and this month's end.
    sensorMonths: looked.facts?.months ?? null,
  };
}

// ---- The copy kept for the next visit ----
// The skeleton's copy (P10): every card's shape, not every figure behind it. The forecast's hours go (no card
// draws an hour ahead from them while loading), and each of the 11 past months' days become one entry holding the
// month's sun (Production's bars; a month's days are drawn only once it is picked).
const slim = (data) => ({ ...data,
  ahead: data.ahead && { ...data.ahead, hours: [] },
  pastDays: Object.fromEntries(Object.entries(data.pastDays ?? {}).map(([k, days]) =>
    [k, [{ date: days[0]?.date, solarKwh: sumKnown(days.map((d) => (d.none ? null : d.solarKwh))) }]])),
});

// Numbers for the loading skeleton. Best is what this browser showed last time (`last`, see slim and
// remembered): same optional rows and text widths, so nothing moves when the real data lands. Only the sky is
// taken fresh. Typical numbers on a first visit, in the shape the Energy settings give (`ids` and `cfg`, once
// they answered): a battery or not, prices, export, payback, so the same pages and cards show.
const LAST_KEY = "solar-view-last";
function remembered() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY));
    // A copy from before the hour rows had names holds them as lists.
    if (last && last.now && last.monthDays && "batt" in last && "sends" in last && !Array.isArray(last.battDay?.[0])) return last;
  } catch (e) { /* no storage, or an old shape: use typical numbers */ }
  return null;
}
function placeholder(hass, ids, cfg, last, now = Date.now()) {
  const sun = hass.states[SUN], elevation = parseFloat(sun?.attributes?.elevation);
  const fresh = { sun: { elevation: Number.isFinite(elevation) ? elevation : 30, rising: !!sun?.attributes?.rising, dawn: dawnOf(sun?.attributes) }, weather: { grey: 0, rain: false, snow: false, cover: "" },
    moon: { phase: moonPhase(now), south: hass.config?.latitude < 0 } };
  // The icon over the flow keeps last time's cloud, so it does not change shape when the data lands. A copy from
  // before levels predicts nothing.
  if (last) return { mode: NO_MODE, ...last, ...fresh, weather: { ...fresh.weather, cover: last.weather?.cover ?? "" } };
  const day = (solarKwh, loadKwh, gridExportKwh = 0) =>
    ({ solarKwh, loadKwh, gridImportKwh: 0.2, gridExportKwh, batteryKwh: solarKwh * 0.4, chargeKwh: solarKwh * 0.45, days: 20 });
  // The sun is known while loading: by day it fills the battery, by night the battery carries the house.
  const solarW = fresh.sun.elevation > 0 ? 1500 : 0;
  // Before the Energy settings answer: a battery, export on, no prices (see _render, which waits for them).
  const battery = !ids || hasBattery(ids), soc = !ids || ids.soc.length ? 50 : null;
  // Today in Home Assistant's time zone, as the loaded page counts it, not the browser's.
  const clock = clockOf(hass.config?.time_zone), today = clock(now).key, month = today.slice(0, 7);
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
    batt: battery ? { kwh: 10, floor: cfg?.batt.floor ?? BATTERY_FLOOR_SOC } : null, sends: cfg?.exportMaxKw !== 0, forecast: null,
    price: { buy: ids?.price.buy != null ? 0.25 : null, sell: ids?.price.sell != null ? 0.08 : null }, payback: cfg?.payback ?? null,
    // The hours done since midnight and this one so far (its figures show under the charts, with no charge mean
    // until it ends), a day the clocks change too (see battDayCard).
    battDay: hours.map((t, i) => ({ t, soc: i < hours.length - 1 ? 50 : null, charge: 0, batt: 0, sun: 0.5, house: 0.5, grid: 0 })),
    ahead: null, outlook: null, mode: NO_MODE,
  };
}

export { LAST_KEY, NO_MODE, modeOf, fromSensor, weatherOnly, paybackPredicts, adviceForecast, bandsOf, predict, reading, live, project, readData, slim, remembered, placeholder };
