/* The statistics: what a load asks, each call with its own lifetime (fetchStats), and the answers as plain
   numbers: days, months, today by the hour, the usual day (totals). */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("./core.js"), typeof import("./sky.js"), typeof import("./forecast.js"),
 *   typeof import("./config.js")]} */
const [{ MINUTE, FIVE_MIN, HOUR, DAY, WHOLE_DAY_H, roundTo, noonOf, quarterPast, shiftKey, shiftMonth, monthDayKeys, yearKeys, dayHours, hourStart, clamp01, sumKnown }, { clearSky }, { efficiencyOf, machineOf, runningOf, usualSunAt }, { USUAL_MIN }] = await Promise.all([
  import(`./core.js${v}`), import(`./sky.js${v}`), import(`./forecast.js${v}`), import(`./config.js${v}`)]);

const ENERGY = ["solarKwh", "batteryKwh", "chargeKwh", "gridImportKwh", "gridExportKwh", "loadKwh"];
const PARTS = [...ENERGY, "costMoney", "earnedMoney"]; // everything summed from the statistics
/** A day's (or several days') figures from the statistics, each null when unknown; `days` with numbers on record, `none`
 * when no day has any (see sum in totals).
 * @typedef {{ solarKwh: number | null, batteryKwh: number | null, chargeKwh: number | null, gridImportKwh: number | null,
 *   gridExportKwh: number | null, loadKwh: number | null, costMoney: number | null, earnedMoney: number | null,
 *   days?: number, none?: boolean }} Day */
/** @returns {Day} */
const zero = () => /** @type {any} */ (Object.fromEntries(PARTS.map((k) => [k, 0]))); // every part at 0, to add into

// ---- Rules (tune here) ----
const FROZEN_MIN_W = 300; // clear sky this bright (W/m2) and the panels made exactly 0: the meter was frozen, not dark
const TRIM_MIN = 5;       // an hour of the usual day's sun with this many days or more leaves out its lowest and highest
const PARTIAL_SHARE = 0.75; // a solar forecast day with fewer hours than this share of its fullest day's counts as not forecast
const STANDBY_MIN_KWH = 1; // a load sensor this much a day under the energy balance: the gap is the inverter's standby
const MACHINE_DAYS = 90;    // a machine's runs are looked for in this many days of hour rows
const FIVE_MIN_DAYS = 10;   // and its lengths in this many days of 5 minute rows (what Home Assistant keeps by default)
const PRICE_DAYS = 28;      // a tariff sensor's band prices are learned over this many days

// Today's mean charge by the hour, from the statistics of every battery's charge sensor, weighted as the live
// reading (see reading in data.js): [[hour start, %], ...], oldest first. The present hour has no row yet. An hour
// some battery of `ids` has no mean for is left out: the others alone are not the charge of them all.
/** @returns {[number, number][]} */
function chargeLevelDay(rows, weight, clock, now, entityIds = Object.keys(rows || {})) {
  const today = clock(now).key, by = new Map();
  for (const [id, list] of Object.entries(rows || {})) for (const r of list || []) {
    if (!Number.isFinite(r.mean) || clock(r.start).key !== today) continue;
    const t = hourStart(r.start, clock), w = weight[id] || 1, a = by.get(t) ?? [0, 0, 0];
    by.set(t, [a[0] + r.mean * w, a[1] + w, a[2] + 1]);
  }
  return [...by].filter(([, a]) => a[2] >= entityIds.length).sort((a, b) => a[0] - b[0]).map(([t, [s, w]]) => [t, s / w]);
}

// Statistics rows summed into buckets (`keyOf` gives a row's bucket): Map of key to { solarKwh, ... }.
// A part is known only when every meter it sums has a valid row for every energy interval of the bucket;
// else it is null (unknown), never a partial sum. A part with no meter is 0 for energy (nothing to
// count) and null for money (nothing on record: the price stands in, see moneyOf). Minutes no meter has a
// row for are not looked for: a meter that only counts up puts what it counted while unavailable (a restart,
// a cloud integration offline) into its first row after, so the sum is still whole. A meter added later (a
// second inverter) did not exist before its first row: see missingOk.
function statisticsBuckets(res, entityIds, keyOf) {
  const buckets = new Map(), energyIds = new Set(ENERGY.flatMap((part) => entityIds[part])), first = firstRows(res, entityIds);
  for (const id of new Set(PARTS.flatMap((part) => entityIds[part]))) for (const r of res[id] || []) {
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
      const list = entityIds[part];
      if (!list.length) { value[part] = ENERGY.includes(part) ? 0 : null; continue; }
      const has = (id, s) => b.meters.get(id)?.valid.has(s);
      // A meter with no row in the bucket counts only when the bucket has energy intervals, all excused.
      const complete = list.every((id) => { const m = b.meters.get(id); return !m?.invalid && (m?.valid.size || b.starts.size) && [...b.starts].every((s) => has(id, s) || missingOk(list, id, s, first, has, BATTERY_PARTS.includes(part))); });
      value[part] = complete ? list.reduce((s, id) => s + (b.meters.get(id)?.sum ?? 0), 0) : null;
    }
    // A house meter added later: a bucket wholly before its first row takes the balance, as without one. A house
    // meter with no rows at all, or missing a row after its first, still leaves house use unknown.
    const load = entityIds.loadKwh;
    if (value.loadKwh === null && load.length && b.starts.size && load.every((id) => first[id] < Infinity && [...b.starts].every((t) => t < first[id])))
      value.loadKwh = balanceKwh(value);
    return [key, value];
  }));
}
// Each meter's first row in `res` (Infinity without one).
function firstRows(res, entityIds) {
  const first = {};
  for (const id of PARTS.flatMap((part) => entityIds[part])) first[id] = (res[id] || []).reduce((a, r) => Math.min(a, r.start), Infinity);
  return first;
}
// A meter with no row at `start` counts as 0 there when its rows start later (it was added later, as a second
// inverter) and another meter of the same part (`ids`) has one: that part was counted. A battery meter
// (`battery`) needs no other: before its first row there was no battery yet. A meter missing a row after its
// first one, a meter with no rows at all (misnamed, never recorded), or the only meter of any other part
// leaves the part unknown. `has(id, start)`: a valid row.
// ponytail: the first row is the first in the rows asked for, so a meter down at their start also counts as 0
// there; ask Home Assistant for each meter's first row if that ever matters.
const BATTERY_PARTS = ["batteryKwh", "chargeKwh"];
const missingOk = (entityIds, id, start, first, has, battery = false) => start < first[id] && first[id] < Infinity && (battery || entityIds.some((other) => other !== id && has(other, start)));

// Energy per calendar day (see statisticsBuckets).
const byDay = (res, entityIds, clock) => statisticsBuckets(res, entityIds, (start) => clock(start).key);

// What flowed in minus what flowed out: house use with the inverter's own losses. The forecast
// counts use this way always (its standby is taken off separately). null when a part is unknown.
const balanceKwh = (d) => ([d.solarKwh, d.batteryKwh, d.gridImportKwh, d.chargeKwh, d.gridExportKwh].every(Number.isFinite)
  ? Math.max(0, d.solarKwh + d.batteryKwh + d.gridImportKwh - d.chargeKwh - d.gridExportKwh) : null);
// House use: its own sensor when the owner named one, else the balance.
const houseKwh = (d, entityIds) => (entityIds.loadKwh.length ? d.loadKwh : balanceKwh(d));

// The usual day from hour rows: average W of house use and of sun for each hour of the day
// (0 to 23, Home Assistant's time zone). Until every hour of the day has USUAL_MIN hours behind it,
// { onRecord }: the days the thinnest hour has (null without energy sensors). An hour some sensor has no row for is skipped: its share would be missing (but see missingOk).
// machineW: the machines' own runs (`machineRows`, sensor id to hour rows) at each hour, inside house use;
// only the machine advice takes them out, as it adds each run where it plans it. spread: the whole days'
// sun and use at their 25th and 75th percentile over their mean ([1, 1] with too few), the page's own
// forecast's low and high. scale(t): how much more or less sun the hour starting at `t` gets in clear sky than
// that hour of the usual days did, from Home Assistant's location (`geo`, [lat, lon]), so the usual day follows
// the season: in autumn each day has less sun than the days before it. 1 without a location or at night.
function usualDay(res, entityIds, clock, machineRows = {}, geo = []) {
  const parts = ENERGY.filter((k) => entityIds[k].length), all = parts.flatMap((k) => entityIds[k]), first = firstRows(res, entityIds);
  const hours = new Map();
  for (const part of parts) for (const id of entityIds[part]) {
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
  // A cloud integration that stalls keeps writing 0 for the sun, then puts all it missed into one later row: a
  // bright hour with exactly 0 sun is frozen, and the hour after a frozen one is the catch-up. Both left out.
  if (Number.isFinite(geo?.[0]) && Number.isFinite(geo?.[1]) && entityIds.solarKwh.length) {
    const frozen = (t) => { const h = hours.get(t); return !!h && entityIds.solarKwh.every((id) => h.ids.has(id)) && h.solarKwh === 0 && clearSky(t, geo[0], geo[1]) > FROZEN_MIN_W; };
    for (const [start, h] of hours) if (frozen(start) || frozen(start - HOUR)) h.catchUp = true;
  }
  const machine = new Map();
  for (const rows of Object.values(machineRows)) for (const r of rows ?? []) if (r.change > 0) machine.set(r.start, (machine.get(r.start) ?? 0) + r.change);
  const whole = (start, h) => parts.every((part) => entityIds[part].every((id) => h.ids.has(id) || missingOk(entityIds[part], id, start, first, (other) => h.ids.has(other), BATTERY_PARTS.includes(part))));
  const list = () => Array.from({ length: 24 }, () => []);
  const load = list(), balance = list(), sun = list(), machineWatts = list(), sky = list(), days = new Map();
  const [latitude, longitude] = geo ?? [], located = Number.isFinite(latitude) && Number.isFinite(longitude);
  for (const [start, h] of hours) if (!h.catchUp && whole(start, h)) {
    const c = clock(start), b = balanceKwh(h);
    load[c.hour].push(houseKwh(h, entityIds));
    balance[c.hour].push(b);
    sun[c.hour].push(h.solarKwh);
    if (located) sky[c.hour].push(clearSky(start, latitude, longitude));
    machineWatts[c.hour].push(machine.get(start) ?? 0);
    const d = days.get(c.key) ?? days.set(c.key, { n: 0, sun: 0, use: 0 }).get(c.key);
    d.n++; d.sun += h.solarKwh; d.use += b;
  }
  if (!all.length) return null;
  if (sun.some((v) => v.length < USUAL_MIN)) return { onRecord: Math.min(...sun.map((v) => v.length)) };
  const sorted = (v) => [...v].sort((x, y) => x - y), sumOf = (v) => v.reduce((s, x) => s + x, 0);
  // kWh in one hour is the average kW over it. balanceW is house use as the forecast counts it (standby
  // included), which differs from loadW only when the owner named a load sensor. The sun, with TRIM_MIN
  // or more hours behind it, leaves out each hour's lowest and highest: one odd row (a recorder catching
  // up) cannot carry it. Use is not trimmed: an oven or a car charged now and then is real energy.
  const average = (lists, trim = false) => lists.map((v) => { const s = trim && v.length >= TRIM_MIN ? sorted(v).slice(1, -1) : v; return Math.round((sumOf(s) / s.length) * 1000); });
  const fullDays = [...days.values()].filter((d) => d.n >= WHOLE_DAY_H);
  const at = (s, p) => { const i = (s.length - 1) * p, low = Math.floor(i); return s[low] + (s[Math.ceil(i)] - s[low]) * (i - low); };
  const spreadOf = (v) => { const s = sorted(v), m = sumOf(s) / s.length; return s.length >= USUAL_MIN && m > 0 ? [at(s, 0.25) / m, at(s, 0.75) / m] : [1, 1]; };
  // Hour rows start on UTC hours: in a half hour zone (India, at :30 local) a row filed under h covers
  // h:30 to h+1:30. Each local hour takes its share of the two rows it spans, energy taken as even
  // inside an hour; nothing changes in a whole hour zone.
  const m = clock(hours.keys().next().value).minute / 60;
  const local = (w) => (m ? w.map((v, h) => Math.round(v * (1 - m) + w[(h + 23) % 24] * m)) : w);
  // ponytail: the clear sky is not shifted in a half hour zone like the rest (see local); a few percent at dawn and dusk there.
  const skyW = sky.map((v) => (v.length ? sumOf(v) / v.length : 0));
  const scale = (t) => { const m = located ? skyW[clock(t).hour] : 0; return m > 20 ? Math.min(2, clearSky(t, latitude, longitude) / m) : 1; };
  return { loadW: local(average(load)), balanceW: local(average(balance)), solarW: local(average(sun, true)), machineW: local(average(machineWatts)), scale, spread: { sun: spreadOf(fullDays.map((d) => d.sun)), use: spreadOf(fullDays.map((d) => d.use)) } };
}

// Everything that comes from the statistics, as plain numbers: today, both months, this month's days,
// the usual day so far and the forecast, plus what the forecast part needs (see predict in data.js). `rows`
// holds the answers of the fetch table (see FETCHES), by name: `days` day rows, `recent` 5 minute rows that
// cover today (day rows lag by up to an hour), `usual` hour rows of the last `usual_days` days, `solarForecast`
// the answer of energy/solar_forecast, `months` month rows, and the rest as named there; one not asked is {}.
// `ids` are the entities (see readConfig), `options` the owner's settings, `geo` Home Assistant's [lat, lon].
function totals(entityIds, options, rows, clock, now, geo) {
  const { days: daily = {}, recent = {}, usual: hourly = {}, solarForecast: forecast = {}, months: monthly = {}, machineHours = {} } = rows;
  const at = clock(now), today = at.key;
  const month = today.slice(0, 7), last = shiftMonth(month, -1);
  const days = byDay(daily, entityIds, clock), recentDays = byDay(recent, entityIds, clock);
  // A statistic without 5 minute rows (one imported from outside) only has its day row.
  const recentToday = recentDays.get(today);
  if (recentToday) days.set(today, recentToday);
  // In the first hour of a day the 5 minute rows (26 hours of them) still hold all of yesterday, while its day row
  // lacks its last hour or is missing (day rows are made from hour rows, written about 12 minutes past each hour).
  const yesterday = shiftKey(today, -1);
  if (at.hour === 0 && recentDays.has(yesterday)) days.set(yesterday, recentDays.get(yesterday));
  // Today by the hour (hour start in ms) for the money so far, from the same rows as today's total.
  // loadKwh is the balance, as the forecast and the money so far count use; houseKwh is what Today by
  // hour draws: the house sensor's reading when there is one, else the same balance.
  // ponytail: a statistic with only day rows is missing here while others have 5 minute rows (rare,
  // imported statistics); merge its day row into the first hour if that ever matters.
  const todayHours = Object.fromEntries([...statisticsBuckets(recentToday ? recent : daily, entityIds, (start) => hourStart(start, clock))]
    .filter(([start]) => clock(start).key === today));
  for (const h of Object.values(todayHours)) { h.houseKwh = houseKwh(h, entityIds); h.loadKwh = balanceKwh(h); }
  // Battery round trip from the hour rows, trusted only with enough days of them (see efficiencyOf).
  // Only days where both ways are known count: a day missing a row would read as a worse battery.
  const batteryDays = [...byDay(hourly, entityIds, clock)].filter(([, d]) => Number.isFinite(d.batteryKwh) && Number.isFinite(d.chargeKwh)).map(([key, d]) => ({ key, ...d }))
    .sort((a, b) => (a.key < b.key ? -1 : 1)); // by date: the buckets come in the order the meters' rows were met
  const kwhOf = (part) => batteryDays.reduce((s, d) => s + d[part], 0);
  // The charge (mean of the first hour from the energy rows' first on, of the last up to their last), weighted as
  // the live reading; null while any battery has no mean there. Its change over them, in kWh, corrects the round trip.
  // The very hours the energy rows start and end at: the charge rows grow by the hour, the energy rows once a day.
  const starts = (key) => Object.values(hourly).flat().map((r) => r.start).filter((t) => clock(t).key === key);
  const chargeIn = (from, to, pick) => {
    const ids = entityIds.chargeLevel ?? [], weight = entityIds.chargeWeight ?? {};
    const means = ids.map((id) => pick((rows.chargeLevel?.[id] ?? []).filter((r) => Number.isFinite(r.mean) && r.start >= from && r.start <= to))?.mean);
    return ids.length && means.every(Number.isFinite) ? means.reduce((s, m, i) => s + m * (weight[ids[i]] || 1), 0) / ids.reduce((s, id) => s + (weight[id] || 1), 0) : null;
  };
  const t0 = batteryDays.length ? Math.min(...starts(batteryDays[0].key)) : null, t1 = batteryDays.length ? Math.max(...starts(batteryDays.at(-1).key)) : null;
  const charge0 = batteryDays.length ? chargeIn(t0, Infinity, (list) => list[0]) : null, charge1 = batteryDays.length ? chargeIn(-Infinity, t1, (list) => list.at(-1)) : null;
  const storedKwh = charge0 !== null && charge1 !== null && options.battery?.kwh > 0 ? ((charge1 - charge0) / 100) * options.battery.kwh : 0;
  // A day without a row adds 0 for a part no meter counts, and between rows (one before it, one later in `keys`): a
  // meter that only counts up puts that day's energy into its next row (as in statisticsBuckets). Else (before the
  // first row on record, or with no row after it yet) it makes the sum unknown.
  const unmetered = (part) => ENERGY.includes(part) && !entityIds[part].length;
  const firstDay = [...days.keys()].sort()[0];
  const sum = (keys) => {
    const d = zero(), lastRow = keys.findLastIndex((key) => days.has(key));
    let count = 0;
    keys.forEach((key, i) => {
      const row = days.get(key);
      if (row) count++;
      for (const k of PARTS) d[k] = sumKnown([d[k], row ? row[k] : unmetered(k) || (key > firstDay && i < lastRow) ? 0 : null]);
    });
    if (!count) for (const k of PARTS) if (!unmetered(k)) d[k] = null;
    d.loadKwh = houseKwh(d, entityIds);
    // `none`: no numbers on record for any of the days, so its zeros are never drawn as real ones.
    d.days = count;
    if (!count) d.none = true;
    return d;
  };
  // Every day of a month (this one up to today), so a day missing from the statistics at its end leaves its total unknown.
  const of = (prefix) => monthDayKeys(prefix, prefix === month ? +today.slice(8) : undefined);
  const before = [7, 6, 5, 4, 3, 2, 1].map((back) => shiftKey(today, -back));
  // This month day by day, today last (from its 5 minute rows), each at noon UTC of its day: the page
  // formats these dates in UTC, so every viewer sees the same day. The rest of a day's figures show when
  // its day is picked (see productionCard), its money on Money (see moneyOf).
  /** @returns {Day & { date: number }} */
  const dayOf = (key) => ({ date: noonOf(key), ...sum([key]) });
  const monthDays = of(month).map(dayOf);
  // The other 11 months Production shows, day by day, with only what a picked day says (see picked),
  // rounded: the copy this browser remembers stays small.
  const pastDays = Object.fromEntries(yearKeys(month).filter((k) => k !== month).map((k) => {
    return [k, monthDayKeys(k).map((key) => {
      const d = dayOf(key);
      return d.none ? { date: d.date, none: true } : { date: d.date, ...Object.fromEntries(["solarKwh", "loadKwh", "gridImportKwh", "gridExportKwh"].map((p) => [p, roundTo(d[p], 100)])) };
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
  const dayWatthours = {}, hourWatthours = {};
  // Not asked at levels that leave the Energy settings' solar forecast out (see FETCHES): then {}.
  for (const f of Object.values(forecast || {})) for (const [time, v] of Object.entries(f.wh_hours || {})) {
    const t = Date.parse(time);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const c = clock(t), hour = hourStart(t, clock);
    dayWatthours[c.key] = (dayWatthours[c.key] || 0) + v;
    hourWatthours[hour] = (hourWatthours[hour] || 0) + v;
  }
  // A day the solar forecast covers only in part (fewer hours than PARTIAL_SHARE of its fullest day's, as
  // the last day of a forecast cut at noon) is left to the usual day, on every card that looks ahead.
  // Today never is: a forecast may list only the hours still to come. But a today covered in part is no
  // total to call poor, so the "wait" advice then has no tomorrow to wait for.
  const hoursOf = {};
  for (const t of Object.keys(hourWatthours)) { const k = clock(+t).key; hoursOf[k] = (hoursOf[k] || 0) + 1; }
  const most = Math.max(0, ...Object.values(hoursOf)), whole = (k) => hoursOf[k] >= most * PARTIAL_SHARE, fullDay = (k) => k === today || whole(k);
  const solarWh = Object.fromEntries(Object.entries(hourWatthours).filter(([t]) => fullDay(clock(+t).key)));
  // The hour rows are not asked at level none (see FETCHES): no usual day (no page forecast, no use line on the
  // coming days, no payback time left).
  const day = usualDay(hourly, entityIds, clock, machineHours, geo), usual = day?.loadW ? day : null;
  const tomorrow = shiftKey(today, 1);
  // The sun forecast of this hour, and the average of the next 3.
  const forecastHour = (i) => hourWatthours[hourStart(now + i * HOUR, clock)] || 0;
  const fade = { now: forecastHour(0), next: (forecastHour(1) + forecastHour(2) + forecastHour(3)) / 3 };
  // The usual day's kWh by now and in all, over today's real hours: a 23 or 25 hour day has as many.
  const hours = dayHours(now, clock);
  /** @param {number[]} w @param {(t: number) => number} [k] */
  const usualBy = (w, k = () => 1) => {
    let by = 0, all = 0;
    for (const t of hours) { const v = w[clock(t).hour] * k(t); all += v; by += v * clamp01((now - t) / HOUR); }
    return [by / 1000, all / 1000];
  };
  const sunUsual = usual ? usualBy(usual.solarW, usual.scale)[1] : sunny.length ? sunny.reduce((a, w) => a + w.solarKwh, 0) / sunny.length : null;
  // The usual day's sun on each day after today to the month's end, kWh by date, as the season moves it.
  const usualSunDays = {};
  if (usual) for (let t = hours.at(-1) + HOUR; clock(t).key.startsWith(month); t += HOUR)
    usualSunDays[clock(t).key] = (usualSunDays[clock(t).key] ?? 0) + usualSunAt(usual, t, clock) / 1000;
  return {
    today: sum([today]), lastMonth: sum(of(last)), monthDays, pastDays, monthKey: month, // "2026-10": this month
    // Every finished month on record before this one, oldest first, as [key, day figures]: payback and Month balance.
    // This month comes from the day rows (as `month`), which the month rows lag.
    months: [...byDay(monthly, entityIds, clock)].map(([key, d]) => /** @type {[string, Day]} */ ([key.slice(0, 7), { ...d, loadKwh: houseKwh(d, entityIds) }]))
      .filter(([key]) => key < month).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    usualToday: usual && { used: usualBy(usual.loadW) },
    // The days until there is a usual day, while the level asks for one and too few are on record; else null.
    usualIn: draws(options.level) && day?.onRecord !== undefined ? USUAL_MIN - day.onRecord : null,
    month: sum(of(month)),
    // The Energy settings' solar forecast for the advice ("soon", "later", "wait"; the level picks it, see
    // adviceForecast in data.js). `tomorrow` and `usual` are null when not known: only the "wait" advice needs them.
    // `sunUsual` is the usual day's sun, as the rest of the page counts it; without a usual day, the mean of the
    // days with sun among the last 7.
    forecast: today in dayWatthours ? { fade, today: dayWatthours[today] / 1000, tomorrow: tomorrow in dayWatthours && whole(tomorrow) && whole(today) ? dayWatthours[tomorrow] / 1000 : null, usual: sunUsual } : null,
    sunUsual,
    // From the end of today's last hour back to the clock's midnight (:30 in a half hour time zone): right on the
    // days the clocks change too.
    msToMidnight: ((end) => end - clock(end).minute * MINUTE - now)(dayHours(now, clock).at(-1) + HOUR),
    // Today's hour rows (project turns them into todayByHour, Today by hour). For the forecast part only (readData
    // leaves them out): the solar forecast by hour, the usual day, the battery round trip, the inverter's standby
    // (the owner's standby_w, else worked out from a load sensor, else 0).
    todayHours, solarWh, usual,
    // Where today's sun so far ends: the end of the 5 minute rows of the solar sensor that lags most (the
    // sum so far reaches no further). -Infinity while one has none: today's sun then scales nothing.
    sunUntil: entityIds.solarKwh.length ? Math.min(...entityIds.solarKwh.map((id) => Math.max(...(recent[id] ?? []).map((r) => r.start)))) + FIVE_MIN : null,
    // The solar forecast's kWh of each whole day after today, by date (Production's days to come, see monthAhead,
    // and the coming days without the sensor), and the usual day's sun in kWh (null without a usual day).
    sunDays: Object.fromEntries(Object.entries(dayWatthours).filter(([k]) => k > today && fullDay(k)).map(([k, v]) => [k, v / 1000])),
    usualSun: usual && usual.solarW.reduce((a, v) => a + v, 0) / 1000, usualSunDays,
    efficiency: efficiencyOf(kwhOf("batteryKwh"), kwhOf("chargeKwh"), batteryDays.length, storedKwh),
    standbyW: options.standbyW ?? (entityIds.loadKwh.length && gap >= STANDBY_MIN_KWH ? (gap / 24) * 1000 : 0),
    // Today's charge by the hour (see chargeLevelDay), the bill's fixed part by month (see fixedAt), each machine from its
    // runs (see machineOf), the tariff sensor's hour means and this month's grid hour rows (see bandsOf).
    chargeLevelDay: chargeLevelDay(rows.chargeLevel, entityIds.chargeWeight ?? {}, clock, now, entityIds.chargeLevel ?? []),
    fixedMonths: Object.fromEntries((rows.fixed?.[options.billFixed] ?? []).filter((r) => Number.isFinite(r.mean)).map((r) => [clock(r.start).key.slice(0, 7), r.mean])),
    // A machine running now also carries what is left of its run (see runningOf), from its 5 minute rows of the
    // last day: the day's call, then today's (`recent`, which wins where both have a row).
    machines: (options.machines ?? []).map((a) => {
      const m = machineOf(a, machineHours[a.sensor], rows.machineFive?.[a.sensor]);
      const five = [...new Map([...(rows.machineFive?.[a.sensor] ?? []), ...(recent[a.sensor] ?? [])].filter((r) => r.start >= now - DAY).map((r) => [r.start, r])).values()]
        .sort((x, y) => x.start - y.start);
      const running = m && five.length ? runningOf(m, five, now) : null;
      return running ? { ...m, running } : m;
    }),
    priceRows: rows.priceRows?.[options.tariff?.sensor] ?? [],
    gridMonth: rows.gridMonth ?? {},
  };
}

// ---- What a load asks ----
// Each statistics call with its own lifetime, so a load asks only what may have changed:
//   day: rows that change once a day (finished days and months, the usual day's hours, machines, prices), kept
//     until the next midnight. Asked before a quarter past midnight, only until then: Home Assistant writes
//     each hour row about 12 minutes past the hour, yesterday's last one too.
//   hour: rows that grow by the hour (the charge means, this month's grid hours, the solar forecast), kept until
//     a quarter past the hour. `grow`: asked whole the first time in a day, then from the newest row kept on.
//   new: today's 5 minute rows: kept, and only the rows from the newest kept on are asked (see toAsk).
// `when(level)`: the levels that draw what the call gives (null is auto, which may need any of them). A call
// not asked, or with no ids, gives {}.
const draws = (l) => l !== "none" && l !== "weather";      // the usual day, the machines' runs (the washer line)
const solarFc = (l) => l == null || l === "usual_days_weather"; // the Energy settings' Solar Forecast
const allIds = (entityIds) => PARTS.flatMap((k) => entityIds[k]);
// The machines' energy sensors (their runs, see machineOf).
const machineIds = (options) => [...new Set((options.machines ?? []).map((a) => a.sensor).filter(Boolean))];
// 5 minute rows from an hour before midnight (a day the clocks change still fits). In the first hour of a day,
// 26 hours (yesterday may have 25): totals takes yesterday from them while its day row is missing.
const recentSince = (now, clock) => { const at = clock(now); return at.hour === 0 ? now - 26 * HOUR : hourStart(now, clock) - (at.hour + 1) * HOUR; };
// Each call: [period, ids, start, types (default change)], or none for the solar forecast (a call of its own).
const FETCHES = [
  // 366 days reach the first day of the oldest month Production shows (see yearKeys) from any day.
  { name: "days", life: "day", ask: (entityIds, options, now) => ["day", allIds(entityIds), now - 367 * DAY] },
  // From the first on record: payback, Month balance.
  { name: "months", life: "day", ask: (entityIds) => ["month", allIds(entityIds), Date.UTC(2000, 0, 1)] },
  { name: "usual", life: "day", when: draws, ask: (entityIds, options, now) => ["hour", ENERGY.flatMap((k) => entityIds[k]), now - options.usualDays * DAY] },
  { name: "machineHours", life: "day", when: draws, ask: (entityIds, options, now) => ["hour", machineIds(options), now - MACHINE_DAYS * DAY] },
  { name: "machineFive", life: "day", when: draws, ask: (entityIds, options, now) => ["5minute", machineIds(options), now - FIVE_MIN_DAYS * DAY] },
  // The tariff's price sensor: its band means.
  { name: "priceRows", life: "day", ask: (entityIds, options, now) => ["hour", options.tariff?.sensor ? [options.tariff.sensor] : [], now - PRICE_DAYS * DAY, ["mean"]] },
  // The bill's fixed part from an entity: its month means, from the first on record.
  { name: "fixed", life: "day", ask: (entityIds, options) => ["month", typeof options.billFixed === "string" ? [options.billFixed] : [], Date.UTC(2000, 0, 1), ["mean"]] },
  // 25 hours cover today, even a long one.
  // Today's charge by the hour, and over the usual days the charge at their start and end (the round trip, see totals):
  // a day more than they, so their first hour is still kept when the usual rows were asked early in the day.
  // grow: asked whole once a day, then from the newest row kept (see toAsk).
  { name: "chargeLevel", life: "hour", grow: true, ask: (entityIds, options, now) => ["hour", entityIds.chargeLevel, now - Math.max(25 * HOUR, ((options.usualDays ?? 0) + 1) * DAY), ["mean"]] },
  // With a tariff of two or three bands, or such bands from the bills sensor, the grid's hour rows of this month:
  // the share bought in each band.
  // Asked whole once a day, then from the newest row kept (see toAsk).
  { name: "gridMonth", life: "hour", grow: true, ask: (entityIds, options, now, clock) => ["hour", (options.tariff && options.tariff.type !== "single") || options.billedBands ? entityIds.gridImportKwh : [], now - (+clock(now).key.slice(8) + 1) * DAY] },
  { name: "solarForecast", life: "hour", when: solarFc, ask: () => null },
  // With the machines' sensors too, where the machines are drawn: which one is running now (see totals).
  { name: "recent", life: "new", ask: (entityIds, options, now, clock) => ["5minute", [...new Set([...allIds(entityIds), ...(draws(options.level) ? machineIds(options) : [])])], recentSince(now, clock)] },
];
// Until when what is asked at `now` is kept, by its lifetime.
function untilOf(life, now, clock) {
  if (life === "new") return now; // asked on every load, from the newest row kept
  const hours = dayHours(now, clock);
  return life === "hour" || now < hours[0] + 15 * MINUTE ? quarterPast(now) : hours.at(-1) + HOUR;
}
// 5 minute rows added to less than this long ago are added to again; past it (a hidden tab, Home Assistant
// restarting) the window is asked whole.
const RECENT_GAP = 30 * MINUTE;

// What a load asks, from the fetch table: [{ name, life, key, msg, from, since }] for every call not kept (`kept`,
// by name: { key, until, at, rows }), kept for other ids or settings (its key), or past its lifetime. msg null:
// nothing to ask, the answer is {}. The 5 minute rows always come: from the newest row kept on (`from`; `since`
// the window's start) while they were added to within RECENT_GAP and some id has one, else the window whole.
// A `grow` call asked earlier today comes the same way. start_time in ms.
function toAsk(entityIds, options, kept, now, clock) {
  return FETCHES.map(({ name, life, when, ask, grow }) => {
    const on = !when || when(options.level), a = ask(entityIds, options, now, clock);
    const message = !on ? null : !a ? { type: "energy/solar_forecast" }
      : a[1].length ? { type: "recorder/statistics_during_period", period: a[0], statistic_ids: a[1], start_time: a[2], types: a[3] ?? ["change"], units: { energy: "kWh" } } : null;
    // The usual day's window (and the charge's, as long) is part of what is asked; every other start moves with the clock.
    const key = JSON.stringify([message?.type, message?.period, message?.statistic_ids, message?.types, name === "usual" || name === "chargeLevel" ? options.usualDays : 0]);
    const k = kept?.[name];
    if (life !== "new" && k?.key === key && now < k.until) return null;
    if (message && k?.key === key && (life === "new" ? now - k.at < RECENT_GAP : grow && clock(k.at).key === clock(now).key)) {
      // The newest row of any id: Home Assistant writes a 5 minute period's rows for every sensor at once, so an id
      // without one then (an inverter asleep since sunset, a statistic with hour rows only) had none to give.
      // ponytail: rows a cloud integration imports late into periods already asked are missed until the next day.
      const newest = Math.max(...message.statistic_ids.map((id) => k.rows[id]?.at(-1)?.start ?? -Infinity));
      if (newest > -Infinity) return { name, life, key, msg: { ...message, start_time: newest }, from: newest, since: a[2] };
    }
    return { name, life, key, msg: message };
  }).filter(Boolean);
}
// The rows kept from `since` up to `from`, then those just asked, from `from` on.
const recentOf = (kept, fresh, since, from) => Object.fromEntries(Object.keys({ ...kept, ...fresh }).map((id) =>
  [id, [...(kept[id] ?? []).filter((r) => r.start >= since && r.start < from), ...(fresh[id] ?? []).filter((r) => r.start >= from)]]));

// The statistics for one load: { rows (by name, see totals), kept (for the next load) }. Calls run side by side.
// A failed solar forecast is no forecast this load, and is not kept, so the next load asks again (Home
// Assistant restarting answers with errors for a while); any other failure fails the load.
async function fetchStats(hass, entityIds, options, kept = {}, now, clock) {
  const asks = toAsk(entityIds, options, kept, now, clock), next = { ...kept }, failed = {};
  await Promise.all(asks.map(async ({ name, life, key, msg: message, from, since }) => {
    const answer = !message ? {} : await hass.callWS(message.start_time == null ? message : { ...message, start_time: new Date(message.start_time).toISOString() })
      .catch((e) => { if (name === "solarForecast") return null; throw e; });
    if (answer === null) { delete next[name]; failed[name] = {}; return; }
    const rows = from == null ? answer : recentOf(kept[name].rows, answer, since, from);
    next[name] = { key, until: untilOf(life, now, clock), at: now, rows };
  }));
  return { rows: Object.fromEntries(FETCHES.map(({ name }) => [name, failed[name] ?? next[name].rows])), kept: next };
}

export { ENERGY, balanceKwh, chargeLevelDay, usualDay, totals, toAsk, untilOf, fetchStats }; // usualDay: for the tests
