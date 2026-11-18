/* Forecast part of the solar page: the day simulation and the numbers derived from the forecast.
   Plain functions, so the preview and the tests in test/ can run them as they are.
   The simulation cases in preview/simulate-cases.json pin the rules; change both together. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale core.js
/** @type {typeof import("./core.js")} */
const { HOUR, FIVE_MIN, FULL_CHARGE, LASTS_MAX_H, WHOLE_DAY_H, hourStart, dayHours, shiftKey, shiftMonth, sumKnown } = await import(`./core.js${v}`);

// ---- Rules (tune here) ----
const EFFICIENCY = 0.95;   // battery round trip until there are enough days to measure it
const EFFICIENCY_MIN = 0.85;
const EFFICIENCY_MAX = 1;
const EFFICIENCY_DAYS = 7; // days of battery rows needed before the measured round trip is trusted

// Battery round trip from the statistics: out / in, clamped, the default until enough days.
export const efficiencyOf = (outKwh, inKwh, days) =>
  !(days >= EFFICIENCY_DAYS) || !(inKwh > 0) || !(outKwh >= 0) ? EFFICIENCY : Math.min(EFFICIENCY_MAX, Math.max(EFFICIENCY_MIN, outKwh / inKwh));

// Walks the hours from now: spare sun charges the battery (capped by the charge rate and the room left,
// losses taken on the way in), then goes to the grid up to the export limit, the rest is lost (throttled).
// A shortfall takes the battery down to its floor (capped by the discharge rate), then the grid. The
// present hour counts firstShare of its sun, use and limits. kwh 0 is no battery. kWh and percent out,
// one step per hour.
export function simulate(hours, chargeLevel, battery, exportMaxKw, firstShare) {
  const { kwh, floor, maxChargeKw, maxDischargeKw = null, efficiency } = battery;
  const floorKwh = (kwh * floor) / 100;
  // A charge under the floor (floor typed wrong, grid charging) still counts from the floor: never negative.
  // Over 100 % or no value at all (sensor unavailable) would make energy from nothing or NaN everywhere.
  let stored = kwh > 0 ? Math.min(kwh, Math.max((kwh * (Number.isFinite(chargeLevel) ? chargeLevel : floor)) / 100, floorKwh)) : 0;
  return hours.map((h, i) => {
    const share = i === 0 ? firstShare : 1;
    const sun = h.sun * share, use = h.use * share;
    let fromBattery = 0, fromGrid = 0, toGrid = 0, lost = 0;
    if (sun >= use) {
      const spare = sun - use;
      const charge = Math.min(spare, maxChargeKw == null ? Infinity : maxChargeKw * share, (kwh - stored) / efficiency);
      stored += charge * efficiency;
      toGrid = Math.min(spare - charge, exportMaxKw == null ? Infinity : exportMaxKw * share);
      lost = spare - charge - toGrid;
    } else {
      fromBattery = Math.max(0, Math.min(use - sun, stored - floorKwh, maxDischargeKw == null ? Infinity : maxDischargeKw * share)); // 0 when the charge is under the floor
      stored -= fromBattery;
      fromGrid = use - sun - fromBattery;
    }
    return { t: h.t, made: sun - lost, fromBattery, fromGrid, toGrid, lost, chargeLevel: kwh > 0 ? (stored / kwh) * 100 : 0 };
  });
}

// ---- The forecast shape ----
/** A forecast hour from its start t (ms): sun and use in kWh as [low, mid, high] (use null without house use),
 * then cloud, rain and the prices, null when not known.
 * @typedef {{ t: number, sun: number[], use: number[] | null, cloud: number | null, rain: number | null,
 *   buy: number | null, sell: number | null }} Hour */
/** The forecast in use (see forecastOf): the sensor's or the page's own, its hours from the present one on, the
 * rest of today (`left`), whole days by key (`d`), tomorrowSun false when tomorrow's sun is only the usual day's,
 * and the machines' usual W by clock hour.
 * @typedef {{ from: "sensor" | "page", hours: Hour[], left: { sun: number[], use: number[] | null },
 *   days: { d: string, sun: number[], use: number[] | null, cloud?: number, rain?: number }[], tomorrowSun: boolean,
 *   machineW: number[] | null }} Ahead */
const FRESH_MS = 3 * HOUR; // a sensor older than this is not trusted: the page builds its own
const SKY_MIN_KWH = 0.5;   // today's usual sun by now before the sun so far scales the rest of today
const SKY_MAX = 1.5;       // at most this many times the usual sun for the rest of today
export const SOLAR_SPREAD = 0.2;  // the low and high run of a day from the Energy settings' solar forecast: this much either way

// [low, mid, high] of one field summed over the hours of day `key` from `from` on; the hour
// holding `from` counts only its part still ahead.
const sumOf = (hours, field, clock, key, from) => hours.reduce((s, h) =>
  h.t + HOUR <= from || clock(h.t).key !== key ? s : s.map((v, i) => v + h[field][i] * Math.min(1, (h.t + HOUR - from) / HOUR)), [0, 0, 0]);

// The forecast sensor (sensor.solar_view_forecast) when it can be trusted, else null: written less than FRESH_MS
// ago (either way: a time ahead of this clock would otherwise stay fresh for ever; a small skew still passes),
// `days` a list of dated entries, `left.sun` and every hour's sun given. Its hours parsed, in order of t; a t
// that does not parse, an hour given twice (the first kept) or an entry that is no hour at all is dropped.
export function sensorOf(sensor, now) {
  const a = sensor?.attributes, written = Date.parse(sensor?.state);
  const hours = (Array.isArray(a?.hours) ? a.hours : []).filter((h) => h && typeof h === "object")
    .map((h) => ({ t: Date.parse(h.t), sun: h.sun, use: h.use, cloud: h.cloud ?? null, rain: h.rain ?? null, buy: h.buy ?? null, sell: h.sell ?? null }))
    .filter((h) => Number.isFinite(h.t)).sort((x, y) => x.t - y.t).filter((h, i, s) => !i || h.t !== s[i - 1].t);
  const fresh = Math.abs(now - written) < FRESH_MS && Array.isArray(a?.days) && a.days.every((d) => d && typeof d.d === "string")
    && Array.isArray(a.left?.sun) && hours.length > 0 && hours.every((h) => Array.isArray(h.sun));
  return fresh ? { written, hours, days: a.days, left: a.left } : null;
}

// The usual day's sun in the hour starting at t, W, as the season moves it (usual.scale, see usualDay in stats.js).
export const usualSunAt = (usual, t, clock) => usual.solarW[clock(t).hour] * (usual.scale?.(t) ?? 1);

// The sensor as it is when fresh (see sensorOf), else what the page can build from the solar forecast (solarWh,
// hour start in ms to Wh) and the usual day; null without a usual day. Hours start at the present
// hour, `left` is the rest of today from now.
// A fresh sensor is read for its sun alone (level weather): the forecast for sun, cloud and rain, any house use it
// gives dropped; its `left.use` is then null, and nothing that needs use is worked out.
// sunSoFar: kWh the sun made today, by sunUntil (ms, the end of its statistics; now when not known); it
// scales today's usual sun, see below, never down when `throttled`.
/** @returns {Ahead | null} */
export function forecastOf({ sensor, now, clock, solarWh, usual, price, sunSoFar, sunUntil, throttled = false }) {
  const today = clock(now).key, start = hourStart(now, clock);
  const a = sensorOf(sensor, now), fresh = !!a, written = a?.written;
  const given = a?.hours.map((h) => ({ ...h, use: null }));
  if (!fresh && !usual) return null;
  const usualSun = (t) => usualSunAt(usual, t, clock) / 1000; // kWh
  const nextMonth = shiftMonth(today.slice(0, 7), 1) + "-01";
  // guessed: no solar forecast for tomorrow, so tomorrow's sun is the usual day's.
  let all, days, guessed = false;
  if (fresh) {
    all = given;
    days = a.days.filter((d) => d.d >= today).map((d) => ({ ...d, use: null }));
  } else {
    // From the first hour of today on to the end of tomorrow, or of the month when that is later (the
    // money of the days to come, see lookAhead): walking by the hour, so a 23 or 25 hour day needs nothing special.
    const end = [shiftKey(today, 2), nextMonth].sort()[1], first = dayHours(now, clock)[0];
    // A day the solar forecast has any hour of is the forecast's, its missing hours no sun (a forecast
    // leaves out the night); a day it has none of is the usual day's.
    const covered = new Set(Object.keys(solarWh ?? {}).map((t) => clock(+t).key));
    guessed = !covered.has(shiftKey(today, 1));
    // Today on the usual day goes as the sun went so far: made by now over the usual day by now, once
    // the usual day had SKY_MIN_KWH by now (a grey morning makes a grey afternoon), at most SKY_MAX.
    // ponytail: one factor for the whole rest of today; weigh recent hours more if mornings mislead.
    // By now means by the end of the statistics behind sunSoFar (sunUntil): they lag a few minutes.
    const upTo = Math.min(now, sunUntil ?? now);
    let usualByNow = 0;
    for (let t = first; t < upTo; t += HOUR) usualByNow += usualSun(t) * Math.min(1, (upTo - t) / HOUR);
    // throttled: export is capped and the battery was full today, so the sun so far was held back, not
    // clouded: it may only raise the rest of today.
    const sky = covered.has(today) || !(usualByNow >= SKY_MIN_KWH) || !Number.isFinite(sunSoFar) ? 1
      : Math.min(SKY_MAX, throttled ? Math.max(1, sunSoFar / usualByNow) : sunSoFar / usualByNow);
    // Low and high: a forecast day SOLAR_SPREAD either way; a usual day's sun, and house use, as its days
    // spread (usual.spread: [low, high] over the mean, see usualDay).
    const spread = usual.spread ?? { sun: [1, 1], use: [1, 1] }, solar = [1 - SOLAR_SPREAD, 1 + SOLAR_SPREAD];
    const range = (v, [low, high]) => [v * low, v, v * high];
    all = [];
    for (let t = first; clock(t).key !== end; t += HOUR) {
      const c = clock(t), inForecast = covered.has(c.key);
      const sun = inForecast ? (solarWh[t] ?? 0) / 1000 : usualSun(t) * (c.key === today ? sky : 1);
      const use = usual.loadW[c.hour] / 1000;
      all.push({ t, sun: range(sun, inForecast ? solar : spread.sun), use: range(use, spread.use), cloud: null, rain: null, buy: price?.buy ?? null, sell: price?.sell ?? null });
    }
    days = [today, shiftKey(today, 1)].map((d) => ({ d, sun: sumOf(all, "sun", clock, d, -Infinity), use: sumOf(all, "use", clock, d, -Infinity) }));
  }
  // A range of a total is kept by scaling it with the mid hours still ahead over the mid hours it
  // covers: `left` from its write hour when written today, else today's entry in days from the start
  // of today. Without one (or no mid hours to scale by) the hours are summed, low with low.
  const rebase = (field) => {
    const sameDay = clock(written).key === today;
    const base = sameDay ? a.left[field] : days.find((d) => d.d === today)?.[field];
    const ahead = sumOf(all, field, clock, today, now);
    const whole = sumOf(all, field, clock, today, sameDay ? hourStart(written, clock) : -Infinity)[1];
    return Array.isArray(base) && whole > 0 ? base.map((v) => (v * ahead[1]) / whole) : ahead;
  };
  const left = /** @type {Ahead["left"]} */ (Object.fromEntries(["sun", "use"].map((f) => [f, fresh ? (f === "use" ? null : rebase(f)) : sumOf(all, f, clock, today, now)])));
  const hours = all.filter((h) => h.t >= start);
  return { from: fresh ? "sensor" : "page", hours, left, days, tomorrowSun: !guessed,
    // The machines' usual runs inside house use, W by clock hour (usual.machineW): the advice takes them out.
    machineW: usual?.machineW ?? null };
}

// The hours from now to the end of tomorrow for one scenario: the mid shape, scaled so today sums
// to `left` and tomorrow to its entry in `days`. Bad is low sun with high use, good the reverse.
export function scenarioHours(ahead, kind, now, clock) {
  const i = { bad: 0, mid: 1, good: 2 }[kind];
  const today = clock(now).key, tomorrow = shiftKey(today, 1);
  const next = ahead.days.find((d) => d.d === tomorrow);
  const factor = (field, index) => Object.fromEntries([[today, ahead.left[field][index]], [tomorrow, next?.[field]?.[index]]].map(([key, target]) => {
    const middle = sumOf(ahead.hours, field, clock, key, now)[1];
    return [key, target == null ? 1 : middle > 0 ? target / middle : 0];
  }));
  const sun = factor("sun", i), use = factor("use", 2 - i);
  return ahead.hours.filter((h) => h.t + HOUR > now && clock(h.t).key in sun)
    .map((h) => ({ t: h.t, sun: h.sun[1] * sun[clock(h.t).key], use: h.use[1] * use[clock(h.t).key] }));
}

// The integration's sensors: found by their translation key when the owner renamed them, else by their fixed id.
// The registry's solar_view entries are kept while hass.entities is the same object: Home Assistant replaces it only
// when the registry changes, and this runs on every state change.
let registry, ours = [];
const findOurs = (hass, key, fallback) => {
  if (hass.entities !== registry) {
    registry = hass.entities;
    ours = Object.keys(registry || {}).filter((k) => registry[k]?.platform === "solar_view");
  }
  const id = ours.find((k) => registry[k].translation_key === key && hass.states[k]);
  return hass.states[id ?? fallback];
};
export const findForecast = (hass) => findOurs(hass, "forecast", "sensor.solar_view_forecast");
export const findBills = (hass) => findOurs(hass, "bills", "sensor.solar_view_bills");

// ---- Time bands (Italy, ARERA) ----
// F1 Monday to Friday 8 to 19; F2 Monday to Friday 7 to 8 and 19 to 23, Saturday 7 to 23; F3 the rest,
// and all of Sundays and national holidays. A two band contract prices F1 and F23 (F2 and F3 together),
// a single band one the whole day as F1.
const HOLIDAYS = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"];
const BANDS = { single: ["f1"], two: ["f1", "f23"], three: ["f1", "f2", "f3"] };
// Easter Monday of year y as "MM-DD" (the Gregorian computus).
function easterMonday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return new Date(Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 2)).toISOString().slice(5, 10);
}
// The band of the hour starting at `hour` on day `key` ("2026-11-04"), for a contract of `type`.
export function bandOf(key, hour, type) {
  if (type === "single") return "f1";
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay(), monthDay = key.slice(5);
  const band = weekday === 0 || HOLIDAYS.includes(monthDay) || monthDay === easterMonday(+key.slice(0, 4)) || hour < 7 || hour >= 23 ? "f3"
    : weekday === 6 || hour < 8 || hour >= 19 ? "f2" : "f1";
  return type === "two" && band !== "f1" ? "f23" : band;
}
// Each band's price: the one given (a number), else the mean of the price sensor's rows ({ start, mean })
// in that band's hours. null when a band the contract has gets neither, or the type is unknown.
export function bandPrices(type, given, rows, clock) {
  if (!BANDS[type]) return null;
  const seen = {};
  for (const r of rows ?? []) if (Number.isFinite(r.mean)) { const c = clock(r.start); (seen[bandOf(c.key, c.hour, type)] ??= []).push(r.mean); }
  const out = {};
  for (const b of BANDS[type]) {
    const own = b === "f23" ? given?.f23 ?? given?.f2 : given?.[b];
    out[b] = Number.isFinite(own) ? own : seen[b] ? seen[b].reduce((s, v) => s + v, 0) / seen[b].length : null;
    if (out[b] == null) return null;
  }
  return out;
}

// ---- Machines ----
const RUN_HOUR_KWH = 0.05;  // an hour row with this much or more is part of a run
const RUN_5MIN_KWH = 0.004; // a 5 minute row with this much (about 50 W) or more
const RUN_GAP = 3;          // 5 minute rows a run may pause for (a washer soaking)
const RUN_COUNT = 10;       // the last runs averaged
const RUN_MIN = 3;          // fewer runs on record: the typed figures
const PEAK_KW = 2;          // a machine's peak draw when nothing better is known (a heating element)

// Runs in a machine's energy rows ({ start, change }, in order, `step` ms each): rows of `min` kWh or
// more, joined over pauses of up to `gap` rows. { from, to, kwh, peak } each, peak the highest row.
function runsOf(rows, step, min, gap) {
  const runs = [];
  for (const r of rows ?? []) {
    if (!(r.change >= min)) continue;
    const lastRun = runs.at(-1);
    if (lastRun && r.start - lastRun.to <= gap * step) Object.assign(lastRun, { to: r.start + step, kwh: lastRun.kwh + r.change, peak: Math.max(lastRun.peak, r.change) });
    else runs.push({ from: r.start, to: r.start + step, kwh: r.change, peak: r.change });
  }
  return runs.slice(-RUN_COUNT);
}
// One machine from the config ({ type, kwh, hours, peakKw }) and its sensor's hour and 5 minute rows:
// the energy of a run from the hour rows (kept for ever), its length and peak from the 5 minute rows
// (kept about 10 days), each the typed figure while too few runs are on record. null without a load.
export function machineOf(m, hourRows, fiveRows) {
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const hours = runsOf(hourRows, HOUR, RUN_HOUR_KWH, 0), five = runsOf(fiveRows, FIVE_MIN, RUN_5MIN_KWH, RUN_GAP);
  const kwh = hours.length >= RUN_MIN ? mean(hours.map((r) => r.kwh)) : m.kwh;
  // Hour rows round a run up to whole hours: only when nothing was typed.
  const long = five.length >= RUN_MIN ? mean(five.map((r) => (r.to - r.from) / HOUR)) : m.hours ?? (hours.length >= RUN_MIN ? mean(hours.map((r) => (r.to - r.from) / HOUR)) : null);
  const peakKw = five.length >= RUN_MIN ? Math.max(...five.map((r) => (r.peak * HOUR) / FIVE_MIN)) : m.peakKw ?? PEAK_KW;
  return kwh > 0 && long > 0 ? { type: m.type, kwh, hours: long, peakKw } : null;
}

// ---- What the page derives ----
const FREE_KWH = 0.01;     // a start "takes nothing from the grid" up to this (rounding)
const DEFER_KWH = 0.3;     // a start tomorrow must save what this much grid costs (mean buy price) over today's best
const NIGHT_MAX_H = 12;    // the night after tomorrow is followed for at most this many hours
const NO_BATTERY = { kwh: 0, floor: 0, maxChargeKw: null, efficiency: 1 };
const FILLS_MIN_KWH = 1;   // "fills": the mid run reaches FULL_CHARGE today, then sends or loses this much or more
const TIE = 1e-9;

// One simulated hour's money added to m { saved, cost, earned }: what the grid gave at `buy`, the house's own use
// (`ownUse`, standby taken off) less the grid's part at `buy`, what was sent at `sell`. null + a number is a
// number in JS: a figure whose price is unknown must stay unknown (null).
const addMoney = (m, step, ownUse, price) => {
  const { buy, sell } = price ?? {}, plus = (sum, kwh, rate) => (rate == null || sum == null ? null : sum + kwh * rate);
  m.cost = plus(m.cost, step.fromGrid, buy);
  m.saved = plus(m.saved, Math.max(0, ownUse - step.fromGrid), buy);
  m.earned = plus(m.earned, step.toGrid, sell);
};
// [low, mid, high] over the bad, mid and good runs; null when any run has no value.
const range3 = (v) => (v.some((x) => x == null) ? null : [Math.min(...v), v[1], Math.max(...v)]);

// When the mid run takes the battery to its floor (ms, inside that hour), Infinity when an hour
// needs nothing from it first, null when neither within LASTS_MAX_H. The rows' present hour already
// holds the present reading (lookAhead).
function lastsUntil(rows, now, n, battery, firstShare) {
  if (!Number.isFinite(n.chargeLevel)) return null;
  const { kwh, floor } = battery, floorKwh = (kwh * floor) / 100;
  let left = Math.min(kwh, Math.max((kwh * n.chargeLevel) / 100, floorKwh)) - floorKwh;
  const end = now + LASTS_MAX_H * HOUR;
  for (const [i, r] of rows.entries()) {
    const start = Math.max(now, r.t);
    if (start >= end) return null;
    if (r.sun >= r.use) return Infinity;
    // Past the discharge rate the grid gives the rest: the battery only drains at that rate.
    const share = i ? 1 : firstShare, need = Math.min(r.use - r.sun, battery.maxDischargeKw ?? Infinity) * share;
    if (left <= need) { const t = start + (left / need) * share * HOUR; return t <= end ? t : null; }
    left -= need;
  }
  return null;
}

// The rows with a load of `kwh` spread evenly from `from` over `hours`; the present hour's row (from
// `now` on, firstShare of it) takes its part scaled up, as simulate scales it down.
function withLoad(rows, now, from, kwh, hours, firstShare) {
  const to = from + hours * HOUR, perMs = kwh / (to - from);
  return rows.map((r, i) => {
    const a = Math.max(r.t, now, from), b = Math.min(r.t + HOUR, to);
    return b <= a ? r : { ...r, use: r.use + ((b - a) * perMs) / (i ? 1 : firstShare) };
  });
}
// The runs ([mid, bad], same hours) going on through the night after tomorrow, until the mid run's sun
// covers the house again: tomorrow's first hours again, a day on, each with `from` its source hour. No
// forecast reaches that far, but a night is mostly house use. A start late tomorrow then pays for the
// night it leaves short instead of a guess. Unchanged when the rows stop before the end of tomorrow or
// the sun does not cover the house within NIGHT_MAX_H hours of midnight.
// ponytail: a daylight saving change on the day after tomorrow shifts the copied night by an hour.
function withNight(runs, clock, tomorrow) {
  const end = runs[0].at(-1).t + HOUR;
  if (clock(end - HOUR).key !== tomorrow || clock(end).key === tomorrow) return runs;
  const source = runs.map((runRows) => runRows.filter((r) => clock(r.t).key === tomorrow));
  const up = source[0].findIndex((r) => r.sun >= r.use);
  if (up < 0 || up > NIGHT_MAX_H) return runs;
  return runs.map((runRows, k) => runRows.concat(source[k].slice(0, up).map((r, i) => ({ ...r, t: end + i * HOUR, from: r.t }))));
}

// Inside the quiet hours [from, to) by the clock (hours, a range may pass midnight).
const inQuiet = (c, q) => { const h = c.hour + c.minute / 60; return !!q && q[0] !== q[1] && (q[0] < q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1]); };

// When to start each movable machine (settings.machines, in order, each planned after the ones before),
// with the battery floor raised by settings.marginPercent, so a forecast a little off still leaves it above
// the real floor. The rows run through the night after tomorrow (withNight); starts are now and every
// whole hour of today and tomorrow, never inside the quiet hours. A start is free when it takes nothing
// more from the grid to the end of the rows, counting the charge it leaves missing then (not at sunrise);
// its cost is the grid it adds at each hour's buy price, the export it forgoes at the sell price, the
// missing charge at the last hour's buy price, or its sell price when the rows end at sunrise (kWh alone
// when a buy price is unknown). Each row carries its own buy and sell. Today's starts are judged on the
// mid run; tomorrow's, further off, on the worse of the mid and the bad run (free only when free on both).
// The earliest free start wins, else the cheapest (ties to the earliest). A start tomorrow is taken only
// when it saves DEFER_KWH of grid at the mean buy price over today's best. "wait" instead of now when the
// grid would have to give more than settings.gridMaxKw: the house's draw now plus the machine's peak,
// less the sun now and, above the raised floor, the battery (up to its discharge rate). [{ type, kind:
// "now" | "at" | "wait", t, why, band, kw }] or null.
function advise(rows, bad, now, n, battery, settings, firstShare, clock) {
  const { machines = [], quiet = null, gridMaxKw = null, marginPercent = 0, exportMaxKw } = settings;
  if (!machines.length) return null;
  const marginBattery = battery.kwh > 0 ? { ...battery, floor: Math.min(100, battery.floor + marginPercent) } : battery;
  const runSimulation = (r) => simulate(r, n.chargeLevel, marginBattery, exportMaxKw, firstShare), end = rows.at(-1).t + HOUR;
  const today = clock(now).key, lastStart = rows.find((r) => r.from != null)?.t ?? end;
  // Without a buy price for every hour, kWh: the export forgone then costs nothing.
  const priced = rows.every((r) => Number.isFinite(r.buy)), buy = (r) => (priced ? r.buy : 1), sell = (r) => (priced ? r.sell ?? 0 : 0);
  const deferMin = (DEFER_KWH * rows.reduce((s, r) => s + buy(r), 0)) / rows.length;
  // What starting m at t adds over the rows rs, whose plain run is base. Charge left missing at sunrise
  // (rows through the night) is refilled by that day's sun: export forgone, not grid.
  const dawn = rows.at(-1).from != null;
  const tryOn = (runRows, base, t, m) => {
    const loaded = withLoad(runRows, now, t, m.kwh, m.hours, firstShare), steps = runSimulation(loaded);
    const missing = marginBattery.kwh > 0 ? Math.max(0, (((base.at(-1).chargeLevel - steps.at(-1).chargeLevel) / 100) * marginBattery.kwh) / marginBattery.efficiency) : 0;
    let grid = dawn ? 0 : missing, fromBattery = 0, cost = missing * (dawn ? sell : buy)(runRows.at(-1));
    steps.forEach((step, i) => {
      const more = step.fromGrid - base[i].fromGrid;
      grid += more; fromBattery += step.fromBattery - base[i].fromBattery;
      cost += more * buy(runRows[i]) + (base[i].toGrid - step.toGrid) * sell(runRows[i]);
    });
    return { t, loaded, grid, fromBattery, cost };
  };
  const pickOf = (list) => list.find((w) => w.free) ?? list.reduce((b, w) => (w.cost < b.cost - TIE ? w : b), list[0]);
  const out = [];
  for (const m of machines) {
    const base = runSimulation(rows), baseBad = runSimulation(bad);
    const starts = [now, ...rows.map((r) => r.t).filter((t) => t > now && t < lastStart)].filter((t) => t + m.hours * HOUR <= end + TIE && !inQuiet(clock(t), quiet));
    const tried = starts.map((t) => {
      const middle = tryOn(rows, base, t, m);
      if (clock(t).key === today) return { ...middle, free: middle.grid <= FREE_KWH };
      const worse = tryOn(bad, baseBad, t, m);
      return { ...middle, cost: Math.max(middle.cost, worse.cost), free: middle.grid <= FREE_KWH && worse.grid <= FREE_KWH };
    });
    if (!tried.length) continue;
    const first = tried[0].t === now ? tried[0] : null;
    let pick = pickOf(tried);
    if (clock(pick.t).key !== today) {
      const near = pickOf(tried.filter((w) => clock(w.t).key === today));
      if (near && near.cost - pick.cost < deferMin - TIE) pick = near;
    }
    const c = clock(pick.t), band = settings.bandAt?.(pick.t) ?? null, bandNow = settings.bandAt?.(now) ?? null;
    const free = pick.free, onBattery = pick.fromBattery > m.kwh / 2;
    const why = pick === first ? (free ? (onBattery ? "batteryNow" : "sunNow") : "bestNow")
      : free ? (onBattery ? "marginBattery" : c.key === today ? "sun" : marginBattery.kwh > 0 ? "sunTomorrow" : "sunTomorrowNoBattery")
        : band && bandNow && band.buy < bandNow.buy - TIE ? "cheaper" : "grid";
    // The meter: only for now, the forecast knows hour means, not peaks.
    const room = marginBattery.kwh > 0 && n.chargeLevel > marginBattery.floor ? marginBattery.maxDischargeKw ?? Infinity : 0;
    const draw = ((n.loadW ?? 0) - (n.solarW ?? 0)) / 1000 + m.peakKw - room;
    if (pick === first && gridMaxKw != null && draw > gridMaxKw + TIE) { out.push({ type: m.type, kind: "wait", t: now, why: null, band: null, kw: (n.loadW ?? 0) / 1000 }); continue; }
    out.push({ type: m.type, kind: pick === first ? "now" : "at", t: pick.t, why, band: why === "cheaper" ? band.band : null, kw: null });
    rows = pick.loaded; bad = withLoad(bad, now, pick.t, m.kwh, m.hours, firstShare);
  }
  return out.length ? out : null;
}

// The rest of today simulated for the bad, mid and good runs: when the battery runs to its floor, the
// best time for each machine, the state of charge in an hour (chargeInHour, [low, mid, high] over the runs),
// whether the mid run fills the battery later today with spare sun left over (fills), and the mid run's
// charge, hours and money ahead. n is the present reading { chargeLevel, loadW, solarW }; battery null is no
// battery; soFar is today's money so far { saved, cost, earned }. A battery of unknown size hides all of
// it: every figure would be a guess.
/** @typedef {{ saved: number | null, cost: number | null, earned: number | null }} Money */
/** What follows from the forecast (see lookAhead); chargeAhead's [t, %] rows as its comment below says.
 * @typedef {{ lastsUntil: number | null, best: { type: string, kind: string, t: number, why: string, band: string | null,
 *   kw: number | null }[] | null, chargeInHour: number[] | null, fills: boolean, chargeAhead: number[][] | null,
 *   hoursAhead: { t: number, sun: number, battery: number, grid: number, use: number }[] | null, restToday: Money | null,
 *   daysMoney: ({ key: string } & Money)[] | null }} Outlook */
/** @param {Ahead} ahead @returns {Outlook} */
export function lookAhead(ahead, now, clock, n, battery, settings, soFar) {
  const none = { lastsUntil: null, best: null, chargeInHour: null, fills: false, chargeAhead: null, hoursAhead: null, restToday: null, daysMoney: null };
  if (battery && !battery.kwh) return none;
  const activeBattery = battery || NO_BATTERY, today = clock(now).key, standby = settings.standbyKwhPerHour;
  // The present hour at whichever is worse, the present reading or the forecast hour: an oven switched
  // on now, or a cloud now, counts on every card.
  const present = (r, i) => (i ? r : { ...r, use: Math.max(r.use, (n.loadW ?? 0) / 1000), sun: Math.min(r.sun, (n.solarW ?? Infinity) / 1000) });
  const runs = ["bad", "mid", "good"].map((kind) => scenarioHours(ahead, kind, now, clock).map(present)), rows = runs[1];
  if (!rows.length) return none;
  // The rows hold whole hours; simulate takes the present hour's part itself.
  const firstShare = Math.min(1, (rows[0].t + HOUR - now) / HOUR);
  const price = new Map(ahead.hours.map((h) => [h.t, h]));
  const simulations = runs.map((r) => simulate(r, n.chargeLevel, activeBattery, settings.exportMaxKw, firstShare));
  // The mid run's money by midnight, from today's so far.
  const money = { saved: soFar.saved, cost: soFar.cost, earned: soFar.earned };
  simulations[1].forEach((step, i) => {
    if (clock(step.t).key !== today) return;
    const share = i ? 1 : firstShare;
    addMoney(money, step, rows[i].use * share - standby * share, price.get(step.t));
  });
  // The mid run's money for the rest of today, and on through every whole day the forecast has after today
  // (with a usual day at least to the month's end, see forecastOf), the battery carried from hour to hour:
  // [[date, saved, cost, earned]], a figure null where a price is unknown.
  const minus = (a, b) => (a == null || b == null ? null : a - b);
  const restToday = { saved: minus(money.saved, soFar.saved), cost: minus(money.cost, soFar.cost), earned: minus(money.earned, soFar.earned) };
  const long = ahead.hours.filter((h) => h.t + HOUR > now && Array.isArray(h.use)).map((h, i) => present({ t: h.t, sun: h.sun[1], use: h.use[1] }, i));
  const byDay = new Map();
  simulate(long, n.chargeLevel, activeBattery, settings.exportMaxKw, firstShare).forEach((step, i) => {
    const key = clock(step.t).key;
    if (key === today) return;
    const d = byDay.get(key) ?? byDay.set(key, { hours: 0, saved: 0, cost: 0, earned: 0 }).get(key);
    d.hours++;
    addMoney(d, step, long[i].use - standby, price.get(step.t));
  });
  // A day the forecast stops inside (not whole, see WHOLE_DAY_H) is left out, and every day after it.
  const whole = [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)), cut = whole.findIndex(([, d]) => d.hours < WHOLE_DAY_H);
  const daysMoney = (cut < 0 ? whole : whole.slice(0, cut)).map(([key, d]) => ({ key, saved: d.saved, cost: d.cost, earned: d.earned }));
  // Now + 60 minutes falls inside the second hour, by the part of the first already gone. Read in a
  // straight line across that hour.
  // ponytail: a battery that fills or empties inside that hour reads a little off; split the hour if that ever shows.
  const inHour = (steps) => (steps.length < 2 ? steps[0].chargeLevel : steps[0].chargeLevel + (steps[1].chargeLevel - steps[0].chargeLevel) * (1 - firstShare));
  // The mid run's spare sun today from the hour the battery is full on.
  const full = simulations[1].findIndex((step) => clock(step.t).key === today && step.chargeLevel >= FULL_CHARGE);
  const spare = full < 0 ? 0 : simulations[1].slice(full).reduce((s, step) => s + (clock(step.t).key === today ? step.toGrid + step.lost : 0), 0);
  // Tomorrow's sun only the usual day (no forecast): the bad run, which tomorrow's starts must pass too,
  // has none after today, so a start tomorrow wins on prices or the battery, never on a guessed sun.
  const bad = ahead.tomorrowSun === false ? runs[0].map((r) => (clock(r.t).key === today ? r : { ...r, sun: 0 })) : runs[0];
  // Each row with its prices: the band's buy price, else the forecast hour's. A night hour after tomorrow
  // takes its band from its own time, a forecast price from its source hour.
  const priced = (runRows) => runRows.map((r) => {
    const b = settings.bandAt?.(r.t), h = price.get(r.from ?? r.t);
    return { ...r, buy: b ? b.buy : h?.buy ?? null, sell: h?.sell ?? null };
  });
  // The advice adds each machine run where it plans it: its usual runs of the next 24 hours come out of
  // house use first (the run it plans is the next one; a day later the habit runs again), on the advice's
  // rows only (every other figure keeps them, the machines will run).
  const bare = (runRows) => (ahead.machineW ? runRows.map((r) => (r.t < now + 24 * HOUR ? { ...r, use: Math.max(0, r.use - ahead.machineW[clock(r.t).hour] / 1000) } : r)) : runRows);
  const [night, nightBad] = withNight([bare(rows), bare(bad)], clock, shiftKey(today, 1)).map(priced);
  return {
    lastsUntil: battery ? lastsUntil(rows, now, n, activeBattery, firstShare) : null,
    best: advise(night, nightBad, now, n, activeBattery, settings, firstShare, clock),
    chargeInHour: battery && Number.isFinite(n.chargeLevel) ? range3(simulations.map(inHour)) : null,
    fills: !!battery && spare >= FILLS_MIN_KWH - TIE,
    // The mid run's charge at the end of each hour left today, for Today by hour's charge chart: [end, %].
    chargeAhead: battery ? simulations[1].filter((step) => clock(step.t).key === today).map((step) => [step.t + HOUR, Math.round(step.chargeLevel * 10) / 10]) : null,
    // The mid run's hours left today, for Today by hour and Power origin's small rings: { t: start, sun made,
    // battery: battery gave, grid gave, use: house used }, in kWh; this hour's from now on only.
    hoursAhead: simulations[1].map((step, i) => ({ t: step.t, sun: step.made, battery: step.fromBattery, grid: step.fromGrid, use: rows[i].use * (i ? 1 : firstShare) }))
      .filter(({ t }) => clock(t).key === today),
    restToday, daysMoney,
  };
}
