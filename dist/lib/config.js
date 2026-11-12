/* The panel's `config:` (its panel_custom entry in configuration.yaml) and the Energy settings: which entities to
   read and the owner's settings, checked (readConfig). */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale core.js
/** @type {typeof import("./core.js")} */
const { num, warnOnce } = await import(`./core.js${v}`);

const BATTERY_FLOOR_SOC = 20; // percent where the inverter stops discharging, unless config says battery_floor
const USUAL_DAYS = 14;    // the usual day (Energy's dashed lines) averages each hour over these many days, unless config says usual_days
const USUAL_MIN = 3;      // until every hour of the day has this many days behind it there is no usual day (no dashed lines, no forecast built here)
// usual_days at most: each day is 24 hour rows per energy sensor asked once a day, and past two months the
// season has moved too far for one hour of the day to stand for today.
const USUAL_MAX = 60;
const QUIET_HOURS = "0-7";  // no machine start is suggested in these hours, unless config says quiet_hours
const BATTERY_MARGIN = 10;  // a suggested start keeps the battery this many points above the floor, unless config says battery_margin

// config name: [name in here, source type and key in the Energy settings]. Power in W or kW,
// energy in any unit the statistics know. Battery power is positive when discharging, grid
// power when importing.
const ENTITIES = {
  solar_power: ["solarW", "solar", "stat_rate"],
  battery_power: ["battW", "battery", "stat_rate"],
  grid_power: ["gridW", "grid", "stat_rate"],
  battery_soc: ["soc", "battery", "stat_soc"],
  solar_energy: ["solarKwh", "solar", "stat_energy_from"],
  battery_out_energy: ["batteryKwh", "battery", "stat_energy_from"],
  battery_in_energy: ["chargeKwh", "battery", "stat_energy_to"],
  grid_in_energy: ["gridImportKwh", "grid", "stat_energy_from"],
  grid_out_energy: ["gridExportKwh", "grid", "stat_energy_to"],
  // Not in the Energy settings. Without them house use is what flows in minus what flows out,
  // which counts the inverter's own losses as house use.
  load_power: ["loadW"],
  load_energy: ["loadKwh"],
  // The battery's state of health in %, where the inverter or BMS reports it (see wearOf).
  battery_health: ["healthPct"],
  // Money, in the currency: what the grid cost and paid, as Home Assistant counts it for the Energy page
  // (its own cost sensors when the Energy settings name none, see readConfig).
  grid_cost: ["costMoney", "grid", "stat_cost"],
  grid_compensation: ["earnedMoney", "grid", "stat_compensation"],
};

// "0-7" or "23:30-6:30" as [from, to] in hours; null when it is not that.
const quietHours = (v) => {
  const m = typeof v === "string" && v.trim().match(/^(\d{1,2})(?::(\d\d))?\s*-\s*(\d{1,2})(?::(\d\d))?$/);
  const q = m && [+m[1] + (+m[2] || 0) / 60, +m[3] + (+m[4] || 0) / 60];
  return q && q.every((h) => h <= 24) ? q : null;
};
// A calendar date written YYYY-MM-DD, kept as that text; null for anything else, or a day that does not
// exist (2026-02-30 is not read as 2 March).
function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}
// The machines the page can say when to start, each named by its type's word in the language.
const MACHINE_TYPES = ["washer", "dryer", "dishwasher"];
// The groups a config may put its keys in. Each key keeps its flat name and works in any group, as at the top.
// battery, grid and payback split what plant holds; plant stays.
const CONFIG_GROUPS = ["plant", "battery", "grid", "payback", "predictions", "machines", "prices", "display"];
// Every key readConfig reads. Any other says once that nobody reads it.
const KEYS = ["battery_kwh", "battery_floor", "battery_max_charge_kw", "battery_max_discharge_kw", "battery_install_date", "battery_margin",
  "export_max_kw", "standby_w", "grid_max_kw", "system_cost", "install_date", "saved_before", "level", "usual_days", "quiet_hours",
  ...MACHINE_TYPES, "bill_fixed", "tariff", "time_format", "advice", "advice_replace", "entities"];
const TARIFF_TYPES = ["single", "two", "three"];
// How far the page predicts (docs/audit/06-fix-plan.md, decision 1); no level is auto. What each level uses,
// and the step down when its data is missing: modeOf in data.js.
const LEVELS = ["none", "usual_days", "weather", "usual_days_weather", "learned_weather"];
const LEVEL_ALIASES = { usual: "usual_days_weather" }; // the names before decision 1
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// The config as flat keys. A key given twice says so once: a group's wins over the top level, and the
// later group of CONFIG_GROUPS over an earlier one. `sensors` (a group) and `entities` (flat) merge name by
// name, sensors winning.
const configOf = (c) => {
  const out = {}, from = {}, top = isMap(c) ? c : {};
  const put = (key, value, where) => {
    if (!KEYS.includes(key)) return warnOnce(`${where ? `${where}.` : ""}${key}: no such option, so it is ignored`);
    if (key in from) warnOnce(`${key} is given in ${from[key] || "the top level"} and in ${where}: ${where}'s is used`);
    out[key] = value; from[key] = where;
  };
  for (const [key, value] of Object.entries(top)) if (!CONFIG_GROUPS.includes(key) && key !== "sensors") put(key, value, "");
  for (const g of CONFIG_GROUPS) {
    if (top[g] != null && !isMap(top[g])) warnOnce(`${g}: ${shown(top[g])} is not a group of options, so it is ignored`);
    else for (const [key, value] of Object.entries(top[g] ?? {})) put(key, value, g);
  }
  if (top.sensors != null && !isMap(top.sensors)) warnOnce(`sensors: ${shown(top.sensors)} is not a map of names to entity ids, so it is ignored`);
  else if (top.sensors) {
    const old = isMap(out.entities) ? out.entities : {};
    for (const name of Object.keys(top.sensors)) if (name in old) warnOnce(`${name} is given in entities and in sensors: sensors' is used`);
    out.entities = { ...old, ...top.sensors };
  }
  return out;
};

// Each bad value says so once in the console and keeps its default: never a silent wrong value.
// Absent (or null: an empty YAML entry) is the default without a word.
const shown = (v) => JSON.stringify(v);
const isEntityId = (v) => typeof v === "string" && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
// A number from min to max, or text that is one ("20").
function figure(v, key, min, max, otherwise = null) {
  if (v == null) return otherwise;
  const n = num(v, min, max);
  if (n === null) warnOnce(`${key}: ${shown(v)} is not a number ${max === Infinity ? `of ${min} or more` : `from ${min} to ${max}`}, so ${otherwise == null ? "it is not used" : `${otherwise} is used`}`);
  return n ?? otherwise;
}
function entity(v, key) {
  if (v == null) return null;
  if (!isEntityId(v)) warnOnce(`${key}: ${shown(v)} is not an entity id (such as sensor.price), so it is not used`);
  return isEntityId(v) ? v : null;
}
// A figure typed as a number (or text that is one), else the id of an entity holding it.
function numberOrId(v, key) {
  if (v == null) return null;
  const n = num(v, 0);
  if (n === null && !isEntityId(v)) warnOnce(`${key}: ${shown(v)} is neither a number of 0 or more nor an entity id, so it is not used`);
  return n ?? (isEntityId(v) ? v : null);
}
function date(v, key) {
  if (v == null) return null;
  const d = calendarDate(v);
  if (!d) warnOnce(`${key}: ${shown(v)} is not a real day written YYYY-MM-DD, so it is not used`);
  return d;
}

// The panel's config, read and checked in one place: nothing else reads it. `prefs` is the answer of
// energy/get_prefs (null: not set up, or not asked yet); `costs` (energy/info's cost_sensors) names the cost
// sensor Home Assistant made for each grid statistic with a price, where the settings name no cost statistic.
//   ids: the entity ids to read, as lists (several solar arrays or batteries are summed), from the Energy
//     settings unless the config names them; socWeight; the Energy settings' prices.
//   cfg: the owner's settings, each with its default when absent or bad.
function readConfig(prefs, config, costs = {}) {
  if (config != null && !isMap(config)) warnOnce(`config: ${shown(config)} is not a map of options, so none is used`);
  const c = configOf(config);
  const energySources = prefs?.energy_sources ?? [];
  // Older Home Assistant keeps a grid as lists of flows, newer as one import and export pair.
  // An old export flow names its price like an import one, so it is renamed here.
  const flat = energySources.flatMap((s) => [s, ...["flow_from", "flow_to", "power"].flatMap((k) => (s[k] || []).map((x) => (k === "flow_to"
    ? { type: s.type, stat_energy_to: x.stat_energy_to, stat_compensation: x.stat_compensation, entity_energy_price_export: x.entity_energy_price, number_energy_price_export: x.number_energy_price }
    : { ...x, type: s.type })))])
    .map((s) => ({ ...s, stat_cost: s.stat_cost ?? costs?.[s.stat_energy_from], stat_compensation: s.stat_compensation ?? costs?.[s.stat_energy_to] }));
  if (c.entities != null && !isMap(c.entities)) warnOnce(`sensors: ${shown(c.entities)} is not a map of names to entity ids, so the Energy settings are used`);
  const own = isMap(c.entities) ? c.entities : {};
  const ids = {};
  for (const name of Object.keys(own)) if (!(name in ENTITIES)) warnOnce(`sensors.${name}: no such name (see Names under sensors in docs/setup.md), so it is ignored`);
  for (const [name, [key, type, field]] of Object.entries(ENTITIES)) {
    // One id or a list; [] switches the part off.
    const given = own[name] == null ? null : [].concat(own[name]), kept = given?.filter((id) => typeof id === "string" && id);
    if (given && kept.length < given.length) warnOnce(`sensors.${name}: ${shown(own[name])} holds something that is not an entity id, left out`);
    ids[key] = kept ?? flat.filter((s) => s.type === type && s[field]).map((s) => s[field]);
  }
  const batteries = energySources.filter((s) => s.type === "battery");
  const sized = batteries.length > 0 && batteries.every((b) => b.capacity > 0);
  // State of charge of several batteries: weighted by size when every size is known.
  ids.socWeight = Object.fromEntries(batteries.map((b) => [b.stat_soc, sized ? b.capacity : 1]));
  // The Energy settings' prices: a number, or the id of an entity holding one, so Home Assistant keeps
  // their history in the cost statistics.
  const price = (entityKey, numberKey) => flat.map((s) => s[entityKey] ?? s[numberKey]).find((x) => x != null) ?? null;
  ids.price = { buy: price("entity_energy_price", "number_energy_price"), sell: price("entity_energy_price_export", "number_energy_price_export") };

  // The machines the page says when to start, by type (the language's word names each), in the order
  // written: typed figures, and a sensor whose runs replace them (see machineOf). None: a washer of 1 kWh
  // over 2 hours. A bare type is that run too; `false` leaves the machine out.
  const machines = (MACHINE_TYPES.some((k) => k in c) ? Object.keys(c).filter((k) => MACHINE_TYPES.includes(k)) : ["washer"]).flatMap((type) => {
    const a = c[type] ?? { kwh: 1, hours: 2 };
    if (a === false) return [];
    if (!isMap(a)) { warnOnce(`${type}: ${shown(a)} is not a map (kwh, hours, peak_kw, sensor), so it is left out`); return []; }
    for (const k of Object.keys(a)) if (!["kwh", "hours", "peak_kw", "sensor"].includes(k)) warnOnce(`${type}.${k}: no such option, so it is ignored`);
    // 0 kWh or 0 hours is no run: as if not typed.
    return [{ type, kwh: figure(a.kwh, `${type}.kwh`, 0, Infinity) || null, hours: figure(a.hours, `${type}.hours`, 0, 24) || null,
      peakKw: figure(a.peak_kw, `${type}.peak_kw`, 0, Infinity), sensor: entity(a.sensor, `${type}.sensor`) }];
  });
  // The contract's bands and their prices: each a number or an entity, else learned from `sensor`.
  let tariff = null;
  const tf = c.tariff;
  if (tf != null && !isMap(tf)) warnOnce(`tariff: ${shown(tf)} is not a map (type, prices, sensor), so there are no bands`);
  else if (tf != null && !TARIFF_TYPES.includes(tf.type)) warnOnce(`tariff.type: ${shown(tf.type)} is not one of ${TARIFF_TYPES.join(", ")}, so there are no bands`);
  else if (tf != null) {
    for (const k of Object.keys(tf)) if (!["type", "prices", "sensor"].includes(k)) warnOnce(`tariff.${k}: no such option, so it is ignored`);
    for (const b of Object.keys(isMap(tf.prices) ? tf.prices : {})) if (!["f1", "f2", "f3", "f23"].includes(b)) warnOnce(`tariff.prices.${b}: no such band (f1, f2, f3, f23), so it is ignored`);
    if (tf.prices != null && !isMap(tf.prices)) warnOnce(`tariff.prices: ${shown(tf.prices)} is not a map of bands (f1, f2, f3, f23) to prices`);
    const prices = Object.entries(isMap(tf.prices) ? tf.prices : {}).map(([b, p]) => [b, numberOrId(p, `tariff.prices.${b}`)]).filter(([, p]) => p != null);
    tariff = { type: tf.type, sensor: entity(tf.sensor, "tariff.sensor"), prices: Object.fromEntries(prices) };
  }
  const quiet = quietHours(c.quiet_hours);
  if (c.quiet_hours != null && !quiet) warnOnce(`quiet_hours: ${shown(c.quiet_hours)} is not hours such as "0-7" or "23:30-6:30", so "${QUIET_HOURS}" is used`);
  // Fewer than USUAL_MIN days could never make a usual day.
  let usualDays = Math.round(figure(c.usual_days, "usual_days", 0, Infinity, USUAL_DAYS));
  if (usualDays < USUAL_MIN) { warnOnce(`usual_days: ${shown(c.usual_days)} is under ${USUAL_MIN}, so ${USUAL_MIN} is used`); usualDays = USUAL_MIN; }
  if (usualDays > USUAL_MAX) { warnOnce(`usual_days: ${shown(c.usual_days)} is over ${USUAL_MAX}, so ${USUAL_MAX} is used`); usualDays = USUAL_MAX; }
  // Payback: what the system cost (0 or none: no payback card), the day it started (none: the first month
  // on record), and what it saved before Home Assistant recorded.
  const cost = figure(c.system_cost, "system_cost", 0, Infinity), installed = date(c.install_date, "install_date");
  const level = c.level == null ? null : LEVELS.includes(c.level) ? c.level : LEVEL_ALIASES[c.level] ?? null;
  if (c.level != null && !level) warnOnce(`level: ${shown(c.level)} is not one of ${LEVELS.join(", ")}, so the level is automatic`);
  // The clock: 12 or 24 hours for every viewer, or "system" or "language" as in the profile (see hourCycle).
  const timeFormat = c.time_format == null ? null : ["12", "24", "system", "language"].find((f) => f === String(c.time_format)) ?? null;
  if (c.time_format != null && !timeFormat) warnOnce(`time_format: ${shown(c.time_format)} is not 12 or 24, so each viewer's profile decides`);
  if (c.advice != null && !isMap(c.advice)) warnOnce(`advice: ${shown(c.advice)} is not a map of languages to pools of lines, so it is not used`);
  if (c.advice_replace != null && typeof c.advice_replace !== "boolean") warnOnce(`advice_replace: ${shown(c.advice_replace)} is not true or false, so false is used`);
  const cfg = {
    batt: {
      kwh: figure(c.battery_kwh, "battery_kwh", 0.1, Infinity) ?? (sized ? batteries.reduce((sum, b) => sum + b.capacity, 0) : null),
      floor: figure(c.battery_floor, "battery_floor", 0, 100, BATTERY_FLOOR_SOC), // %
      maxChargeKw: figure(c.battery_max_charge_kw, "battery_max_charge_kw", 0, Infinity), // null: no limit
      maxDischargeKw: figure(c.battery_max_discharge_kw, "battery_max_discharge_kw", 0, Infinity), // null: no limit
      // For the wear warning: the day this battery went in (a replaced one has its own).
      since: date(c.battery_install_date, "battery_install_date") ?? installed,
    },
    // For the forecast: null is no export limit (0 on zero-export inverters); the inverter's own use
    // in W, null when not set (then worked out in totals).
    exportMaxKw: figure(c.export_max_kw, "export_max_kw", 0, Infinity),
    standbyW: figure(c.standby_w, "standby_w", 0, Infinity),
    level,
    machines,
    quiet: quiet ?? quietHours(QUIET_HOURS),
    gridMaxKw: figure(c.grid_max_kw, "grid_max_kw", 0, Infinity),
    marginPct: figure(c.battery_margin, "battery_margin", 0, 100, BATTERY_MARGIN), // %
    tariff,
    usualDays,
    payback: cost > 0 ? { cost, since: installed, before: figure(c.saved_before, "saved_before", 0, Infinity, 0) } : null,
    // The bill's fixed part, a month (a meter fee, say): added to every month's cost on Money. The id of an
    // entity holding it, so each month keeps what it was then (see fixedAt); a number counts for every month.
    billFixed: numberOrId(c.bill_fixed, "bill_fixed") ?? 0,
    // The owner's own advice lines ({ it: { go: [...] } }), and whether a pool with own lines shows only those.
    advice: isMap(c.advice) ? c.advice : null,
    adviceReplace: c.advice_replace === true,
    timeFormat,
  };
  return { ids, cfg };
}
/** @typedef {ReturnType<typeof readConfig>["cfg"]} Config the owner's settings, each with its default */
// The live sensors the Now page cannot do without, one list per kind (solar, battery and grid power, charge).
// A kind is silent only when all of its sensors are: a second inverter asleep at night is not.
const requiredIds = (ids) => [ids.solarW, ids.battW, ids.gridW, ids.soc].filter((kind) => kind.length);
// Read while they have a value, else left out: the load sensor (house use is then the balance).
const optionalIds = (ids) => ids.loadW;

export { BATTERY_FLOOR_SOC, USUAL_MIN, USUAL_MAX, readConfig, requiredIds, optionalIds, quietHours, calendarDate, configOf }; // the last three: for the tests
