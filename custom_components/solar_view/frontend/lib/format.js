/* Numbers, money, times and dates as the page writes them, in the language on screen. No imports. */

// 12 or 24 hour clock: this device's pick in the gear ("12" or "24"), else the viewer's profile in Home Assistant
// (Time format: "12", "24", "system" or "language"). undefined leaves it to the language.
// The device's own clock is asked once: it builds an Intl.DateTimeFormat, and hourCycle runs on every render.
let systemCycle;
export function hourCycle(timeFormat, locale) {
  const pick = String(timeFormat ?? locale?.time_format ?? "language");
  if (pick === "system") return (systemCycle ??= /h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle) ? "h12" : "h23");
  return pick === "12" ? "h12" : pick === "24" ? "h23" : undefined;
}

// One set of Intl formatters, kept while the language, currency, clock and time zone stay (see _render in solar-view.js). Times
// are in Home Assistant's time zone (`zone`), as the hours they name; dates are calendar days, in UTC (see totals).
export function formats(lang, currency, cycle, zone) {
  // A decimal point in every language, as the owner asked: "2.8 kW", "0.30 €". A group mark that is a
  // point too ("1.234" in Italian) becomes a narrow space, so the two never mix.
  const pointed = (numberFormat) => {
    const formatToParts = (v) => numberFormat.formatToParts(v).map((p) => (p.type === "decimal" ? { ...p, value: "." } : p.type === "group" && p.value === "." ? { ...p, value: "\u202f" } : p));
    return { formatToParts, format: (v) => formatToParts(v).map((p) => p.value).join("") };
  };
  const number = pointed(new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }));
  const money = pointed(new Intl.NumberFormat(lang, { style: "currency", currency }));
  const whole = pointed(new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })); // payback's sums
  // The currency sign after the number, whatever the language: "1.77 €".
  const after = (numberFormat, v) => {
    const parts = numberFormat.formatToParts(v), sign = parts.filter((p) => p.type === "currency").map((p) => p.value).join("");
    return `${parts.filter((p) => p.type !== "currency" && (p.type !== "literal" || p.value.trim())).map((p) => p.value).join("")} ${sign}`;
  };
  // A zone this browser's Intl does not know (an older WebView): the browser's own, as in clockOf.
  try { new Intl.DateTimeFormat(lang, { timeZone: zone }); } catch (e) { zone = undefined; }
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hourCycle: cycle, timeZone: zone }); // "alle 2:30", as spoken
  const hour = new Intl.DateTimeFormat(lang, { hour: "numeric", hourCycle: cycle, timeZone: zone }); // "15", "3 PM": Today by hour's ticks
  const zoned = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hourCycle: cycle, timeZone: zone, timeZoneName: "short" }); // the hour the clocks go back, twice
  const month = new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }); // "Oct", "ott": under the month columns
  const monthNarrow = new Intl.DateTimeFormat(lang, { month: "narrow", timeZone: "UTC" }); // "O": under the 12 months on a narrow card
  const monthYear = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }); // "March 2029": paid back
  // Payback's time left, with the language's own plurals: "18 months", "4.8 years".
  const months = pointed(new Intl.NumberFormat(lang, { style: "unit", unit: "month", unitDisplay: "long" }));
  const years = pointed(new Intl.NumberFormat(lang, { style: "unit", unit: "year", unitDisplay: "long", maximumFractionDigits: 1 }));
  // Days arrive as noon UTC of the calendar day (see totals).
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
  const date = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  // An unknown figure (null, or anything not a finite number) reads as a dash, never 0 or NaN.
  const known = (show) => (v) => (Number.isFinite(v) ? show(v) : "—");
  return {
    num: known((v) => number.format(v)),
    kwh: known((v) => `${number.format(v)} kWh`),
    money: known((v) => after(money, v)),
    moneyWhole: known((v) => after(whole, v)),
    time: (d) => time.format(d),
    zoned: (d) => zoned.format(d),
    month: (key) => month.format(new Date(`${key}-15T12:00:00Z`)).replace(".", ""),
    monthNarrow: (key) => monthNarrow.format(new Date(`${key}-15T12:00:00Z`)),
    monthYear: (key) => monthYear.format(new Date(`${key}-15T12:00:00Z`)),
    months: (n) => months.format(n),
    years: (n) => years.format(n),
    hour: (d) => hour.format(d),
    weekday: (d) => weekday.format(d).replace(".", ""),
    date: (d) => date.format(d),
  };
}
