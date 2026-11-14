/* MONEY: payback, this month day by day, the prices now and the month balance. moneyView gives what the page
   shows as plain data (a card null when it is not drawn), with the help lines each card draws; moneyPage turns
   it into HTML. The rules are in money.js. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("../lib/core.js"), typeof import("../lib/draw.js"), typeof import("../lib/money.js"), typeof import("../lib/data.js"),
 *   typeof import("../lib/forecast.js")]} */
const [{ pct, say, cap, sumKnown, shiftMonth, yearKeys }, { ADVICE_ICON, HOUSE, PLUG, helpButton, markOf, ring, readout, dayLine, monthPicker, monthSteps, boldDate, monthName },
  { moneyOf, ledgerOf, paybackOf, bandRuns }, { paybackPredicts }, { bandOf }] = await Promise.all([
  import(`../lib/core.js${v}`), import(`../lib/draw.js${v}`), import(`../lib/money.js${v}`), import(`../lib/data.js${v}`), import(`../lib/forecast.js${v}`)]);

// Money to 10 cents: what is still to come is no finer than that.
const cents = (f, n) => f.money(Math.round(n * 10) / 10);
// The balance as a readout figure, in the low colour below 0.
const netRow = (t, f, net) => [t.netBenefit, f.money(net), net < 0 ? "--low" : "--batt", net < 0];

// A money statistic in some of these rows.
const stat = (rows) => rows.some((x) => Number.isFinite(x?.costMoney) || Number.isFinite(x?.earnedMoney));
// Something prices the numbers: a price in the Energy settings, the sensor's month money or a money statistic.
const priced = (data, rows) => data.price.buy != null || data.price.sell != null || Object.values(data.sensorMonths ?? {}).some((m) => m?.money) || stat(rows);

// Payback for this month (see paybackOf): its own step, as it walks up to 50 years of months. The page asks for it
// once per change of the numbers, not on every redraw of Money (a month picked). Unknown because nothing prices the
// numbers: null, so the card goes like the other unpriced Money cards (and the skeleton, which draws from this too).
function paybackView(data, now, clock) {
  const key = clock(now).key.slice(0, 7);
  const v = paybackOf(ledgerOf(data, key, moneyOf(data, key)), data.payback, paybackPredicts(data), { lat: data.lat, sell: data.sends ? data.price.sell ?? 0 : 0 });
  return v?.incomplete && !priced(data, [data.month, data.lastMonth, ...(data.months ?? []).map(([, x]) => x)]) ? null : v;
}

// What the Money page shows at `now`: { empty, payback, recent, prices, month, help }. `pick` holds the month and
// day picked; `payback` is paybackView's answer when the caller kept it.
/** @param {import("../lib/data.js").ViewInput} c */
function moneyView({ data, now, clock, pick }, payback = paybackView(data, now, clock)) {
  const p = data.price, c = clock(now), key = c.key.slice(0, 7), lastKey = shiftMonth(key, -1);
  const { onRecord, got, back, net, end, coming, ownEnd } = moneyOf(data, key);
  // The price now: the tariff's band now when it has bands, else the sensor's present hour while it is fresh (at
  // every level), else the Energy settings' one. Selling only while export is on.
  const hour = data.priceNow, bd = data.bands, bandNow = bd && bandOf(c.key, c.hour, bd.type);
  const buy = bd ? bd.prices[bandNow] : hour?.buy ?? p.buy, sell = hour?.sell ?? p.sell, selling = data.sends && sell !== null;
  // With two or three bands, one box each under buying: its name, its runs of hours today, the share of this month's
  // grid energy bought in it and its price; the band now outlined.
  const runs = bd && bd.type !== "single" ? bandRuns(now, clock, bd.type) : null;
  const prices = buy === null && !selling ? null : { buy, sell, selling, bandNow: runs ? bandNow : null, allDay: runs?.length === 1,
    bands: runs && Object.entries(bd.prices).map(([band, price]) => ({ band, price, runs: runs.filter((r) => r.band === band), share: bd.share ? bd.share[band] : null })) };
  // Finished months from the month rows (last month from its day rows, as `lastMonth`, until it has one), this one
  // from the day rows (as `month`).
  const byMonth = new Map([[lastKey, data.lastMonth], ...(data.months ?? []), [key, data.month]]);
  const row = (mk) => { const x = byMonth.get(mk); return x && !x.none ? x : null; };
  // A card of money shows only when something prices it: a price, the sensor's month money or a money statistic.
  // A day or month that bought or sent 0 kWh is a known 0 even then, which alone would draw a card of dashes.
  const anyPrice = p.buy != null || p.sell != null;
  // Month balance: each of the 12 months' net (null when nobody can price it; `noPrice`: numbers on record, no price
  // set; a month with a day missing is not unpriced), the picked one's grid cost, savings, export and net, and for
  // this month where its cost, savings and net should end (see moneyOf). Gone when no month has any money known.
  const at = yearKeys(key).includes(pick?.balanceMonth) ? pick.balanceMonth : key, x = row(at);
  const shown = priced(data, [...byMonth.values()])
    && yearKeys(key).some((mk) => row(mk) && ["cost", "saved", "earned"].some((k) => got(k, row(mk), mk) !== null));
  let month = null;
  if (shown) {
    const cost = x && got("cost", x, at), brought = x && back(x, at);
    const endCost = at !== key ? null : ownEnd ? end.cost?.[1] ?? null : coming?.cost != null && cost !== null ? cost + coming.cost : null;
    const endBack = at !== key ? null : ownEnd ? end.back : coming?.back != null && brought !== null ? brought + coming.back : null;
    month = { key, at, sends: data.sends, endNet: end.net,
      months: Object.fromEntries(yearKeys(key).map((mk) => [mk, { net: row(mk) ? net(row(mk), mk) : null, noPrice: !!row(mk) && !anyPrice }])),
      picked: x && { cost, saved: got("saved", x, at), earned: got("earned", x, at), brought, net: net(x, at), endCost, endBack } };
  }
  // This month day by day: what each day brought back from its day rows, priced as the months without the fixed
  // fees; null for a day with no numbers on record or nobody to price it. The days to come from the outlook.
  const days = (data.monthDays ?? []).map((d) => ({ date: d.date, none: d.none, back: d.none ? null : sumKnown([onRecord.saved(d), onRecord.earned(d)]), cost: d.none ? null : onRecord.cost(d) }));
  const recent = (anyPrice || stat(data.monthDays ?? [])) && days.some((d) => d.back !== null || d.cost !== null)
    ? { key: data.monthKey, days, coming: coming?.days ?? [], at: pick?.recent } : null;
  // The month's end is drawn as a faded bar: behind this month's net, or behind its cost or savings.
  const ghost = !!month && ((month.months[key].net !== null && end.net !== null) || (!!month.picked && (month.picked.endCost > 0 || month.picked.endBack > 0)));
  return { empty: !month && !payback && !recent && !prices, payback, sends: data.sends, recent, prices, month,
    help: {
      payback: ["helpPaybackArc", "helpPaybackCost", ...(paybackPredicts(data) ? ["helpPaybackLeft"] : [])],
      recent: ["helpRecentBar", ...(data.sends ? ["helpRecentSold"] : []), ...(coming?.days.length ? ["helpRecentAhead"] : []), "helpDayToday", "helpRecentPick"],
      prices: ["helpPricesBuy", ...(runs ? ["helpPricesBands"] : []), ...(data.sends && sell != null ? ["helpPricesSell"] : []), "helpPricesRates"],
      table: ["helpBalMonths", ...(ghost ? ["helpBalEnd"] : []), "helpBalSplit", "helpBalNet"],
    } };
}

// The page, "" when no card has anything (the page then goes).
function moneyPage(v, t, f) {
  if (v.empty) return "";
  const sign = f.money(0).split(" ").pop();
  return `
    <h1 class="title">${t.tabMoney}</h1>
    ${paybackHtml(v.payback, t, f, v.sends)}${v.recent ? recentCard(v.recent, sign, t, f) : ""}${v.prices ? pricesCard(v.prices, t, f) : ""}${v.month ? monthCard(v.month, sign, t, f) : ""}`;
}
// The page from c = { data, t, f, clock, pick, now } in one step, for the preview and tests.
const moneyHtml = (c) => moneyPage(moneyView(c), c.t, c.f);

// The prices now: buying from the grid, and selling to it while export is on, each with which way the energy goes.
function pricesCard(v, t, f) {
  const bandList = !v.bands ? "" : `<ul class="bands">${v.bands.map((b) => {
    const when = !b.runs.length ? `<span>${t.notToday}</span>` : v.allDay ? `<span>${t.allDay}</span>` : b.runs.map((r) => `<span>${f.time(r.from)} - ${f.time(r.to)}</span>`).join("");
    return `<li${b.band === v.bandNow ? ' aria-current="true"' : ""}><span class="name">${b.band.toUpperCase()}</span>${when}${b.share !== null ? `<span class="band-pct">${say(t.bandShare, { p: f.num(pct(b.share)) })}</span>` : ""}<span class="num">${f.money(b.price)}</span></li>`;
  }).join("")}</ul>`;
  const nowTag = v.bands ? ` <span class="band-now">${say(t.bandNow, { b: v.bandNow.toUpperCase() })}</span>` : "";
  const flow = (label, x, out, more = "") => `<div class="price${out ? " out" : ""}"><p class="rate"><span>${label}</span> <b>${f.money(x)}<small> /kWh</small></b></p>
      <p class="route"><svg class="end" viewBox="-17 -17 34 34" role="img" aria-label="${t.home}">${HOUSE}</svg><span class="arrow" aria-hidden="true">${out ? '<i></i><svg viewBox="17 7 6 10"><path d="m18 8 4 4-4 4"/></svg>' : '<svg viewBox="1 7 6 10"><path d="M6 8 2 12l4 4"/></svg><i></i>'}</span><svg class="end" viewBox="0 0 24 24" role="img" aria-label="${t.grid}">${PLUG}</svg></p>${more}</div>`;
  return `<section class="card prices">
      <h2>${t.pricesTitle}</h2>${helpButton(t, "prices")}
      ${v.buy === null ? "" : flow(t.buyGrid + nowTag, v.buy, false, bandList)}${v.selling ? flow(t.sellGrid, v.sell, true) : ""}
    </section>`;
}

// Month balance: the 12 months' net as bars (see monthPicker), the picked one (this one at first) under them: its
// grid cost to the left of a middle line, what it saved and earned to the right, on one scale, with their figures,
// then saved, export and the net as figures (see readout; a net below 0 in the low colour). A figure nobody can
// price, or unknown, is a dash, without a bar; a month with no numbers on record says so. For this month, where its
// net, cost and savings should end, a faded bar behind each.
function monthCard(v, sign, t, f) {
  const { key, at, picked: x } = v, named = (k) => monthName(k, key, t, f);
  const most = x && Math.max(x.cost ?? 0, x.brought ?? 0, x.endCost ?? 0, x.endBack ?? 0, 1e-9), w = (n) => ((n / most) * 100).toFixed(1);
  // ponytail: a figure below 0 (a negative tariff) has its number but no bar; draw it to the other side if that ever matters.
  const side = (cls, label, n, color, ahead) => `<div class="side ${cls}"><span>${label}</span><span class="track">${ahead > 0 ? `<i class="ghost" style="--c:${markOf(color)};--w:${w(ahead)}%"></i>` : ""}${!(n > 0) ? "" : `<i style="--c:${markOf(color)};--w:${w(n)}%"></i>`}</span><b>${f.money(n)}</b></div>`;
  return `<section class="card months" data-pick="balance">
      <h2><span>${t.monthTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "table")}
      ${monthPicker(t, f, key, at, (k) => v.months[k].net, (k, n) => `${named(k)}: ${n === null ? (v.months[k].noPrice ? t.noPrice : t.noData) : say(t.hBalance, { v: f.money(n) })}`, "--batt", true, (k) => (k === key ? v.endNet : null))}
      <div class="stepped">${monthSteps(t, key, at, (k) => cap(named(k)))}<h3 class="chart-title">${cap(named(at))}</h3></div>
      ${x ? `<div class="split">${side("cost", t.gridCost, x.cost, "--grid", x.endCost)}${side("back", v.sends ? t.savedEarned : t.savedLabel, x.brought, "--sun", x.endBack)}</div>
      ${readout("", [
        [t.savedLabel, f.money(x.saved), "--sun"],
        v.sends ? [t.exportLabel, f.money(x.earned), "--sent"] : null,
        netRow(t, f, x.net),
      ])}
      ${at === key && v.endNet !== null ? `<p class="note">${say(t.balEnd, { v: cents(f, v.endNet) })}</p>` : ""}` : `<p class="note">${t.noData}</p>`}
    </section>`;
}

// This month day by day (see dayLine): what each day brought back, and the picked day's savings, grid cost
// and balance under the chart (the month's total is on Month balance). A cost nobody can price leaves the
// balance unknown too. The days still to come (see moneyAhead) dashed on, each with its sentence, to 10 cents.
function recentCard(v, sign, t, f) {
  const ahead = v.coming.map((d) => {
    const date = f.date(new Date(d.date)), plain = cap(say(t.hDayMoney, { d: date, v: cents(f, d.back), c: cents(f, d.cost) }));
    return [d.back, plain, boldDate(plain, t.hDayMoney, date)];
  });
  const day = (x, n, lead) => {
    if (n === null) return readout(lead, [[x.none ? t.noData : t.noPrice, "—"]]);
    return readout(lead, [[t.returns, f.money(n), "--sun"], [t.gridCost, f.money(x.cost), "--grid"], netRow(t, f, x.cost == null ? null : n - x.cost)]);
  };
  return `<section class="card recent" data-pick="recent">
      <h2><span>${t.recentTitle}</span> <span class="num">${sign}</span></h2>${helpButton(t, "recent")}
      ${dayLine(t, f, v.key, v.days, (x) => x.back, (x, n) => `${f.date(new Date(x.date))}: ${n === null ? (x.none ? t.noData : t.noPrice) : f.money(n)}`, day, v.at, { ahead })}
    </section>`;
}

// Payback (see paybackOf): a ring of the share that came back, with what came back in its middle and the cost in its
// gap, named under it, and how long is left. Once paid, a check in the full ring, the month it happened and what
// came back since. "" without a cost.
// `sends`: export is on, so the month line says saved and sold (the ledger counts both).
function paybackHtml(v, t, f, sends) {
  if (!v) return "";
  if (v.incomplete) return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <p class="note">${t.paybackIncomplete}</p>
    </section>`;
  const { got, paid, left } = v;
  // The range names the unit once, in the main figure: "About 7.5 years left (6.3 to 9.3)".
  const years = left && left[1] >= 24, round = (n) => (years ? Math.round(n / 1.2) / 10 : n);
  const span = (n) => (years ? f.years(round(n)) : f.months(n)), bare = (n) => f.num(round(n));
  const of = say(t.paybackOf, { a: f.moneyWhole(got), b: f.moneyWhole(v.cost) });
  const head = !paid ? of : v.on ? say(t.paybackOn, { m: f.monthYear(v.on) }) : t.paidBack;
  const when = paid ? say(t.paybackGain, { v: f.moneyWhole(got - v.cost) })
    : left && say(t.paybackLeft, { d: span(left[1]) }) + (left[0] !== left[2] ? ` (${say(t.paybackRange, { a: bare(left[0]), b: bare(left[2]) })})` : "");
  return `<section class="card payback">
      <h2>${t.paybackTitle}</h2>${helpButton(t, "payback")}
      <div class="ring-box">
        ${ring(v.share, "--sun", paid ? head : of, paid ? "" : f.moneyWhole(v.cost))}
        <div class="ring-mid" aria-hidden="true">${paid ? `<svg class="done" viewBox="0 0 24 24">${ADVICE_ICON.ok}</svg>` : `<span class="amount">${f.moneyWhole(got)}</span>`}</div>
      </div>
      ${paid ? `<p>${head}</p>` : `<p class="ring-name">${t.plantCost}</p>`}${v.month === null ? "" : `<p class="money month">${say(sends ? t.paybackMonthSold : t.paybackMonth, { v: f.moneyWhole(v.month) })}</p>`}${when ? `<p class="money">${when}</p>` : ""}
    </section>`;
}
// The card from a ledger in one step (see paybackOf), for the preview and tests.
const paybackCard = (all, pb, { t, f }, predicts, at) => paybackHtml(paybackOf(all, pb, predicts, at), t, f);

export { paybackView, moneyView, moneyPage, moneyHtml, paybackCard };
