/* Money rules, no drawing: what the system saved, earned and cost (today so far, each day, each month), where
   this month should end, the tariff's bands today, and payback. One price rule for all of them: pricedEnergy
   (core.js), so 0 kWh is a known 0 and unknown energy or no price is null, never 0. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("./core.js"), typeof import("./sky.js"), typeof import("./forecast.js")]} */
const [{ HOUR, sumKnown, daysIn, shiftMonth, dayHours, noonOf, clamp01, num, pricedEnergy, selfKwh }, { monthSun }, { bandOf }] = await Promise.all([
  import(`./core.js${v}`), import(`./sky.js${v}`), import(`./forecast.js${v}`)]);

const PAYBACK_SPREAD = 0.2; // payback's likely range: every coming month this much better and worse, until a year is on record
const PAYBACK_MAX_MONTHS = 600; // the payback walk gives up here (50 years)
const SELF_MAX = 0.99; // a month's own share of its use is taken as at most this, so the season guess's log stays finite

// Today so far in money, hour by hour, for the outlook (see lookAhead): `todayHours` is { hour start ms: { loadKwh,
// gridImportKwh, gridExportKwh } } with loadKwh the energy balance, buyAt(t) and sellAt(t) the price of that hour.
// Standby is left out of the savings, as in lookAhead, for the part of each hour already passed by `now`. Each hour
// priced as a day is (pricedEnergy); a field is null when an hour it needs has an unknown figure, or kWh and no price.
// The Money page's today (see moneyOf) is the day row priced at the Energy settings' price or its money statistics:
// the outlook needs each hour at its own price, the page what Home Assistant recorded.
function moneySoFar(todayHours, buyAt, sellAt, standbyKwhPerHour, now) {
  let saved = 0, cost = 0, earned = 0;
  const add = (sum, kwh, rate) => sumKnown([sum, pricedEnergy(kwh, rate)]);
  for (const [key, h] of Object.entries(todayHours)) {
    const t = +key, buy = buyAt(t), standby = (standbyKwhPerHour * (Math.min(now, t + HOUR) - t)) / HOUR;
    const { loadKwh: use, gridImportKwh: imp, gridExportKwh: exp } = h;
    saved = add(saved, Number.isFinite(use) && Number.isFinite(imp) ? Math.max(0, use - standby - imp) : null, buy);
    cost = add(cost, imp, buy);
    earned = add(earned, exp, sellAt(t));
  }
  return { saved, cost, earned };
}

// The money of a day or month row ({ loadKwh, gridImportKwh, gridExportKwh, costMoney, earnedMoney }), as the Money
// page counts it, for this month (`key`, "2026-11"):
// - onRecord[k](x): from the statistics. What the grid cost and paid as Home Assistant recorded it, when there is
//   some for the row (so a new price leaves past months as they were), else its kWh at today's price. Saved has no
//   statistic of its own: the house's own kWh at the row's average grid price (its cost over its kWh), else at
//   today's. With export off nothing is earned.
// - fixedAt(mk): the bill's fixed part in a month: that month's mean of its entity, else the nearest month before
//   with one, else the first on record (the month is older than the entity), else its value now; null (unknown)
//   when the entity has neither. No bill_fixed at all is 0.
// - got(k, x, mk): the sensor's figure for a finished month when it has one (fresh, at every level), else
//   onRecord; the fixed part on every month's cost whole, as the bill charges it. back: saved plus earned. net:
//   back less cost. Each null when any part is.
// - end: this month's end ({ saved, earned, cost } as [low, mid, high]; back and net from their mids): the sensor's while it is the
//   forecast in use with house use, else this month so far plus what the outlook expects (see moneyAhead).
// - coming: see moneyAhead.
// ponytail: a month whose cost statistic started part way through counts only that part.
function moneyOf(data, key) {
  const p = data.price, months = data.sensorMonths, ownEnd = data.mode?.level === "learned_weather" && !!months;
  const onRecord = {
    cost: (x) => num(x.costMoney) ?? pricedEnergy(x.gridImportKwh, p.buy),
    earned: (x) => (!data.sends ? 0 : num(x.earnedMoney) ?? pricedEnergy(x.gridExportKwh, p.sell)),
    saved: (x) => { const self = selfKwh(x); return self !== null && num(x.costMoney) !== null && x.gridImportKwh > 0 ? self * x.costMoney / x.gridImportKwh : pricedEnergy(self, p.buy); },
  };
  const fx = data.billFixed ?? {}, fxKeys = Object.keys(fx.months ?? {}).sort();
  const fixedAt = (mk) => fx.months?.[mk] ?? fx.months?.[fxKeys.filter((k) => k < mk).at(-1) ?? fxKeys[0]] ?? (fx.now === undefined ? 0 : fx.now);
  const got = (k, x, mk) => {
    const v = months?.[mk]?.money?.[k], r = Number.isFinite(v) ? v : onRecord[k](x);
    return r === null ? null : k !== "cost" ? r : fixedAt(mk) === null ? null : r + fixedAt(mk);
  };
  const back = (x, mk) => sumKnown([got("saved", x, mk), got("earned", x, mk)]);
  const net = (x, mk) => { const c = got("cost", x, mk), b = back(x, mk); return c === null || b === null ? null : b - c; };
  const fee = fixedAt(key), s = ownEnd ? months[key]?.money : null;
  const r = (j) => (Array.isArray(s?.[j]) && s[j].every(Number.isFinite) && (j !== "cost" || fee !== null) ? s[j].map((y) => y + (j === "cost" ? fee : 0)) : null);
  const end = { saved: r("saved"), earned: r("earned"), cost: r("cost") };
  // What the month should bring back: saved, plus earned while export is on.
  end.back = end.saved ? end.saved[1] + (data.sends ? end.earned?.[1] ?? 0 : 0) : null;
  end.net = end.back !== null && end.cost ? end.back - end.cost[1] : null;
  const coming = moneyAhead(data), m = data.month, soFarNet = m && !m.none ? net(m, key) : null;
  if (!ownEnd && coming?.rest != null && soFarNet !== null) end.net = soFarNet + coming.rest;
  return { ownEnd, onRecord, fixedAt, got, back, net, end, coming };
}

// What each month brought back (saved and earned), for payback: finished months as the month card reads them, this
// month so far from the statistics (the sensor's figure for it is the month end), from the first month on record to
// `key`. A month whose savings are unknown stays in, as null: payback then cannot say what came back. So does a month
// missing from the month rows between the first on record and this one (last month from the day rows, which the
// month rows lag). Each with its kWh and money for seasonGuess.
function ledgerOf(data, key, { back, got }) {
  const ledger = [], have = new Map(data.months ?? []), lastKey = shiftMonth(key, -1);
  for (let mk = [...have.keys(), key].sort()[0]; mk <= key; mk = shiftMonth(mk, 1)) {
    const x = mk === key ? data.month : have.get(mk) ?? (mk === lastKey ? data.lastMonth : null);
    ledger.push({ key: mk, back: x ? back(x, mk) : null, ...(x && {
      sun: x.solarKwh, load: x.loadKwh, out: x.gridExportKwh,
      self: selfKwh(x),
      saved: got("saved", x, mk), earned: got("earned", x, mk) }) });
  }
  return ledger;
}

// Payback from the ledger (`all`, see ledgerOf) and the owner's figures (`pb`: cost, before, since): what came back
// since the install date plus what was saved before Home Assistant recorded (`got`), its share of the cost, and how
// long is left (see paybackLeft; only while the page `predicts` anything), and what this month (the ledger's last)
// brought back so far (`month`, null before the install month). Once paid, the month it happened (`on`,
// null when it had before Home Assistant recorded). { incomplete: true } while a month since then is unknown; null
// without a cost.
function paybackOf(all, pb, predicts, at = {}) {
  if (!pb) return null;
  // The install date's month as written ("2026-11-01"), never moved by a time zone.
  const since = typeof pb.since === "string" ? pb.since : "";
  const from = since.slice(0, 7), done = all.filter((x) => x.key >= from);
  if (done.some((x) => x.back === null)) return { incomplete: true };
  const got = pb.before + done.reduce((s, x) => s + x.back, 0), paid = got >= pb.cost;
  // Finished months only: this month so far would pull the guess down. Its rest still comes back first. So would
  // an install month that started after its 1st (the house's whole month against part of the sun), while there
  // are other months to go by.
  const past = done.slice(0, -1), part = since.slice(8, 10) > "01" && past.length > 1 && past[0].key === from;
  const left = paid || !predicts ? null : paybackLeft(pb.cost - got, part ? past.slice(1) : past, done.at(-1)?.key, done.at(-1)?.back, at);
  let on = null;
  for (let s = pb.before, i = 0; paid && s < pb.cost && i < done.length; i++) if ((s += done[i].back) >= pb.cost) on = done[i].key;
  return { incomplete: false, got, cost: pb.cost, share: clamp01(got / pb.cost), paid, on, left, month: done.at(-1)?.back ?? null };
}

// Today's hours of each band, as runs of whole hours in Home Assistant's time zone (a day the clocks change has
// 23 or 25). A run over midnight is one: F3 from 23:00 to 7:00. [{ band, from, to }] in ms.
function bandRuns(now, clock, type) {
  const runs = [], day = clock(now).key;
  for (const at of dayHours(now, clock)) {
    const b = bandOf(day, clock(at).hour, type), last = runs.at(-1);
    if (last?.band === b) last.to = at + HOUR; else runs.push({ band: b, from: at, to: at + HOUR });
  }
  if (runs.length > 1 && runs[0].band === runs.at(-1).band) runs.at(-1).to = runs.shift().to;
  return runs;
}

// This month's money still to come, from the outlook (see lookAhead): each whole day after today in this month
// as { date, back, cost } (back: saved, plus earned while export is on), up to the first a price leaves unknown;
// `rest`, `cost` and `back`: what the rest of the month should add to its net, grid cost and savings once those
// days reach its last day (else null).
// null without an outlook that has them (none with weather alone: it has no house use).
function moneyAhead(data) {
  const o = data.outlook, key = data.monthKey, sends = data.sends;
  if (!o?.daysMoney || !o.restToday || !key) return null;
  const days = [];
  for (const { key: d, saved, cost, earned } of o.daysMoney) {
    const back = sumKnown([saved, sends ? earned : 0]);
    if (!d.startsWith(key) || back === null || cost === null) break;
    days.push({ date: noonOf(d), back, cost });
  }
  const r = o.restToday, back = sumKnown([r.saved, sends ? r.earned : 0]), cost = r.cost ?? null;
  const reach = days.length ? new Date(days.at(-1).date).getUTCDate() : data.monthDays?.length;
  if (reach !== daysIn(key) || back === null || cost === null) return { days, rest: null, cost: null, back: null };
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  return { days, rest: back - cost + sum("back") - sum("cost"), cost: cost + sum("cost"), back: back + sum("back") };
}
// Months until `owed` is back: each coming month brings what the same calendar month brought when last on
// record (the latest January for every coming January, years ahead too), or, while that month has not been
// on record yet, what seasonGuess makes of the months on record (the average month when it cannot tell).
// [low, mid, high] months: the range walks every month PAYBACK_SPREAD better and worse, one value once a full
// year is on record. null with nothing on record.
// soFar: what month `lastKey` (under way) brought so far; its rest, what such a month brings less that,
// comes back first (at least 1 month is said all the same).
function paybackLeft(owed, past, lastKey, soFar = null, /** @type {{ lat?: number, sell?: number }} */ { lat, sell = 0 } = {}) {
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
  const lit = past.filter((x) => x.sun > 0), b = sum(lit, (x) => (-Math.log(1 - Math.min(SELF_MAX, x.self / x.load)) * x.load) / x.sun) / lit.length;
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

export { moneySoFar, moneyOf, ledgerOf, paybackOf, bandRuns, moneyAhead, paybackLeft, seasonGuess };
