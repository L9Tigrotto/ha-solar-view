/* Forecast part of the solar page: the day simulation and the numbers derived from the forecast.
   Plain functions, no imports, so the preview and the integration's tests can run them as they are.
   The simulation cases in preview/simulate-cases.json pin the rules; change both together. */

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
// A shortfall takes the battery down to its floor, then the grid. The present hour counts firstShare of
// its sun, use and limits. kwh 0 is no battery. kWh and percent out, one step per hour.
export function simulate(hours, soc, battery, exportMaxKw, firstShare) {
  const { kwh, floor, maxChargeKw, efficiency } = battery;
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
      fromBatt = Math.min(use - sun, stored - floorKwh);
      stored -= fromBatt;
      fromGrid = use - sun - fromBatt;
    }
    return { t: h.t, made: sun - lost, fromBatt, fromGrid, toGrid, lost, soc: kwh > 0 ? (stored / kwh) * 100 : 0 };
  });
}

// ---- The forecast shape ----
const FRESH_MS = 3 * 36e5; // a sensor older than this is not trusted: the page builds its own
const HOUR = 36e5;

// A day key moved by whole days (the same as in solar-view.js; this file keeps no imports).
const shiftKey = (key, days) => new Date(Date.parse(key) + days * 864e5).toISOString().slice(0, 10);
// Start of the hour holding ms, from the clock's minute: right in half hour time zones too.
const hourOf = (ms, clock) => ms - clock(ms).minute * 60e3 - (ms % 60e3);
// [low, mid, high] of one field summed over the hours of day `key` from `from` on; the hour
// holding `from` counts only its part still ahead.
const sumOf = (hours, field, clock, key, from) => hours.reduce((s, h) =>
  h.t + HOUR <= from || clock(h.t).key !== key ? s : s.map((v, i) => v + h[field][i] * Math.min(1, (h.t + HOUR - from) / HOUR)), [0, 0, 0]);

// The sensor as it is when fresh, else what the page can build from the solar forecast (solarWh,
// hour start in ms to Wh) and the usual day; null without a usual day. Hours start at the present
// hour, `left` is the rest of today from now.
// A fresh sensor without house use (mode Weather: `use` null in hours, left or days) is still the
// forecast for sun, cloud and rain; its `left.use` is then null, and nothing that needs use is worked out.
export function forecastOf({ sensor, now, clock, solarWh, usual, price }) {
  const today = clock(now).key, start = hourOf(now, clock);
  const a = sensor?.attributes, written = Date.parse(sensor?.state);
  // Hours in order of t; a t that does not parse or an hour given twice is dropped (the first kept).
  const given = (Array.isArray(a?.hours) ? a.hours : [])
    .map((h) => ({ t: Date.parse(h.t), sun: h.sun, use: h.use, cloud: h.cloud ?? null, rain: h.rain ?? null, buy: h.buy ?? null, sell: h.sell ?? null }))
    .filter((h) => Number.isFinite(h.t)).sort((x, y) => x.t - y.t).filter((h, i, s) => !i || h.t !== s[i - 1].t);
  // The sun is what makes a sensor usable; house use may be switched off (see above).
  const fresh = now - written < FRESH_MS && Array.isArray(a.days) && Array.isArray(a.left?.sun)
    && given.length > 0 && given.every((h) => Array.isArray(h.sun));
  const withUse = !fresh || (Array.isArray(a.left?.use) && given.every((h) => Array.isArray(h.use)));
  if (!fresh && !usual) return null;
  let all, days;
  if (fresh) {
    all = given;
    days = a.days.filter((d) => d.d >= today);
  } else {
    // Back to the first hour of today, then on to the end of tomorrow: walking by the hour, so a
    // 23 or 25 hour day needs nothing special.
    const end = shiftKey(today, 2);
    let t = start;
    while (clock(t - HOUR).key === today) t -= HOUR;
    all = [];
    for (; clock(t).key !== end; t += HOUR) {
      const c = clock(t), wh = solarWh?.[t];
      const sun = (wh ?? usual.solarW[c.hour]) / 1000, use = usual.loadW[c.hour] / 1000;
      all.push({ t, sun: [sun, sun, sun], use: [use, use, use], cloud: null, rain: null, buy: price?.buy ?? null, sell: price?.sell ?? null });
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
    const whole = sumOf(all, field, clock, today, sameDay ? hourOf(written, clock) : -Infinity)[1];
    return Array.isArray(base) && whole > 0 ? base.map((v) => (v * ahead[1]) / whole) : ahead;
  };
  const left = Object.fromEntries(["sun", "use"].map((f) => [f, f === "use" && !withUse ? null : fresh ? rebase(f) : sumOf(all, f, clock, today, now)]));
  const hours = all.filter((h) => h.t >= start);
  return { from: fresh ? "sensor" : "page", hours, left, days, months: (fresh && a.months) || null, cloud: hours.some((h) => h.cloud != null) };
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
export function findForecast(hass) {
  const id = Object.keys(hass.entities || {}).find((k) => hass.entities[k]?.platform === "solar_view" && hass.states[k]);
  return hass.states[id ?? "sensor.solar_view_forecast"];
}

// ---- What the page derives ----
const BEST_LOAD_KWH = 1;   // the washer: this much over BEST_HOURS consecutive hours
const BEST_HOURS = 2;
const BEST_MAX_KWH = 0.2;  // a best time is shown only when it adds at most this
const NO_BATTERY = { kwh: 0, floor: 0, maxChargeKw: null, efficiency: 1 };
const LASTS_MAX_H = 18;    // as on the page: past this "lasts until" says nothing
const FULL_SOC = 97;       // "fills": the mid run reaches this today, then sends or loses FILLS_MIN_KWH or more
const FILLS_MIN_KWH = 1;
const TIE = 1e-9;

// [low, mid, high] over the bad, mid and good runs; null when any run has no value.
const range3 = (v) => (v.some((x) => x == null) ? null : [Math.min(...v), v[1], Math.max(...v)]);

// When the mid run takes the battery to its floor (ms, inside that hour), Infinity when an hour
// needs nothing from it first, null when neither within LASTS_MAX_H. The present hour is taken at
// whichever is worse, the present reading or the forecast hour.
function lastsUntil(rows, now, n, battery, firstShare) {
  if (!Number.isFinite(n.soc)) return null;
  const { kwh, floor } = battery, floorKwh = (kwh * floor) / 100;
  let left = Math.min(kwh, Math.max((kwh * n.soc) / 100, floorKwh)) - floorKwh;
  const end = now + LASTS_MAX_H * HOUR;
  for (const [i, r] of rows.entries()) {
    const start = Math.max(now, r.t);
    if (start >= end) return null;
    const use = i ? r.use : Math.max(r.use, (n.loadW ?? 0) / 1000);
    const sun = i ? r.sun : Math.min(r.sun, (n.solarW ?? Infinity) / 1000);
    if (sun >= use) return Infinity;
    const share = i ? 1 : firstShare, need = (use - sun) * share;
    if (left <= need) { const t = start + (left / need) * share * HOUR; return t <= end ? t : null; }
    left -= need;
  }
  return null;
}

// The window today (else tomorrow) where the washer costs least: the grid import it adds plus the
// stored energy it leaves missing at the end, as the grid kWh to put it back. Only whole hours with
// sun for the load; ties to the most spare sun, then the earliest. null when the best adds too much.
export function bestWindow(hours, soc, battery, exportMaxKw, firstShare, clock) {
  const per = BEST_LOAD_KWH / BEST_HOURS, today = clock(hours[0].t).key;
  const grid = (steps) => steps.reduce((s, st) => s + st.fromGrid, 0);
  const base = simulate(hours, soc, battery, exportMaxKw, firstShare), baseGrid = grid(base);
  const found = [];
  for (let i = firstShare < 1 ? 1 : 0; i + BEST_HOURS <= hours.length; i++) {
    const win = hours.slice(i, i + BEST_HOURS);
    if (win.some((h) => h.sun < per)) continue;
    const steps = simulate(hours.map((h, j) => (j >= i && j < i + BEST_HOURS ? { ...h, use: h.use + per } : h)), soc, battery, exportMaxKw, firstShare);
    const missing = battery.kwh > 0 ? (((base.at(-1).soc - steps.at(-1).soc) / 100) * battery.kwh) / battery.efficiency : 0;
    found.push({ t: hours[i].t, today: clock(hours[i].t).key === today, score: grid(steps) - baseGrid + missing, spare: win.reduce((s, h) => s + h.sun - h.use, 0) });
  }
  // In order of t, so a full tie keeps the earliest.
  const pick = (ws) => ws.reduce((b, w) => (!b || w.score < b.score - TIE || (w.score <= b.score + TIE && w.spare > b.spare + TIE) ? w : b), null);
  const best = [true, false].map((d) => pick(found.filter((w) => w.today === d))).find((w) => w && w.score <= BEST_MAX_KWH + TIE);
  return best ? { from: best.t, to: best.t + BEST_HOURS * HOUR } : null;
}

// Today so far plus the simulated rest of today for the bad, mid and good runs (fromSun: used straight
// from the sun), when the battery
// runs to its floor, the best time for the washer, the state of charge in an hour (inHour, [low, mid,
// high] over the runs) and whether the mid run fills the battery later today with spare sun left over
// (fills). n is the present reading { soc, loadW, solarW }; battery null is no battery. A battery of
// unknown size hides all of it: every figure would be a guess.
export function lookAhead(ahead, now, zone, n, battery, settings, soFar) {
  // The same hours go through the clock again and again below (each scenario, each total): once each.
  const seen = new Map(), clock = (ms) => seen.get(ms) ?? seen.set(ms, zone(ms)).get(ms);
  const none = { tonight: null, lastsUntil: null, best: null, inHour: null, fills: false, socAhead: null, hoursAhead: null };
  if (battery && !battery.kwh) return none;
  const batt = battery || NO_BATTERY, today = clock(now).key, standby = settings.standbyKwhPerHour;
  const runs = ["bad", "mid", "good"].map((kind) => scenarioHours(ahead, kind, now, clock)), rows = runs[1];
  if (!rows.length) return none;
  // The rows hold whole hours; simulate takes the present hour's part itself.
  const firstShare = Math.min(1, (rows[0].t + HOUR - now) / HOUR);
  const price = new Map(ahead.hours.map((h) => [h.t, h]));
  // Today's hours by the clock: 23 or 25 on a daylight saving day.
  let first = hourOf(now, clock), dayHours = 0;
  while (clock(first - HOUR).key === today) first -= HOUR;
  for (let t = first; clock(t).key === today; t += HOUR) dayHours++;
  const sims = runs.map((r) => simulate(r, n.soc, batt, settings.exportMaxKw, firstShare));
  const totals = runs.map((r, run) => {
    const s = { made: soFar.solarKwh, used: soFar.loadKwh, fromBatt: soFar.batteryKwh, fromGrid: soFar.gridImportKwh, sent: soFar.gridExportKwh, saved: soFar.saved, cost: soFar.cost, earned: soFar.earned, paid: soFar.paid };
    sims[run].forEach((st, i) => {
      if (clock(st.t).key !== today) return;
      const share = i ? 1 : firstShare, use = r[i].use * share, { buy, sell } = price.get(st.t) ?? {};
      s.made += st.made; s.used += use; s.fromBatt += st.fromBatt; s.fromGrid += st.fromGrid; s.sent += st.toGrid;
      // null + a number is a number in JS: an unknown price must stay unknown.
      s.cost = buy == null || s.cost == null ? null : s.cost + st.fromGrid * buy;
      s.saved = buy == null || s.saved == null ? null : s.saved + Math.max(0, use - standby * share - st.fromGrid) * buy;
      s.earned = sell == null || s.earned == null ? null : s.earned + st.toGrid * sell;
      // What the house would pay with no system at all, standby left out.
      s.paid = buy == null || s.paid == null ? null : s.paid + Math.max(0, use - standby * share) * buy;
    });
    // What the house took straight from the sun: the rest of its use came from the battery or the grid.
    s.fromSun = s.used - s.fromBatt - s.fromGrid;
    // Standby is left out: that energy would not be used without the system.
    const base = s.used - standby * dayHours;
    s.homeMade = base > 0 ? Math.min(1, Math.max(0, (base - s.fromGrid) / base)) : null;
    return s;
  });
  const tonight = Object.fromEntries(Object.keys(totals[0]).map((k) => [k, range3(totals.map((s) => s[k]))]));
  if (!battery) tonight.fromBatt = null;
  // Now + 60 minutes falls inside the second hour, by the part of the first already gone. Read in a
  // straight line across that hour.
  // ponytail: a battery that fills or empties inside that hour reads a little off; split the hour if that ever shows.
  const inHour = (steps) => (steps.length < 2 ? steps[0].soc : steps[0].soc + (steps[1].soc - steps[0].soc) * (1 - firstShare));
  // The mid run's spare sun today from the hour the battery is full on.
  const full = sims[1].findIndex((st) => clock(st.t).key === today && st.soc >= FULL_SOC);
  const spare = full < 0 ? 0 : sims[1].slice(full).reduce((s, st) => s + (clock(st.t).key === today ? st.toGrid + st.lost : 0), 0);
  return {
    tonight,
    lastsUntil: battery ? lastsUntil(rows, now, n, batt, firstShare) : null,
    best: bestWindow(rows, n.soc, batt, settings.exportMaxKw, firstShare, clock),
    inHour: battery && Number.isFinite(n.soc) ? range3(sims.map(inHour)) : null,
    fills: !!battery && spare >= FILLS_MIN_KWH - TIE,
    // The mid run's charge at the end of each hour left today, for Energy's battery card: [end, %].
    socAhead: battery ? sims[1].filter((st) => clock(st.t).key === today).map((st) => [st.t + HOUR, Math.round(st.soc * 10) / 10]) : null,
    // The mid run's hours left today, for Energy's hour by hour: [start, sun made, battery gave, grid gave,
    // house used], in kWh; this hour's from now on only.
    hoursAhead: sims[1].map((st, i) => [st.t, st.made, st.fromBatt, st.fromGrid, rows[i].use * (i ? 1 : firstShare)]).filter(([t]) => clock(t).key === today),
  };
}

// Today so far in money, hour by hour: `todayHours` is { hour start ms: { loadKwh, gridImportKwh,
// gridExportKwh } } with loadKwh the energy balance, buyAt(t) and sellAt(t) the price of that hour.
// Standby is left out of the savings and of `paid` (what the house would pay with no system), as in
// lookAhead, for the part of each hour already passed by `now`. A field is null when its price, or an
// energy figure it needs, is unknown for any hour.
export function moneySoFar(todayHours, buyAt, sellAt, standbyKwhPerHour, now) {
  let saved = 0, cost = 0, earned = 0, paid = 0;
  const ok = (...v) => v.every(Number.isFinite);
  for (const [key, h] of Object.entries(todayHours)) {
    const t = +key, buy = buyAt(t), sell = sellAt(t), standby = (standbyKwhPerHour * (Math.min(now, t + HOUR) - t)) / HOUR;
    const { loadKwh: use, gridImportKwh: imp, gridExportKwh: exp } = h;
    saved = buy == null || saved == null || !ok(use, imp) ? null : saved + Math.max(0, use - standby - imp) * buy;
    cost = buy == null || cost == null || !ok(imp) ? null : cost + imp * buy;
    earned = sell == null || earned == null || !ok(exp) ? null : earned + exp * sell;
    paid = buy == null || paid == null || !ok(use) ? null : paid + Math.max(0, use - standby) * buy;
  }
  return { saved, cost, earned, paid };
}
