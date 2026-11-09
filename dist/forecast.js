/* Forecast part of the solar page: the day simulation and the numbers derived from the forecast.
   Plain functions, so the preview and the tests in test/ can run them as they are.
   The simulation cases in preview/simulate-cases.json pin the rules; change both together. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale core.js
const { HOUR, FIVE_MIN, FULL_SOC, LASTS_MAX_H, hourStart, dayHours, shiftKey, shiftMonth } = await import(`./core.js${v}`);

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
export function simulate(hours, soc, battery, exportMaxKw, firstShare) {
  const { kwh, floor, maxChargeKw, maxDischargeKw = null, efficiency } = battery;
  const floorKwh = (kwh * floor) / 100;
  // A charge under the floor (floor typed wrong, grid charging) still counts from the floor: never negative.
  // Over 100 % or no value at all (sensor unavailable) would make energy from nothing or NaN everywhere.
  let stored = kwh > 0 ? Math.min(kwh, Math.max((kwh * (Number.isFinite(soc) ? soc : floor)) / 100, floorKwh)) : 0;
  return hours.map((h, i) => {
    const share = i === 0 ? firstShare : 1;
    const sun = h.sun * share, use = h.use * share;
    let fromBatt = 0, fromGrid = 0, toGrid = 0, lost = 0;
    if (sun >= use) {
      const spare = sun - use;
      const charge = Math.min(spare, maxChargeKw == null ? Infinity : maxChargeKw * share, (kwh - stored) / efficiency);
      stored += charge * efficiency;
      toGrid = Math.min(spare - charge, exportMaxKw == null ? Infinity : exportMaxKw * share);
      lost = spare - charge - toGrid;
    } else {
      fromBatt = Math.min(use - sun, stored - floorKwh, maxDischargeKw == null ? Infinity : maxDischargeKw * share);
      stored -= fromBatt;
      fromGrid = use - sun - fromBatt;
    }
    return { t: h.t, made: sun - lost, fromBatt, fromGrid, toGrid, lost, soc: kwh > 0 ? (stored / kwh) * 100 : 0 };
  });
}

// ---- The forecast shape ----
const FRESH_MS = 3 * HOUR; // a sensor older than this is not trusted: the page builds its own
const SKY_MIN_KWH = 0.5;   // today's usual sun by now before the sun so far scales the rest of today
const SKY_MAX = 1.5;       // at most this many times the usual sun for the rest of today
export const SOLAR_SPREAD = 0.2;  // the low and high run of a day from the Energy settings' solar forecast: this much either way

// [low, mid, high] of one field summed over the hours of day `key` from `from` on; the hour
// holding `from` counts only its part still ahead.
const sumOf = (hours, field, clock, key, from) => hours.reduce((s, h) =>
  h.t + HOUR <= from || clock(h.t).key !== key ? s : s.map((v, i) => v + h[field][i] * Math.min(1, (h.t + HOUR - from) / HOUR)), [0, 0, 0]);

// The sensor as it is when fresh, else what the page can build from the solar forecast (solarWh,
// hour start in ms to Wh) and the usual day; null without a usual day. Hours start at the present
// hour, `left` is the rest of today from now.
// A fresh sensor without house use (mode Weather: `use` null in hours, left or days) is still the
// forecast for sun, cloud and rain; its `left.use` is then null, and nothing that needs use is worked out.
// sunSoFar: kWh the sun made today, by sunUntil (ms, the end of its statistics; now when not known); it
// scales today's usual sun, see below, never down when `throttled`.
export function forecastOf({ sensor, now, clock, solarWh, usual, price, sunSoFar, sunUntil, throttled = false }) {
  const today = clock(now).key, start = hourStart(now, clock);
  const a = sensor?.attributes, written = Date.parse(sensor?.state);
  // Hours in order of t; a t that does not parse or an hour given twice is dropped (the first kept).
  const given = (Array.isArray(a?.hours) ? a.hours : [])
    .map((h) => ({ t: Date.parse(h.t), sun: h.sun, use: h.use, cloud: h.cloud ?? null, rain: h.rain ?? null, buy: h.buy ?? null, sell: h.sell ?? null }))
    .filter((h) => Number.isFinite(h.t)).sort((x, y) => x.t - y.t).filter((h, i, s) => !i || h.t !== s[i - 1].t);
  // The sun is what makes a sensor usable; house use may be switched off (see above).
  // Both ways: a time ahead of this clock would otherwise stay fresh for ever; a small skew still passes.
  const fresh = Math.abs(now - written) < FRESH_MS && Array.isArray(a.days) && Array.isArray(a.left?.sun)
    && given.length > 0 && given.every((h) => Array.isArray(h.sun));
  const withUse = !fresh || (Array.isArray(a.left?.use) && given.every((h) => Array.isArray(h.use)));
  if (!fresh && !usual) return null;
  // guessed: no solar forecast for tomorrow, so tomorrow's sun is the usual day's.
  let all, days, guessed = false;
  if (fresh) {
    all = given;
    days = a.days.filter((d) => d.d >= today);
  } else {
    // From the first hour of today on to the end of tomorrow, or of the month when that is later (the
    // money of the days to come, see lookAhead): walking by the hour, so a 23 or 25 hour day needs nothing special.
    const end = [shiftKey(today, 2), shiftMonth(today.slice(0, 7), 1) + "-01"].sort()[1], first = dayHours(now, clock)[0];
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
    // The usual day's sun moves with the season (usual.scale, see usualDay in solar-view.js).
    const usualSun = (t) => (usual.solarW[clock(t).hour] / 1000) * (usual.scale?.(t) ?? 1);
    for (let t = first; t < upTo; t += HOUR) usualByNow += usualSun(t) * Math.min(1, (upTo - t) / HOUR);
    // throttled: export is capped and the battery was full today, so the sun so far was held back, not
    // clouded: it may only raise the rest of today.
    const sky = covered.has(today) || !(usualByNow >= SKY_MIN_KWH) || !Number.isFinite(sunSoFar) ? 1
      : Math.min(SKY_MAX, throttled ? Math.max(1, sunSoFar / usualByNow) : sunSoFar / usualByNow);
    // Low and high: a forecast day SOLAR_SPREAD either way; a usual day's sun, and house use, as its days
    // spread (usual.spread: [low, high] over the mean, see usualDay).
    const spread = usual.spread ?? { sun: [1, 1], use: [1, 1] }, solar = [1 - SOLAR_SPREAD, 1 + SOLAR_SPREAD];
    const range = (v, [lo, hi]) => [v * lo, v, v * hi];
    all = [];
    for (let t = first; clock(t).key !== end; t += HOUR) {
      const c = clock(t), inForecast = covered.has(c.key);
      const sun = inForecast ? (solarWh[t] ?? 0) / 1000 : usualSun(t) * (c.key === today ? sky : 1);
      const use = usual.loadW[c.hour] / 1000;
      all.push({ t, sun: range(sun, inForecast ? solar : spread.sun), use: range(use, spread.use), cloud: null, rain: null, buy: price?.buy ?? null, sell: price?.sell ?? null });
    }
    days = [today, shiftKey(today, 1)].map((d) => ({ d, sun: sumOf(all, "sun", clock, d, -Infinity), use: sumOf(all, "use", clock, d, -Infinity) }));
  }
  // A sensor with house use stops at its last hour: on to the month's end with the usual day (its sun as the season
  // moves it, see usual.scale; prices flat), for the days to come on Production and Daily returns. Not with weather
  // alone: it has no use to go on with.
  if (fresh && withUse && usual && all.length) {
    const monthEnd = shiftMonth(today.slice(0, 7), 1) + "-01";
    all = [...all];
    for (let t = all.at(-1).t + HOUR; clock(t).key < monthEnd; t += HOUR) {
      const c = clock(t), sun = (usual.solarW[c.hour] / 1000) * (usual.scale?.(t) ?? 1), use = usual.loadW[c.hour] / 1000;
      all.push({ t, sun: [sun, sun, sun], use: [use, use, use], cloud: null, rain: null, buy: price?.buy ?? null, sell: price?.sell ?? null });
    }
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
  const left = Object.fromEntries(["sun", "use"].map((f) => [f, f === "use" && !withUse ? null : fresh ? rebase(f) : sumOf(all, f, clock, today, now)]));
  const hours = all.filter((h) => h.t >= start);
  return { from: fresh ? "sensor" : "page", hours, left, days, months: (fresh && a.months) || null, tomorrowSun: !guessed,
    // The machines' usual runs inside house use, W by clock hour (usual.machineW): the advice takes them out.
    machineW: usual?.machineW ?? null };
}

// The hours from now to the end of tomorrow for one scenario: the mid shape, scaled so today sums
// to `left` and tomorrow to its entry in `days`. Bad is low sun with high use, good the reverse.
export function scenarioHours(ahead, kind, now, clock) {
  const i = { bad: 0, mid: 1, good: 2 }[kind];
  const today = clock(now).key, tomorrow = shiftKey(today, 1);
  const next = ahead.days.find((d) => d.d === tomorrow);
  const factor = (field, idx) => Object.fromEntries([[today, ahead.left[field][idx]], [tomorrow, next?.[field]?.[idx]]].map(([key, target]) => {
    const mid = sumOf(ahead.hours, field, clock, key, now)[1];
    return [key, target == null ? 1 : mid > 0 ? target / mid : 0];
  }));
  const sun = factor("sun", i), use = factor("use", 2 - i);
  return ahead.hours.filter((h) => h.t + HOUR > now && clock(h.t).key in sun)
    .map((h) => ({ t: h.t, sun: h.sun[1] * sun[clock(h.t).key], use: h.use[1] * use[clock(h.t).key] }));
}

// The forecast sensor: found by its platform when the owner renamed it, else by its fixed id.
// The registry's solar_view ids are kept while hass.entities is the same object: Home Assistant replaces it only
// when the registry changes, and this runs on every state change.
let registry, ours = [];
export function findForecast(hass) {
  if (hass.entities !== registry) {
    registry = hass.entities;
    ours = Object.keys(registry || {}).filter((k) => registry[k]?.platform === "solar_view");
  }
  const id = ours.find((k) => hass.states[k]);
  return hass.states[id ?? "sensor.solar_view_forecast"];
}

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
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay(), md = key.slice(5);
  const band = wd === 0 || HOLIDAYS.includes(md) || md === easterMonday(+key.slice(0, 4)) || hour < 7 || hour >= 23 ? "f3"
    : wd === 6 || hour < 8 || hour >= 19 ? "f2" : "f1";
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
    const cur = runs.at(-1);
    if (cur && r.start - cur.to <= gap * step) Object.assign(cur, { to: r.start + step, kwh: cur.kwh + r.change, peak: Math.max(cur.peak, r.change) });
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
const FILLS_MIN_KWH = 1;   // "fills": the mid run reaches FULL_SOC today, then sends or loses this much or more
const TIE = 1e-9;

// [low, mid, high] over the bad, mid and good runs; null when any run has no value.
const range3 = (v) => (v.some((x) => x == null) ? null : [Math.min(...v), v[1], Math.max(...v)]);

// When the mid run takes the battery to its floor (ms, inside that hour), Infinity when an hour
// needs nothing from it first, null when neither within LASTS_MAX_H. The rows' present hour already
// holds the present reading (lookAhead).
function lastsUntil(rows, now, n, battery, firstShare) {
  if (!Number.isFinite(n.soc)) return null;
  const { kwh, floor } = battery, floorKwh = (kwh * floor) / 100;
  let left = Math.min(kwh, Math.max((kwh * n.soc) / 100, floorKwh)) - floorKwh;
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
  const src = runs.map((rs) => rs.filter((r) => clock(r.t).key === tomorrow));
  const up = src[0].findIndex((r) => r.sun >= r.use);
  if (up < 0 || up > NIGHT_MAX_H) return runs;
  return runs.map((rs, k) => rs.concat(src[k].slice(0, up).map((r, i) => ({ ...r, t: end + i * HOUR, from: r.t }))));
}

// Inside the quiet hours [from, to) by the clock (hours, a range may pass midnight).
const inQuiet = (c, q) => { const h = c.hour + c.minute / 60; return !!q && q[0] !== q[1] && (q[0] < q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1]); };

// When to start each movable machine (settings.machines, in order, each planned after the ones before),
// with the battery floor raised by settings.marginPct, so a forecast a little off still leaves it above
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
  const { machines = [], quiet = null, gridMaxKw = null, marginPct = 0, exportMaxKw } = settings;
  if (!machines.length) return null;
  const batt = battery.kwh > 0 ? { ...battery, floor: Math.min(100, battery.floor + marginPct) } : battery;
  const sim = (r) => simulate(r, n.soc, batt, exportMaxKw, firstShare), end = rows.at(-1).t + HOUR;
  const today = clock(now).key, lastStart = rows.find((r) => r.from != null)?.t ?? end;
  // Without a buy price for every hour, kWh: the export forgone then costs nothing.
  const priced = rows.every((r) => Number.isFinite(r.buy)), buy = (r) => (priced ? r.buy : 1), sell = (r) => (priced ? r.sell ?? 0 : 0);
  const deferMin = (DEFER_KWH * rows.reduce((s, r) => s + buy(r), 0)) / rows.length;
  // What starting m at t adds over the rows rs, whose plain run is base. Charge left missing at sunrise
  // (rows through the night) is refilled by that day's sun: export forgone, not grid.
  const dawn = rows.at(-1).from != null;
  const tryOn = (rs, base, t, m) => {
    const loaded = withLoad(rs, now, t, m.kwh, m.hours, firstShare), steps = sim(loaded);
    const missing = batt.kwh > 0 ? Math.max(0, (((base.at(-1).soc - steps.at(-1).soc) / 100) * batt.kwh) / batt.efficiency) : 0;
    let grid = dawn ? 0 : missing, fromBatt = 0, cost = missing * (dawn ? sell : buy)(rs.at(-1));
    steps.forEach((st, i) => {
      const more = st.fromGrid - base[i].fromGrid;
      grid += more; fromBatt += st.fromBatt - base[i].fromBatt;
      cost += more * buy(rs[i]) + (base[i].toGrid - st.toGrid) * sell(rs[i]);
    });
    return { t, loaded, grid, fromBatt, cost };
  };
  const pickOf = (list) => list.find((w) => w.free) ?? list.reduce((b, w) => (w.cost < b.cost - TIE ? w : b), list[0]);
  const out = [];
  for (const m of machines) {
    const base = sim(rows), baseBad = sim(bad);
    const starts = [now, ...rows.map((r) => r.t).filter((t) => t > now && t < lastStart)].filter((t) => t + m.hours * HOUR <= end + TIE && !inQuiet(clock(t), quiet));
    const tried = starts.map((t) => {
      const mid = tryOn(rows, base, t, m);
      if (clock(t).key === today) return { ...mid, free: mid.grid <= FREE_KWH };
      const worse = tryOn(bad, baseBad, t, m);
      return { ...mid, cost: Math.max(mid.cost, worse.cost), free: mid.grid <= FREE_KWH && worse.grid <= FREE_KWH };
    });
    if (!tried.length) continue;
    const first = tried[0].t === now ? tried[0] : null;
    let pick = pickOf(tried);
    if (clock(pick.t).key !== today) {
      const near = pickOf(tried.filter((w) => clock(w.t).key === today));
      if (near && near.cost - pick.cost < deferMin - TIE) pick = near;
    }
    const c = clock(pick.t), band = settings.bandAt?.(pick.t) ?? null, bandNow = settings.bandAt?.(now) ?? null;
    const free = pick.free, onBatt = pick.fromBatt > m.kwh / 2;
    const why = pick === first ? (free ? (onBatt ? "battNow" : "sunNow") : "bestNow")
      : free ? (onBatt ? "batt" : c.key === today ? "sun" : "sunTomorrow")
        : band && bandNow && band.buy < bandNow.buy - TIE ? "cheaper" : "grid";
    // The meter: only for now, the forecast knows hour means, not peaks.
    const room = batt.kwh > 0 && n.soc > batt.floor ? batt.maxDischargeKw ?? Infinity : 0;
    const draw = ((n.loadW ?? 0) - (n.solarW ?? 0)) / 1000 + m.peakKw - room;
    if (pick === first && gridMaxKw != null && draw > gridMaxKw + TIE) { out.push({ type: m.type, kind: "wait", t: now, why: null, band: null, kw: (n.loadW ?? 0) / 1000 }); continue; }
    out.push({ type: m.type, kind: pick === first ? "now" : "at", t: pick.t, why, band: why === "cheaper" ? band.band : null, kw: null });
    rows = pick.loaded; bad = withLoad(bad, now, pick.t, m.kwh, m.hours, firstShare);
  }
  return out.length ? out : null;
}

// The rest of today simulated for the bad, mid and good runs: when the battery runs to its floor, the
// best time for each machine, the state of charge in an hour (inHour, [low, mid, high] over the runs),
// whether the mid run fills the battery later today with spare sun left over (fills), and the mid run's
// charge, hours and money ahead. n is the present reading { soc, loadW, solarW }; battery null is no
// battery; soFar is today's money so far { saved, cost, earned }. A battery of unknown size hides all of
// it: every figure would be a guess.
export function lookAhead(ahead, now, clock, n, battery, settings, soFar) {
  const none = { lastsUntil: null, best: null, inHour: null, fills: false, socAhead: null, hoursAhead: null, restToday: null, daysMoney: null };
  if (battery && !battery.kwh) return none;
  const batt = battery || NO_BATTERY, today = clock(now).key, standby = settings.standbyKwhPerHour;
  // The present hour at whichever is worse, the present reading or the forecast hour: an oven switched
  // on now, or a cloud now, counts on every card.
  const present = (r, i) => (i ? r : { ...r, use: Math.max(r.use, (n.loadW ?? 0) / 1000), sun: Math.min(r.sun, (n.solarW ?? Infinity) / 1000) });
  const runs = ["bad", "mid", "good"].map((kind) => scenarioHours(ahead, kind, now, clock).map(present)), rows = runs[1];
  if (!rows.length) return none;
  // The rows hold whole hours; simulate takes the present hour's part itself.
  const firstShare = Math.min(1, (rows[0].t + HOUR - now) / HOUR);
  const price = new Map(ahead.hours.map((h) => [h.t, h]));
  const sims = runs.map((r) => simulate(r, n.soc, batt, settings.exportMaxKw, firstShare));
  // The mid run's money by midnight, from today's so far.
  const money = { saved: soFar.saved, cost: soFar.cost, earned: soFar.earned };
  sims[1].forEach((st, i) => {
    if (clock(st.t).key !== today) return;
    const share = i ? 1 : firstShare, use = rows[i].use * share, { buy, sell } = price.get(st.t) ?? {};
    // null + a number is a number in JS: an unknown price must stay unknown.
    money.cost = buy == null || money.cost == null ? null : money.cost + st.fromGrid * buy;
    money.saved = buy == null || money.saved == null ? null : money.saved + Math.max(0, use - standby * share - st.fromGrid) * buy;
    money.earned = sell == null || money.earned == null ? null : money.earned + st.toGrid * sell;
  });
  // The mid run's money for the rest of today, and on through every whole day the forecast has after today
  // (with a usual day at least to the month's end, see forecastOf), the battery carried from hour to hour:

  // [[date, saved, cost, earned]], a figure null where a price is unknown.
  const minus = (a, b) => (a == null || b == null ? null : a - b);
  const restToday = { saved: minus(money.saved, soFar.saved), cost: minus(money.cost, soFar.cost), earned: minus(money.earned, soFar.earned) };
  const long = ahead.hours.filter((h) => h.t + HOUR > now && Array.isArray(h.use)).map((h, i) => present({ t: h.t, sun: h.sun[1], use: h.use[1] }, i));
  const byDay = new Map();
  simulate(long, n.soc, batt, settings.exportMaxKw, firstShare).forEach((st, i) => {
    const key = clock(st.t).key, { buy, sell } = price.get(st.t) ?? {};
    if (key === today) return;
    const d = byDay.get(key) ?? byDay.set(key, { hours: 0, saved: 0, cost: 0, earned: 0 }).get(key), use = long[i].use;
    d.hours++;
    d.saved = buy == null || d.saved == null ? null : d.saved + Math.max(0, use - standby - st.fromGrid) * buy;
    d.cost = buy == null || d.cost == null ? null : d.cost + st.fromGrid * buy;
    d.earned = sell == null || d.earned == null ? null : d.earned + st.toGrid * sell;
  });
  // A day the forecast stops inside (fewer than 23 hours) is left out, and every day after it.
  const whole = [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)), cut = whole.findIndex(([, d]) => d.hours < 23);
  const daysMoney = (cut < 0 ? whole : whole.slice(0, cut)).map(([key, d]) => [key, d.saved, d.cost, d.earned]);
  // Now + 60 minutes falls inside the second hour, by the part of the first already gone. Read in a
  // straight line across that hour.
  // ponytail: a battery that fills or empties inside that hour reads a little off; split the hour if that ever shows.
  const inHour = (steps) => (steps.length < 2 ? steps[0].soc : steps[0].soc + (steps[1].soc - steps[0].soc) * (1 - firstShare));
  // The mid run's spare sun today from the hour the battery is full on.
  const full = sims[1].findIndex((st) => clock(st.t).key === today && st.soc >= FULL_SOC);
  const spare = full < 0 ? 0 : sims[1].slice(full).reduce((s, st) => s + (clock(st.t).key === today ? st.toGrid + st.lost : 0), 0);
  // Tomorrow's sun only the usual day (no forecast): the bad run, which tomorrow's starts must pass too,
  // has none after today, so a start tomorrow wins on prices or the battery, never on a guessed sun.
  const bad = ahead.tomorrowSun === false ? runs[0].map((r) => (clock(r.t).key === today ? r : { ...r, sun: 0 })) : runs[0];
  // Each row with its prices: the band's buy price, else the forecast hour's. A night hour after tomorrow
  // takes its band from its own time, a forecast price from its source hour.
  const priced = (rs) => rs.map((r) => {
    const b = settings.bandAt?.(r.t), h = price.get(r.from ?? r.t);
    return { ...r, buy: b ? b.buy : h?.buy ?? null, sell: h?.sell ?? null };
  });
  // The advice adds each machine run where it plans it: its usual runs of the next 24 hours come out of
  // house use first (the run it plans is the next one; a day later the habit runs again), on the advice's
  // rows only (every other figure keeps them, the machines will run).
  const bare = (rs) => (ahead.machineW ? rs.map((r) => (r.t < now + 24 * HOUR ? { ...r, use: Math.max(0, r.use - ahead.machineW[clock(r.t).hour] / 1000) } : r)) : rs);
  const [night, nightBad] = withNight([bare(rows), bare(bad)], clock, shiftKey(today, 1)).map(priced);
  return {
    lastsUntil: battery ? lastsUntil(rows, now, n, batt, firstShare) : null,
    best: advise(night, nightBad, now, n, batt, settings, firstShare, clock),
    inHour: battery && Number.isFinite(n.soc) ? range3(sims.map(inHour)) : null,
    fills: !!battery && spare >= FILLS_MIN_KWH - TIE,
    // The mid run's charge at the end of each hour left today, for Today by hour's charge chart: [end, %].
    socAhead: battery ? sims[1].filter((st) => clock(st.t).key === today).map((st) => [st.t + HOUR, Math.round(st.soc * 10) / 10]) : null,
    // The mid run's hours left today, for Today by hour and Power origin's small rings: [start, sun made,
    // battery gave, grid gave, house used], in kWh; this hour's from now on only.

    hoursAhead: sims[1].map((st, i) => [st.t, st.made, st.fromBatt, st.fromGrid, rows[i].use * (i ? 1 : firstShare)]).filter(([t]) => clock(t).key === today),
    restToday, daysMoney,
  };
}

// Today so far in money, hour by hour: `todayHours` is { hour start ms: { loadKwh, gridImportKwh,
// gridExportKwh } } with loadKwh the energy balance, buyAt(t) and sellAt(t) the price of that hour.
// Standby is left out of the savings, as in lookAhead, for the part of each hour already passed by
// `now`. A field is null when its price, or an energy figure it needs, is unknown for any hour.
export function moneySoFar(todayHours, buyAt, sellAt, standbyKwhPerHour, now) {
  let saved = 0, cost = 0, earned = 0;
  const ok = (...v) => v.every(Number.isFinite);
  for (const [key, h] of Object.entries(todayHours)) {
    const t = +key, buy = buyAt(t), sell = sellAt(t), standby = (standbyKwhPerHour * (Math.min(now, t + HOUR) - t)) / HOUR;
    const { loadKwh: use, gridImportKwh: imp, gridExportKwh: exp } = h;
    saved = buy == null || saved == null || !ok(use, imp) ? null : saved + Math.max(0, use - standby - imp) * buy;
    cost = buy == null || cost == null || !ok(imp) ? null : cost + imp * buy;
    earned = sell == null || earned == null || !ok(exp) ? null : earned + exp * sell;
  }
  return { saved, cost, earned };
}
