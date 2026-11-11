/* Shared by every part of the solar page: time, numbers and text. No imports, so any file (and the tests in
   test/) can load it first. */

// Time in ms.
export const MINUTE = 6e4;
export const FIVE_MIN = 5 * MINUTE;
export const HALF_HOUR = 30 * MINUTE;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const NOON = 12 * HOUR; // a day key's noon UTC is Date.parse(key) + NOON

// Rules both the page and the forecast part keep.
export const FULL_SOC = 97;    // from here up the battery is full: with export capped, spare sun is held back
export const LASTS_MAX_H = 18; // past this many hours "enough until" says nothing

// Days are counted in Home Assistant's time zone, not the browser's. clockOf(tz)(ms) gives the
// calendar day there as "2026-10-02", plus hour and minute.
// One clock per zone, and each keeps what it gave: a load asks the same hours thousands of times, and
// formatToParts costs about 4 µs a call. Cleared past CLOCK_KEEP times, so it never grows for ever.
const CLOCK_KEEP = 5000;
const clocks = new Map();
export function clockOf(tz) {
  if (clocks.has(tz)) return clocks.get(tz);
  const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let f;
  try { f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }); } catch (e) { f = new Intl.DateTimeFormat("en-CA", opts); }
  const seen = new Map();
  const clock = (ms) => {
    let c = seen.get(ms);
    if (!c) {
      const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
      c = { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
      if (seen.size >= CLOCK_KEEP) seen.clear();
      seen.set(ms, c);
    }
    return c;
  };
  clocks.set(tz, clock);
  return clock;
}
// Start of the hour holding ms, from the clock's minute: right in half hour time zones too.
export const hourStart = (ms, clock) => ms - clock(ms).minute * MINUTE - (ms % MINUTE);
// The hour starts of the day holding ms, midnight to midnight by the clock: 23 the day the clocks go forward,
// 25 the day they go back.
export function dayHours(ms, clock) {
  const key = clock(ms).key, hours = [];
  let t = hourStart(ms, clock);
  while (clock(t - HOUR).key === key) t -= HOUR;
  for (; clock(t).key === key; t += HOUR) hours.push(t);
  return hours;
}
// A day key moved by whole days. Plain calendar arithmetic, so daylight saving cannot bend it.
export const shiftKey = (key, days) => new Date(Date.parse(key) + days * DAY).toISOString().slice(0, 10);
// A month key ("2026-10") moved by whole months.
export const shiftMonth = (key, n) => { const [y, m] = key.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
// Days in month "YYYY-MM".
export function daysIn(key) { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
// The months Production and Month balance show: the 12 up to this month (`key`, "2026-10"), oldest first.
export const yearKeys = (key) => Array.from({ length: 12 }, (_, i) => shiftMonth(key, i - 11));

// A number, or text that is one ("0.25", " 20 "), from min to max; null for anything else.
export const num = (v, min = -Infinity, max = Infinity) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
// A state as a number, null when the entity is missing or has no value.
export const stateNum = (hass, id) => { const v = parseFloat(hass.states[id]?.state); return Number.isFinite(v) ? v : null; };
// A figure the owner gives as a number, a number typed as text, or the id of an entity holding one; null when none.
export const numberOrEntity = (v, hass) => num(v) ?? (typeof v === "string" ? stateNum(hass, v) : null);
// The sum of figures, null (unknown) when any of them is.
export const sumKnown = (values) => (values.every(Number.isFinite) ? values.reduce((s, v) => s + v, 0) : null);
// Energy at a price: 0 kWh costs 0 even without a price; unknown energy or price, null. The one rule for
// money from kWh: the Money page's days and months, and today's money so far (moneySoFar).
export const pricedEnergy = (kwh, rate) => (!Number.isFinite(kwh) ? null : kwh === 0 ? 0 : Number.isFinite(rate) ? kwh * rate : null);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const pct = (v) => Math.round(v * 100);

// say("{a} and {b}", { a, b }): placeholders are one letter.
export const say = (text, parts) => text.replace(/\{(\w)\}/g, (_, k) => parts[k]);
export const cap = (text) => text[0].toUpperCase() + text.slice(1);
// Text typed by the owner goes into the page as text, never as markup.
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A setup problem is said once a visit, not on every redraw.
const warned = new Set();
export const warnOnce = (text) => { if (!warned.has(text)) { warned.add(text); console.warn(`solar-view: ${text}`); } };
