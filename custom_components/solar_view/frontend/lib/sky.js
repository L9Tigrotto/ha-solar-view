/* The sky: its colours by the sun's height, cloud and rain now, the moon, and the sun's path (clear sky,
   a month's sunlight). Pure, for the page and the statistics. */

const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {typeof import("./core.js")} */
const { MINUTE, HALF_HOUR, DAY, clamp01, num, daysIn } = await import(`./core.js${v}`);

// ---- Sky: colours follow the sun's height (sun.sun elevation, degrees) ----
const SKY_DEEP_DEG = -18; // at or below: the night's own colours (astronomical night)
const SKY_NIGHT_DEG = -6; // at or below: night, still keeping some dawn or dusk down to SKY_DEEP_DEG
const SKY_LOW_DEG = 1;    // around here: full dawn or dusk colours
const SKY_DAY_DEG = 14;   // at or above: full day
const SKY_HIGH_DEG = 50;  // at or above: the day's own colours; below it the day keeps some dawn or dusk
const SKY_LOW_SHARE = 0.3; // how much dawn or dusk the day keeps at SKY_DAY_DEG, and the night at SKY_NIGHT_DEG
const CLOUD_GREY_FROM = 50; // forecast cloud cover in %: under this the sky keeps its colour
const CLOUD_GREY_FULL = 90; // from here up the day sky is fully grey
const RAIN_MM = 0.2;        // the forecast hour must bring more than this to show rain
const RAIN_DAY_MM = 3;      // a coming day shows rain from this much in the day (less is drizzle a phone app calls dry)
// [top, middle, bottom, sun glow]
const SKY = {
  dark: {
    night: ["#0b1433", "#080e24", "#04060f", "#ff9d5c"],
    dawn: ["#1c2b60", "#573a70", "#8a4f6e", "#ffc2a0"],
    dusk: ["#2a2350", "#6a3052", "#8c3f2a", "#ff9d5c"],
    day: ["#1e5fae", "#17488a", "#0d2b57", "#ffd66b"],
  },
  light: {
    night: ["#a9b5e3", "#cdd5f0", "#eceffa", "#fff1c9"],
    dawn: ["#b9cdf2", "#f3cfe0", "#ffe9d6", "#fff3da"],
    dusk: ["#c6c3ee", "#ffd5c0", "#ffe6b8", "#fff1c9"],
    day: ["#7fc1f5", "#bfe0fa", "#eef7fe", "#fffbe0"],
  },
};

const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, f) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * f).toString(16).padStart(2, "0")).join("");

// Night blends into dawn or dusk, which blends into day, by sun elevation. The day itself keeps a little
// of dawn or dusk while the sun is low, and reaches its own colours only with a high sun, so a summer noon
// is the deepest blue and a winter day stays a touch warmer. The night mirrors it: a little of dusk or dawn
// while the sun is just under the horizon, its own colours only in the deep night, so a summer night
// (the sun barely below -18) stays a touch lighter than a winter one. `grey` (0 to 1, see greyOf) turns
// only the day colours toward a grey of the same lightness, so it counts by the day's share.
function skyAt(elevation, rising, dark, grey = 0) {
  const p = SKY[dark ? "dark" : "light"];
  const low = p.dusk.map((c, i) => mix(c, p.dawn[i], +rising)); // `rising` may be a share, see dawnOf
  const up = smooth((elevation - SKY_NIGHT_DEG) / (SKY_LOW_DEG - SKY_NIGHT_DEG));
  const day = smooth((elevation - SKY_LOW_DEG) / (SKY_DAY_DEG - SKY_LOW_DEG));
  const warm = SKY_LOW_SHARE * (1 - smooth((elevation - SKY_DAY_DEG) / (SKY_HIGH_DEG - SKY_DAY_DEG)));
  const dusky = SKY_LOW_SHARE * smooth((elevation - SKY_DEEP_DEG) / (SKY_NIGHT_DEG - SKY_DEEP_DEG));
  const dayColors = p.day.map((c, i) => {
    c = mix(c, low[i], warm);
    const [r, g, b] = hex(c), v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, "0");
    return mix(c, `#${v}${v}${v}`, grey);
  });
  return { colors: p.night.map((c, i) => mix(mix(mix(c, low[i], dusky), low[i], up), dayColors[i], day)), up, day };
}
// How much the low sky is dawn's (1) rather than dusk's (0), by the sun's direction: 1 east, 0 west, half
// and half at noon and midnight, so a low winter noon does not jump from dawn to dusk when `rising` turns.
// Without an azimuth, by `rising`. Rounded, so the redraw key does not move with every digit.
const dawnOf = (a) => { const azimuth = parseFloat(a?.azimuth); return Number.isFinite(azimuth) ? Math.round(50 * (1 + Math.sin((azimuth * Math.PI) / 180))) / 100 : !!a?.rising; };
// Forecast cloud cover in % to how grey the day sky is: 0 under 50, 1 from 90 up, 0 when unknown.
const greyOf = (cloud) => (Number.isFinite(cloud) ? clamp01((cloud - CLOUD_GREY_FROM) / (CLOUD_GREY_FULL - CLOUD_GREY_FROM)) : 0);

// The first weather entity, by id. Looked for again only when it goes, or after a minute (one added that
// sorts first): every id in the house is a long list to go through on each state change.
let weatherId, weatherAt = 0;
function weatherOf(hass) {
  if (!hass.states[weatherId] || Date.now() - weatherAt > MINUTE) {
    weatherId = Object.keys(hass.states).filter((k) => k.startsWith("weather.")).sort()[0];
    weatherAt = Date.now();
  }
  return hass.states[weatherId];
}
// Rain now: the fresh sensor's present hour (`hour`: {} when it has none, null without a fresh sensor, see live
// in data.js; it wins, even saying no rain), else the weather entity. Never while that entity says snow alone:
// the sensor counts snow as rain.
function raining(hour, state) {
  if (state === "snowy") return false;
  if (hour) return (hour.rain ?? 0) > RAIN_MM;
  return ["rainy", "pouring", "lightning-rainy", "snowy-rainy"].includes(state);
}
// Cloud cover now in %: the fresh sensor's present hour (as for raining), else the weather entity's
// `cloud_coverage` (what it sees now, not a forecast; not every weather integration has it).
const cloudNow = (hour, coverage) => (hour ? hour.cloud : num(coverage));
// Snow now: only the weather entity knows it (the sensor has no snow).
const snowing = (state) => ["snowy", "snowy-rainy"].includes(state);
// What covers the sun or moon icon this hour, by the sky's thresholds: "snow", "rain", "overcast" (cloud
// from 90 %), "partly" (50 to 90 %) or "" (clear, or no cloud known).
const coverOf = (cloud, rain, snow = false) => (snow ? "snow" : rain ? "rain" : cloud >= CLOUD_GREY_FULL ? "overcast" : cloud >= CLOUD_GREY_FROM ? "partly" : "");
// The moon's phase in 8 steps (0 new, 2 first quarter, 4 full, 6 last quarter), from a known new moon
// and the mean length of a lunar month.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14), LUNAR_DAYS = 29.530588853;
const moonPhase = (timestamp) => Math.round(((((timestamp - NEW_MOON) / DAY / LUNAR_DAYS) % 1) + 1) % 1 * 8) % 8;

// The sun's declination in radians on day `n` of the year (0 is 1 January, fractions allowed).
const declination = (n) => 23.45 * (Math.PI / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365);
// Clear-sky sunlight on flat ground at the middle of the hour starting at `t` (ms), in W/m2: the sun's height
// from the date, the hour and the longitude, then Haurwitz's clear sky. The equation of time is left out (a
// quarter hour at most): the usual day only compares nearby days by it, which shifts them alike.
function clearSky(t, latitude, longitude) {
  const radiansPerDegree = Math.PI / 180, d = new Date(t + HALF_HOUR), n = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY;
  const solarDeclination = declination(n);
  const hourAngle = (d.getUTCHours() + d.getUTCMinutes() / 60 + longitude / 15 - 12) * 15 * radiansPerDegree;
  const c = Math.sin(latitude * radiansPerDegree) * Math.sin(solarDeclination) + Math.cos(latitude * radiansPerDegree) * Math.cos(solarDeclination) * Math.cos(hourAngle);
  return c > 0.01 ? 1098 * c * Math.exp(-0.057 / c) : 0;
}

// Sunlight on flat ground above the air at latitude `lat` over month `key`, summed by day, in no particular
// unit: only months against each other matter. Clouds and the panels' tilt are left to the scale seasonGuess fits.
function monthSun(key, latitude) {
  const radiansPerDegree = Math.PI / 180, f = latitude * radiansPerDegree, [y, m] = key.split("-").map(Number);
  const first = Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(y, 0, 1)) / DAY);
  let s = 0;
  for (let n = first + 1; n <= first + daysIn(key); n++) {
    const solarDeclination = declination(n);
    const set = Math.acos(Math.max(-1, Math.min(1, -Math.tan(f) * Math.tan(solarDeclination))));
    s += (1 + 0.033 * Math.cos((2 * Math.PI * n) / 365)) * (Math.cos(f) * Math.cos(solarDeclination) * Math.sin(set) + set * Math.sin(f) * Math.sin(solarDeclination));
  }
  return s;
}

export { SKY, SKY_LOW_DEG, SKY_NIGHT_DEG, SKY_DAY_DEG, RAIN_DAY_MM, skyAt, dawnOf, greyOf, weatherOf, raining, cloudNow, snowing, coverOf, moonPhase, clearSky, monthSun };
