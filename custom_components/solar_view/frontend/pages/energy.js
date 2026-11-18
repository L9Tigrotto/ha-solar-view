/* ENERGY: where today's use came from (Power origin), today hour by hour, and Production. energyView gives what
   the page shows as plain data (a card null when it is not drawn), with the help lines each card draws;
   energyPage turns it into HTML. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {[typeof import("../lib/core.js"), typeof import("../lib/draw.js"), typeof import("../lib/data.js"), typeof import("../lib/stats.js")]} */
const [{ MINUTE, FIVE_MIN, HOUR, clamp01, percent, say, cap, dayHours, hourStart, inHour, chargeShift, sumKnown, selfKwh, noonOf, monthDayKeys, yearKeys },
  { hint, big, markOf, helpButton, TRACK, ringSize, splitRing, legendHtml, lineGrid, readout, monthSteps, steps, dayLine, monthTotal, monthPicker, nowLabel, boldDate, monthName },
  { fromSensor, weatherOnly }, { balanceKwh }] = await Promise.all([
  import(`../lib/core.js${v}`), import(`../lib/draw.js${v}`), import(`../lib/data.js${v}`), import(`../lib/stats.js${v}`)]);

const MIN_USE_KWH = 0.05; // under this the house has used nothing yet today, so there is no share to show
const SENT_KWH = 0.05;    // "sent to the grid" rows stay hidden below this
const NOTHING_KWH = 0.05; // under this a figure is nothing: no part of the ring, "nothing" from the grid in an hour
// Share of the house use that did not come from the grid. null while nothing has been used
// (just after midnight), or when either figure is unknown: neither 0 % nor 100 % would be true.
function ownShare(d) { return Number.isFinite(d.loadKwh) && Number.isFinite(d.gridImportKwh) && d.loadKwh >= MIN_USE_KWH ? clamp01(1 - d.gridImportKwh / d.loadKwh) : null; }

// The forecast counts use as the balance (what flows in less what flows out, the inverter's own use with
// it): beside it, today so far counts the same way, even with a load sensor, so so far and ahead add up and
// the battery and grid match their meters.
const onBalance = (data) => ({ ...data, today: { ...data.today, loadKwh: balanceKwh(data.today) ?? data.today.loadKwh } });
// The small rings come with an outlook that has hours left today (the mid run).
const ringsAhead = (data) => data.outlook?.hoursAhead?.length > 0;

// What the Energy page shows at `now`: { share, hoursToday, production, help }. `pick` holds the day, hour and month
// picked. monthAhead once for Production and its help.
/** @param {import("../lib/data.js").ViewInput} c */
function energyView({ data, now, clock, pick }) {
  const coming = monthAhead(data), noChargeLevel = !data.battery || data.now.chargeLevel === null, share = shareView(data, now);
  return { share, hoursToday: hoursTodayView(data, now, clock, pick), production: productionView(data, pick, coming),
    help: {
      share: share.noUse ? [] : ["help.shareSun", ...(data.battery ? ["help.shareBattery"] : []), "help.shareGrid", "help.shareNumber", "help.shareTotal",
        ...(ringsAhead(data) ? ["help.shareAhead"] : [])],
      hoursToday: ["help.hoursBars", ...(data.outlook || weatherOnly(data) ? ["help.hoursGhost"] : []),
        ...(noChargeLevel ? [] : ["help.hoursLine", ...(data.outlook ? ["help.hoursAhead"] : []), "help.hoursFloor"]), "help.hoursPick"],
      daily: ["help.monthBars", ...(coming?.end != null ? ["help.monthEnd"] : []), "help.dayLine", ...(coming?.days.length ? ["help.monthAhead"] : []), "help.dayToday", "help.dayPick"],
    } };
}
function energyPage(v, lines, format, clock) {
  return `
    <h1 class="title">${lines.tabs.energy}</h1>
    ${todayCard(v.share, lines, format)}${v.hoursToday ? hoursTodayCard(v.hoursToday, lines, format, clock) : ""}${productionCard(v.production, lines, format)}`;
}

// ---- Power origin ----
// The ring of where the power came from, and what the sun made and sent under it. An outlook (a forecast with
// house use, no battery of unknown size) adds two small rings: the same split in an hour and at the end of the
// day. { none } without numbers on record today.
function shareView(data, now) {
  if (data.today.none) return { none: true };
  const ahead = ringsAhead(data);
  return shareOf(ahead ? onBalance(data) : data, ahead, now);
}
function todayCard(v, lines, format) {
  // No numbers on record today (the inverter or the connection down): only that, no zeros. Nothing used yet: no
  // ring, so no "?" either.
  if (v.none) return `<section class="card today share">
      <h2>${lines.energy.powerOrigin}</h2>
      <p>${cap(lines.shared.noData)}</p>
    </section>`;
  return `<section class="card today share">
      <h2>${lines.energy.powerOrigin}</h2>${v.noUse ? "" : helpButton(lines, "share")}
      ${shareRingHtml(v, lines, format)}
    </section>`;
}

// Where use came from, by part: straight from the sun, the battery, the grid (kWh, null when unknown), and
// each part's share of the ring. `d` holds loadKwh, batteryKwh and gridImportKwh.
function splitOf(d, battery) {
  const fromGrid = Number.isFinite(d.gridImportKwh) ? Math.max(0, d.gridImportKwh) : null;
  const fromBattery = battery ? (Number.isFinite(d.batteryKwh) ? Math.max(0, d.batteryKwh) : null) : 0;
  const sun = [d.loadKwh, fromBattery, fromGrid].every(Number.isFinite) ? Math.max(0, d.loadKwh - fromBattery - fromGrid) : null;
  const parts = [
    { key: "sun", color: "--sun", kwh: sun },
    ...(battery ? [{ key: "battery", color: "--battery", kwh: fromBattery }] : []),
    { key: "grid", color: "--grid", kwh: fromGrid },
  ];
  const complete = parts.every((p) => Number.isFinite(p.kwh));
  const used = complete ? parts.reduce((sum, p) => sum + p.kwh, 0) : 0;
  // A part that reads 0 kWh has no place on the ring (6 - 5.6 - 0.4 is not exactly 0).
  parts.forEach((p) => { p.frac = used > 0 && p.kwh >= NOTHING_KWH ? p.kwh / used : 0; });
  return { parts, complete, sun, fromBattery, fromGrid };
}
const sided = (parts) => parts.forEach((p, i) => { p.side = i === 0 ? "left" : i === parts.length - 1 ? "right" : "top"; });

// Today so far plus the outlook's mid run up to `until`, an hour part way through by its share. The first
// entry of hoursAhead starts at now, and it holds today's hours only.
function shareBy(d, hoursAhead, now, until) {
  const x = { loadKwh: d.loadKwh, batteryKwh: d.batteryKwh, gridImportKwh: d.gridImportKwh };
  for (const { t, battery, grid, use } of hoursAhead) {
    const from = Math.max(t, now), part = clamp01((until - from) / (t + HOUR - from));
    x.loadKwh += use * part; x.batteryKwh += battery * part; x.gridImportKwh += grid * part;
  }
  return x;
}
// The same split in an hour (`by`) and at the end of the day, as the forecast expects, in the big ring's order
// (`order`, part keys). Less than an hour left today: the end of the day alone. A ring whose split is not known
// is left out.
function aheadOf(data, now, order) {
  const rows = data.outlook.hoursAhead, end = rows.at(-1).t + HOUR;
  const ring = (until, by) => {
    const x = shareBy(data.today, rows, now, until), s = splitOf(x, data.battery), share = ownShare(x);
    if (!s.complete || share === null) return null;
    const parts = order.map((k) => s.parts.find((p) => p.key === k));
    sided(parts);
    return { by, until, share, parts, loadKwh: x.loadKwh, gridImportKwh: x.gridImportKwh };
  };
  return [now + HOUR < end ? ring(now + HOUR, true) : null, ring(end, false)].filter(Boolean);
}
// Where today's use came from, round a ring: straight from the sun, then the battery, then the grid, each
// named beside its part; the home made share in the middle, and under it each part's figure (plus what was
// sent, when something was). A part unknown leaves a plain ring (its figures as dashes), the share still in
// the middle when use and the grid are known. { noUse } before the house has used anything today.
function shareOf(data, ahead, now) {
  const d = data.today, share = ownShare(d);
  if (Number.isFinite(d.loadKwh) && d.loadKwh < MIN_USE_KWH) return { none: false, noUse: true };
  const { parts, complete, sun, fromBattery, fromGrid } = splitOf(d, data.battery);
  // The largest part goes in the middle, its label on top: the other two then share the ring's ends, the
  // top lead stays well clear of the side labels and none crosses another. Smaller in the middle, a tiny
  // first part (no sun on a winter morning) would bring the top lead down onto the left label.
  if (parts.length === 3) {
    const most = parts.reduce((m, p, i) => (p.frac > parts[m].frac ? i : m), 0);
    parts.splice(1, 0, ...parts.splice(most, 1));
  }
  sided(parts);
  return { none: false, noUse: false, share, loadKwh: d.loadKwh, gridImportKwh: d.gridImportKwh, parts, complete, sun, fromBattery, fromGrid,
    battery: !!data.battery, sent: data.sends && (d.gridExportKwh == null || d.gridExportKwh >= SENT_KWH), sentKwh: d.gridExportKwh,
    ahead: ahead && complete ? aheadOf(data, now, parts.map((p) => p.key)) : [] };
}
function shareRingHtml(v, lines, format) {
  if (v.noUse) return `<p>${lines.now.noUseToday}</p>`;
  const { share, parts, complete } = v;
  const label = share === null ? cap(lines.shared.noData) : say(lines.energy.hintShare, { percent: format.num(percent(share)), homeMade: format.kwh(selfKwh(v)), totalUsed: format.kwh(v.loadKwh) });
  const names = { sun: lines.shared.sun, battery: lines.shared.battery, grid: lines.shared.fromGrid };
  const smallOne = (r) => {
    const when = r.by ? format.time(new Date(r.until)) : lines.energy.endOfDay;
    const text = say(r.by ? lines.energy.hintShareBy : lines.energy.hintShareEnd, { time: when, percent: format.num(percent(r.share)), homeMade: format.kwh(selfKwh(r)), totalUsed: format.kwh(r.loadKwh) });
    return `<li><div class="ring-box">${splitRing(r.parts, text, "")}<div class="ring-mid" aria-hidden="true">${big(percent(r.share))}</div></div><span>${when} · ${format.kwh(r.loadKwh)}</span></li>`;
  };
  const small = v.ahead.length ? `<ul class="rings-ahead">${v.ahead.map(smallOne).join("")}</ul>` : "";
  const ring = `<div class="ring-box">
        ${complete ? splitRing(parts, label, format.kwh(v.loadKwh))
          : `<svg class="ring" viewBox="0 0 200 176" ${hint(label)}><path class="track" d="${TRACK}"/>${ringSize(format.kwh(v.loadKwh))}</svg>`}
        <div class="ring-mid" aria-hidden="true">${share === null ? '<span class="big">—</span>' : big(percent(share))}</div>
        ${complete ? parts.map((p) => `<span class="part ${p.side}">${names[p.key]}</span>`).join("") : ""}
      </div>`;
  const said = `<p>${share === null ? lines.energy.shareIncomplete : lines.energy.shareToday}</p>`;
  return `${small ? `<div class="rings"><div>${ring}${said}</div>${small}</div>` : ring + said}
      ${readout(lines.shared.todaySoFar, [
        [lines.shared.sun, format.kwh(v.sun), "--sun"],
        v.battery ? [lines.shared.battery, format.kwh(v.fromBattery), "--battery"] : null,
        [lines.shared.fromGrid, format.kwh(v.fromGrid), "--grid"],
        v.sent ? [lines.shared.sentToGrid, format.kwh(v.sentKwh), "--sent"] : null,
      ])}`;
}
// The ring from { today, battery, sends } in one step, without the small rings, for the preview and tests.
const shareRing = (data, lines, format) => shareRingHtml(shareOf(data, false, 0), lines, format);

// ---- Today by hour ----
// Today hour by hour, midnight to midnight, on two charts with one timeline (see lineGrid), each under its
// title and unit. Above, with a battery and a charge reading, its mean charge in percent (solid, broken where
// an hour has no row), where the mid run takes it until midnight (dashes), and the floor (red dashes). Below,
// a line each for what the sun made, what the house used and what the grid gave, a point an hour; solid for
// the hours done, dashed from there on, this hour with it, as the outlook's mid run expects them. What is
// still to come is shaded. One hour is picked (this one at first, see dayLine), a dot on each line, its
// figures under the charts. Nothing is drawn for an hour without a row; its sentence says so. null in the
// first hour of a day with no row yet.
const SERIES = [["sun", "--sun"], ["use", "--home"], ["grid", "--grid"]]; // a row's or an outlook hour's field, its colour
function hoursTodayView(data, now, clock, pick) {
  // With an outlook the house's use is the balance, so far as ahead (see onBalance).
  const hasOutlook = ringsAhead(data), b = data.battery, n = data.now;
  const rows = (data.todayByHour ?? []).map((r) => ({ ...r, use: hasOutlook && "balance" in r ? r.balance : r.house }));
  // Now to the 5 minutes, so the page is not redrawn every few seconds for a line that barely moves.
  const H = HOUR, at5 = Math.floor(now / FIVE_MIN) * FIVE_MIN;
  // The day's real hours, midnight to midnight.
  const hours = dayHours(at5, clock), day0 = hours[0], N = hours.length;
  if (!rows.length && at5 - day0 < H) return null;
  const chargeLevel = !!b && n.chargeLevel !== null;
  // Runs of charge points no more than an hour and a half apart: a missing hour breaks the line.
  const points = chargeLevel ? [...rows.filter((r) => r.chargeLevel !== null).map((r) => [r.t + H / 2, r.chargeLevel]), [at5, n.chargeLevel]] : [];
  const runs = points.reduce((out, pt, i) => { if (!i || pt[0] - points[i - 1][0] > 1.5 * H) out.push([]); out.at(-1).push(pt); return out; }, []);
  // The outlook's runs start from the floor at the lowest: a reading under it moves them by as much, as on the ring.
  const shift = chargeLevel ? chargeShift(n.chargeLevel, b.floor) : 0;
  const ahead = chargeLevel ? (data.outlook?.chargeAhead ?? []).map(([timestamp, p]) => [timestamp, p + shift]) : [];
  const was = new Map(rows.map((r) => [r.t, r])), will = new Map(ahead.map(([timestamp, p]) => [timestamp - H, p]));
  // Weather alone (no outlook): the sensor's sun for the hours ahead, this one's rest by its share; no use or grid.
  const sunOnly = weatherOnly(data) ? data.ahead.hours.map((h) => ({ t: h.t, sun: h.sun[1] * clamp01((h.t + H - at5) / H), battery: null, grid: null, use: null })) : [];
  const expect = new Map((data.outlook?.hoursAhead ?? sunOnly).map((e) => [e.t, e]));
  return {
    now: at5, hours, day0, chargeLevel, floor: b?.floor, nowChargeLevel: n.chargeLevel, runs, ahead, hasRows: rows.length > 0,
    at: pick?.hoursToday >= 0 && pick.hoursToday < N ? pick.hoursToday : hours.indexOf(hourStart(at5, clock)),
    // Each hour: its row (null when none), the outlook's hour and its charge at the hour's end (undefined when
    // none), and its [made, used, grid] in kWh (`kwh`, null where there is neither): an hour done from its row,
    // this one its row so far plus the outlook's rest, the next ones the outlook's; `est` when the outlook's.
    // A series the outlook leaves out (null: use and grid beside weather alone) keeps only its row.
    hour: hours.map((timestamp) => {
      const r = was.get(timestamp) ?? null, e = expect.get(timestamp) ?? null, open = timestamp + H > at5 ? e : null;
      return { t: timestamp, row: r, expect: e, will: will.get(timestamp),
        kwh: r || open ? { est: !!open, v: SERIES.map(([k]) => (r || open[k] != null ? sumKnown([r ? r[k] : 0, open?.[k] ?? 0]) : null)) } : null };
    }),
  };
}
function hoursTodayCard(v, lines, format, clock) {
  const H = HOUR, { now, hours, day0, chargeLevel, hour } = v, N = hours.length;
  const x = (timestamp) => clamp01((timestamp - day0) / (N * H)) * 100, y = (p) => (100 - Math.min(100, Math.max(0, p))).toFixed(2);
  const path = (points) => points.map(([timestamp, p], i) => `${i ? "L" : "M"}${x(timestamp).toFixed(2)} ${y(p)}`).join("");
  const hourly = hour.map((h) => h.kwh);
  const kwh = lineGrid(Math.max(...hourly.map((h) => (h ? Math.max(...h.v) : 0)), 0.1), format.num);
  // Across its hour (0 to 1): the middle, but the hour in progress at now, on the now line as the charge
  // line's dot.
  const across = (i) => (inHour(hours[i], now) ? (now - hours[i]) / H : 0.5);
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
    const val = y(h.v[k] / kwh.max * 100), whole = across(i) === 0.5;
    return `${known(hourly[i - 1], k) && (dashed ? true : !hourly[i - 1].est) ? "L" : !i && whole ? `M0 ${val}L` : "M"}${cx(i).toFixed(2)} ${val}${i === N - 1 && whole ? `L100 ${val}` : ""}`;
  }).join("").replace(/^L/, "M");
  const series = SERIES.map(([, color], k) => `<path class="series" style="--c:${markOf(color)}" d="${lineOf(k, false)}"/><path class="series later" style="--c:${markOf(color)}" d="${lineOf(k, true)}"/>`).join("");
  // Where the picked hour's dot sits on the charge line: the hour's mean in its middle, this hour's reading
  // now, an hour ahead's end at its end. [across the hour 0 to 1, %], or null.
  const chargeDot = (h) => {
    if (!chargeLevel) return null;
    if (inHour(h.t, now)) return [(now - h.t) / H, v.nowChargeLevel];
    return h.row?.chargeLevel != null ? [0.5, h.row.chargeLevel] : h.will !== undefined ? [1, h.will] : null;
  };
  // The hour the clocks go back reads the same twice: both then name their offset.
  const labels = hours.map((timestamp) => format.time(new Date(timestamp)));
  const said = hour.map(({ t: timestamp, row: r, expect: e, will: p }, i) => {
    const h = labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i]) ? format.zoned(new Date(timestamp)) : labels[i];
    // One sentence an hour: the energy, then the battery's charge (its mean for an hour done, what the outlook
    // expects at the end of one ahead), either alone where the other is missing. The grid's 0 is "nothing".
    const one = (energy, battery, batteryOnly, val, chargePercent) => {
      const g = { hour: h, solar: val && format.kwh(val[0]), use: val && format.kwh(val[1]), grid: val && (Number.isFinite(val[2]) && val[2] < NOTHING_KWH ? lines.shared.nothing : format.kwh(val[2])), percent: chargePercent };
      return val ? say(chargePercent == null ? energy : battery, g) + "." : chargePercent == null ? "" : say(batteryOnly, g) + ".";
    };
    const chargePercent = chargeLevel && r?.chargeLevel != null ? Math.round(r.chargeLevel) : null;
    const past = one(lines.energy.hintHourPast, lines.energy.hintHourPastBattery, lines.energy.hintBatteryPast, r && [r.sun, r.use, r.grid], chargePercent);
    const coming = e && e.use == null ? (Number.isFinite(e.sun) ? `${say(lines.energy.hintHourAheadSun, { hour: h, solar: format.kwh(e.sun) })}.` : "")
      : one(lines.energy.hintHourAhead, lines.energy.hintHourAheadBattery, lines.energy.hintBatteryAhead, e && [e.sun, e.use, e.grid], p === undefined ? null : Math.round(p));
    // An hour on record also as figures under the charts (an unknown one as a dash), this one's marked "so
    // far"; one ahead keeps its sentence.
    const figures = r && [
      [lines.shared.sun, format.kwh(r.sun), "--sun"],
      [lines.shared.homeUse, format.kwh(r.use), "--home"],
      [lines.shared.fromGrid, format.kwh(r.grid), "--grid"],
      chargePercent == null ? null : [lines.shared.batteryAverage, `${format.num(chargePercent)}%`, "--battery"],
    ].filter(Boolean);
    // No row 10 minutes into an hour (5 minute rows come every 5): nothing on record for it.
    return [h, past || (timestamp + 10 * MINUTE < now ? `${h}: ${lines.shared.noData}` : coming),
      figures?.length ? readout(inHour(timestamp, now) ? `${h} · ${lines.shared.soFar}` : h, figures) : ""];
  });
  // The same hours over each chart, each with the hour's sentence as its hint: hovering either shows the
  // hour on both, a tap picks it on both (see _wireWeek). Only the top chart's row takes focus. A pick kept
  // from a longer day falls back to this hour.
  const at = v.at;
  const dot = (color, val, over = 0.5) => `<i style="--c:${markOf(color)};--v:${Math.min(100, Math.max(0, val)).toFixed(1)}%;--x:${over.toFixed(2)}"></i>`;
  const cells = (named, dots) => said.map(([, name], i) => `<li${name ? (named ? ` ${hint(name, "")}` : ` data-hint="${name}"`) : ""} data-i="${i}"${name ? "" : ' class="future"'}${i === at ? ' aria-current="true"' : ""}>${dots(i)}</li>`).join("");
  // What is still to come shaded, now a line across both charts, named once over the top one (kept inside the card near midnight).
  const xNow = x(now), nx = xNow.toFixed(2);
  const later = `<rect class="later" x="${nx}" y="0" width="${(100 - xNow).toFixed(2)}" height="100"/><line class="now-line" x1="${nx}" x2="${nx}" y1="0" y2="100"/>`;
  const label = nowLabel(xNow, lines.shared.nowMark);
  const charge = lineGrid(100, (p) => `${p}%`);
  const legend = legendHtml([{ label: lines.shared.sun, color: "--sun" }, { label: lines.shared.homeUse, color: "--home" }, { label: lines.shared.fromGrid, color: "--grid" }]);
  const title = (name, unit) => `<h3 class="chart-title"><span>${name}</span> <span class="num">${unit}</span></h3>`;
  return `<section class="card hoursToday" data-pick="hoursToday">
      <h2>${lines.energy.hoursToday}</h2>${helpButton(lines, "hoursToday")}
      ${chargeLevel ? `${title(lines.energy.batteryChargeTitle, "%")}<div class="plot charge">${label}
        <svg class="chargeLine" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${later}${charge.lines}<line class="floor" x1="0" x2="100" y1="${y(v.floor)}" y2="${y(v.floor)}"/>
          ${v.runs.map((run) => `<path class="past" d="${path(run)}"/>`).join("")}
          ${v.ahead.length ? `<path class="ahead" d="${path([[now, v.nowChargeLevel], ...v.ahead])}"/>` : ""}
          <line class="axis" x1="0" x2="100" y1="100" y2="100"/>
        </svg>${charge.ticks}<span class="floor-label" style="bottom:${v.floor}%">${say(lines.energy.batteryFloor, { percent: v.floor })}</span>
        <ol class="hours24" style="--n:${N}">${cells(true, (i) => { const d = chargeDot(hour[i]); return d ? dot("--battery", d[1], d[0]) : ""; })}</ol>
      </div>` : ""}
      ${title(lines.energy.energyFlowTitle, "kWh")}<div class="plot">${chargeLevel ? "" : label}
        <svg class="chargeLine" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${later}${kwh.lines}<line class="axis" x1="0" x2="100" y1="100" y2="100"/>${series}
        </svg>${kwh.ticks}
        <ol class="hours24" style="--n:${N}"${chargeLevel ? ' aria-hidden="true"' : ""}>${cells(!chargeLevel, (i) => SERIES.map(([, color], k) => (known(hourly[i], k) ? dot(color, hourly[i].v[k] / kwh.max * 100, across(i)) : "")).join(""))}</ol>
      </div>
      <div class="ticks">${[0, 8, 16].map((h) => hours.findIndex((timestamp) => clock(timestamp).hour === h)).filter((i) => i >= 0).map((i) => `<span style="left:${(i / N) * 100}%">${format.hour(new Date(hours[i]))}</span>`).join("")}<span style="right:0">${format.time(new Date(day0 + N * H - MINUTE))}</span></div>
      ${legend}
      ${v.hasRows ? "" : `<p class="note">${cap(lines.shared.noData)}</p>`}
      <div class="stepped">${steps(lines, "Hour", at, said.findLastIndex(([, name]) => name))}<div class="picked" aria-live="polite" aria-atomic="true">${said.map(([h, name, figures], i) => `<div class="day" data-i="${i}"${i === at ? "" : " hidden"}>${figures || (name && name.replace(h, `<b>${h}</b>`))}</div>`).join("")}</div></div>
    </section>`;
}

// ---- Production ----
// This month's days still to come and where the month should end. From the page's own forecast: tomorrow
// from the forecast's days, later days from the Energy settings' solar forecast as far as it reaches, then
// the usual day's sun; before a usual day is on record, the solar forecast's days alone, and no end. From a fresh sensor: its days' likely sun as far as they reach; the days stop there, and
// the month's end shows only once they reach it. { days: [{ date, kwh, usual }], end } (end null while a day of the month has no numbers on
// record), or null without a forecast or a day to come.
/** @param {import("../lib/data.js").Data} data */
function monthAhead(data) {
  const a = data.ahead, list = data.monthDays, sensor = fromSensor(data.mode);
  if (!list?.length || !(a || data.mode?.level === "usual_days_weather")) return null;
  const keys = monthDayKeys(data.monthKey), n = keys.length;
  const all = keys.slice(list.length).map((key) => {
    const date = noonOf(key);
    // Tomorrow's forecast is the solar forecast where it has hours, else the usual day (see forecastOf).
    const dayKwh = a?.days.find((d) => d.d === key)?.sun?.[1] ?? (sensor ? null : data.sunDays?.[key]);
    if (!sensor) { const kwh = dayKwh ?? data.usualSunDays?.[key] ?? data.usualSun; return Number.isFinite(kwh) ? { date, kwh, usual: !(key in (data.sunDays ?? {})) } : null; }
    return Number.isFinite(dayKwh) ? { date, kwh: dayKwh, usual: false } : null;
  });
  const cut = all.indexOf(null), days = cut < 0 ? all : all.slice(0, cut);
  if (sensor && !days.length && list.length < n) return null;
  const soFar = sumKnown(list.map((d) => (d.none ? null : d.solarKwh))), rest = a?.left?.sun?.[1];
  return { days, end: soFar === null || cut >= 0 || !Number.isFinite(rest) ? null : soFar + rest + days.reduce((s, d) => s + d.kwh, 0) };
}
// What the sun made each of the 12 months (`totals`: the days on record, null with none) and how many of its days
// are not on record (`missing`, the month then marked as partial), the picked month (this one at first) with its
// days, and this month's days to come and end (see monthAhead).
function productionView(data, pick, coming) {
  const currentMonth = data.monthKey, at = yearKeys(currentMonth).includes(pick?.dailyMonth) ? pick.dailyMonth : currentMonth;
  const daysOf = (k) => (k === currentMonth ? data.monthDays : data.pastDays?.[k]) ?? [];
  // A remembered month is one entry of its known days' sum and its missing count (see slim).
  const total = (k) => { const s = daysOf(k).map((d) => (d.none ? null : d.solarKwh)).filter(Number.isFinite); return s.length ? s.reduce((a, x) => a + x, 0) : null; };
  const missing = (k) => daysOf(k).reduce((n, d) => n + (d.none ? 1 : 0) + (d.missing ?? 0), 0);
  return { cur: currentMonth, at, totals: Object.fromEntries(yearKeys(currentMonth).map((k) => [k, total(k)])), missing: Object.fromEntries(yearKeys(currentMonth).map((k) => [k, missing(k)])), days: daysOf(at),
    end: coming?.end ?? null, ahead: at === currentMonth && coming ? coming.days : [], pick: pick?.daily };
}
// Production: the 12 months as bars (see monthPicker), the picked month's total under them, then its days (see
// dayLine). This month's days to come are dashed on, and its bar and total say where it should end.
function productionCard(v, lines, format) {
  const { cur: currentMonth, at, end } = v, named = (k) => monthName(k, currentMonth, lines, format);
  const kwh = (n) => format.kwh(n >= 10 ? Math.round(n) : n);
  // Each day's sentence as its hint, and with its date in bold under the chart.
  const ahead = v.ahead.map((d) => {
    const date = format.date(new Date(d.date)), said = d.usual ? lines.energy.hintDayUsual : lines.energy.hintDayForecast;
    const plain = cap(say(said, { date, energy: format.kwh(d.kwh) }));
    return [d.kwh, plain, boldDate(plain, said, date)];
  });
  // A month with days not on record says so: its total is only theirs.
  const partial = (k) => (v.missing[k] && v.totals[k] !== null ? ` · ${say(lines.energy.daysMissing, { days: v.missing[k] })}` : "");
  const hintOf = (k, n) => (n === null ? `${named(k)}: ${lines.shared.noData}` : k === currentMonth && end !== null ? say(lines.energy.hintMonthEnd, { month: named(k), energy: kwh(n), endEnergy: kwh(end) }) : `${named(k)}: ${kwh(n)}${partial(k)}`);
  return `<section class="card daily" data-pick="daily">
      <h2><span>${lines.energy.production}</span> <span class="num">kWh</span></h2>${helpButton(lines, "daily")}
      <h3 class="chart-title">${lines.energy.monthlyProduction}</h3>
      ${monthPicker(lines, format, currentMonth, at, (k) => v.totals[k], hintOf, "--sun", false, (k) => (k === currentMonth ? end : null))}
      <div class="stepped total">${monthSteps(lines, currentMonth, at, (k) => cap(named(k)))}${monthTotal(cap(named(at)) + partial(at), [[lines.energy.monthlyProduction, kwh(v.totals[at]), "--sun"],
        at === currentMonth && end !== null ? [lines.energy.monthEndEstimate, say(lines.energy.monthEndAbout, { energy: kwh(end) }), "--sun", false, true] : null])}</div>
      <h3 class="chart-title"><span>${lines.energy.dailyProduction}</span> <span class="num">${cap(format.monthYear(at))}</span></h3>
      ${dayLine(lines, format, at, v.days, (d) => (d.none ? null : d.solarKwh),
        (d, n) => (n === null ? `${format.date(new Date(d.date))}: ${lines.shared.noData}` : say(lines.energy.hintDayProduction, { date: format.date(new Date(d.date)), energy: format.kwh(n) })), (d, n, lead) => picked(lines, format, d, lead), v.pick, { live: at === currentMonth, ahead })}
    </section>`;
}
// A picked day's figures, `lead` over them (see dayLine): what the sun made, the house used and the grid
// gave, how much was home made, and what was sent when there was any (or when that is unknown). Without
// numbers on record, only that; an unknown figure as a dash.
function picked(lines, format, x, lead) {
  if (x.none) return readout(lead, [[lines.shared.noData, "—"]]);
  const share = ownShare(x);
  return readout(lead, [
    [lines.shared.sun, format.kwh(x.solarKwh), "--sun"],
    [lines.shared.homeUse, format.kwh(x.loadKwh), "--home"],
    [lines.shared.fromGrid, format.kwh(x.gridImportKwh), "--grid"],
    [lines.shared.selfSupplied, share === null ? "—" : `${format.num(percent(share))}%`, "--battery"],
    x.gridExportKwh == null || x.gridExportKwh >= SENT_KWH ? [lines.shared.sentToGrid, format.kwh(x.gridExportKwh), "--sent"] : null,
  ]);
}

export { energyView, energyPage, shareRing, hoursTodayView, hoursTodayCard, monthAhead, ownShare };
