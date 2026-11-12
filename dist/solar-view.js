/* Solar page in plain words: a Home Assistant custom panel (panel_custom in configuration.yaml).
   Home Assistant sets `hass` on the element, so login, live states and language come for free.
   Served WITHOUT login, under /hacsfiles/ (HACS) or /local/ (copied by hand): never put a secret here.
   /local/ is cached hard: there, bump ?v= in configuration.yaml after every edit of any file. /hacsfiles/ tells the browser not to cache.

   Files: this one (the element: loading, the render, focus and hints), core.js (time, numbers and text helpers shared by all),
   format.js (numbers, money and dates as written), config.js (the panel config and the entities to read), sky.js (the sky's
   colours, cloud and rain now, the sun's path), advice.js (the advice card's rules), forecast.js (the day simulation and
   what follows from the forecast), stats.js (the statistics as numbers), data.js (what the page shows, and the skeleton's
   numbers), money.js (the money rules), draw.js (rings, charts and icons shared by the pages), page-now.js,
   page-energy.js and page-money.js (one per page), strings-en.js and one strings-xx.js per language (every text),
   styles.js (the CSS). Sections here: rules, parts, the gear, the element. */

// The charts and lists the arrow keys move along, each one Tab stop (see _rove).
const ROVE = ":is(ul.days,ol.week,ol.year,ol.hours24,svg.cols)";

// ---- Rules (tune here) ----
const REFRESH_MS = 5 * 60 * 1000; // totals come from the statistics, which move every 5 minutes

// ---- Parts: helpers, texts and stylesheet live in their own files ----
// They must load with this file's own ?v=, or under /local/ the browser keeps stale copies. All start here,
// in one wave: a file's own import of a sibling (forecast.js of core.js) then finds it already loading.
// Texts: one file per language (strings-it.js), loaded the first time it is on screen. English is always
// there, under every other language, so a key one lacks reads in English (a half-copied /local/ update).
const version = new URL(import.meta.url).search;
// This device's language, set in the gear's dialog: one of LANGUAGES, kept apart from the Home Assistant
// profile. Absent (Automatic) the page follows the viewer's language there. Each language by its own name.
const LANGUAGE_KEY = "solar-view-language";
const LANGUAGES = { en: "English", it: "Italiano", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", nl: "Nederlands", pl: "Polski" };
const STRINGS = {}; // the languages loaded so far
const failedLanguages = new Set(); // these stay English for this visit
const textsOf = (code) => import(`./strings-${code}.js${version}`).then((m) => m.STRINGS[code]);
const english = textsOf("en");
const loads = {};
const loadLanguage = (code) => loads[code] ??= Promise.all([english, code === "en" ? {} : textsOf(code)]).then(
  ([en, own]) => { STRINGS[code] = { ...en, ...own }; },
  (e) => { failedLanguages.add(code); console.warn("solar-view: the texts for", code, "did not load", e); });
// The first language is guessed, so its file comes with the others: this device's choice in the gear, else
// the page's language, which Home Assistant sets to the viewer's. A wrong guess costs one file; _render
// then loads the right one.
const supported = (l) => [l, l.split("-")[0]].find((c) => Object.hasOwn(LANGUAGES, c));
let guess = "";
try { guess = localStorage.getItem(LANGUAGE_KEY) ?? ""; } catch (e) { /* no storage */ }
guess = supported(guess) ?? supported(document.documentElement.lang || navigator.language || "") ?? "en";
const [, , { CSS }, { findForecast }, { MINUTE, FIVE_MIN, HOUR, DAY, clockOf, stateNum, esc, warnOnce }, { formats, hourCycle },
  { readConfig, requiredIds, optionalIds }, { skyAt }, { withOwnAdvice }, { totals, fetchStats },
  { LAST_KEY, predict, readData, slim, remembered, placeholder },
  { line, battRing, sw, wxIcon }, , { nowView, nowPage, learnGoIcons }, { energyView, energyPage }, { paybackView, moneyView, moneyPage }] = await Promise.all([
  english, loadLanguage(guess), import(`./styles.js${version}`), import(`./forecast.js${version}`), import(`./core.js${version}`),
  import(`./format.js${version}`), import(`./config.js${version}`), import(`./sky.js${version}`), import(`./advice.js${version}`),
  import(`./stats.js${version}`), import(`./data.js${version}`), import(`./draw.js${version}`), import(`./money.js${version}`),
  import(`./page-now.js${version}`), import(`./page-energy.js${version}`), import(`./page-money.js${version}`)]);

// ---- The gear: display switches and language ----
// Display switches, per device (the gear): only the switches turned off are kept, as { rain: false }.
// Nothing kept, or storage that fails, means everything on. Grouped by the heading they go under.
// Only how things look: cards with nothing to show hide themselves.
const SHOW_KEY = "solar-view-show";
// A small flag beside each name, only a picture: the name is what is read out. Automatic gets a globe.
const FLAG = {
  en: '<path fill="#21468b" d="M0 0h24v16H0z"/><path stroke="#fff" stroke-width="4" d="m0 0 24 16M24 0 0 16"/><path stroke="#c8102e" stroke-width="1.5" d="m0 0 24 16M24 0 0 16"/><path fill="#fff" d="M9 0h6v16H9zM0 5h24v6H0z"/><path fill="#c8102e" d="M10.5 0h3v16h-3zM0 6.5h24v3H0z"/>',
  it: '<path fill="#009246" d="M0 0h8v16H0z"/><path fill="#fff" d="M8 0h8v16H8z"/><path fill="#ce2b37" d="M16 0h8v16h-8z"/>',
  es: '<path fill="#aa151b" d="M0 0h24v16H0z"/><path fill="#f1bf00" d="M0 4h24v8H0z"/>',
  fr: '<path fill="#002395" d="M0 0h8v16H0z"/><path fill="#fff" d="M8 0h8v16H8z"/><path fill="#ed2939" d="M16 0h8v16h-8z"/>',
  de: '<path fill="#000" d="M0 0h24v5.333H0z"/><path fill="#d00" d="M0 5.333h24v5.334H0z"/><path fill="#ffce00" d="M0 10.667h24V16H0z"/>',
  pt: '<path fill="#f00" d="M0 0h24v16H0z"/><path fill="#060" d="M0 0h9.6v16H0z"/><circle cx="9.6" cy="8" r="3.7" fill="#ff0"/><path fill="#fff" stroke="#c00" stroke-width="1" d="M7.7 5.5h3.8v3q-1.9 3-3.8 0z"/>',
  nl: '<path fill="#ae1c28" d="M0 0h24v5.333H0z"/><path fill="#fff" d="M0 5.333h24v5.334H0z"/><path fill="#21468b" d="M0 10.667h24V16H0z"/>',
  pl: '<path fill="#fff" d="M0 0h24v8H0z"/><path fill="#dc143c" d="M0 8h24v8H0z"/>',
  "": '<g fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="6.5"/><ellipse cx="12" cy="8" rx="3" ry="6.5"/><path d="M5.5 8h13"/></g>',
};
// Rich options where the browser draws them (see .language select); elsewhere the parser drops the button,
// the flags and the spans, and each option keeps its name as plain text.
const languagePicker = () => `<fieldset class="language"><legend id="language-title" data-t="language"></legend>
<select name="language" aria-labelledby="language-title"><button type="button"><selectedcontent></selectedcontent></button>${
  Object.entries({ "": "", ...LANGUAGES }).map(([code, name]) => `<option value="${code}"><svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">${FLAG[code]}</svg><span>${name}</span></option>`).join("")}</select></fieldset>`;
const SWITCHES = { showSky: ["sunHeight", "clouds", "rain"] };

// The whole-page messages: the inverter not answering (a crossed out wifi), and setting up (the sun).
// The help button's "?" in a circle, and the tab bar's icons (24 x 24, drawn with the text colour).
const OFFLINE_ICON = `<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69m8.83 2.69a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20"/>`;
const SETUP_ICON = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`;
const TAB_ICON = {
  now: `<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>`,
  energy: `<path d="M3 3v16a2 2 0 0 0 2 2h16m-3-4V9m-5 8V5M8 17v-3"/>`,
  money: `<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48M15 6h1v4"/><path d="m6.134 14.768l.866-.5l2 3.464"/><circle cx="16" cy="8" r="6"/>`,
};

// ---- Pages: each returns the HTML of one page from c = { data, t, f, sky, loading, day, clock, pick } ----
const PAGES = ["now", "energy", "money"];

// What a focused control is within its page, so a redraw can focus the same one again (see _render): a
// card's "?" by its card, a month by its key, a flow node by its key, a day or hour by its card, chart row
// and place, any other hint target by its card and place among that card's hint targets.
const cardKey = (card) => (card.dataset.pick ? `pick:${card.dataset.pick}` : `class:${card.getAttribute("class")}`);
function focusKey(page, el) {
  if (el.matches(".help[data-card]")) return { kind: "help", card: el.dataset.card };
  if (el.dataset.focusKey) return { kind: "key", key: el.dataset.focusKey }; // before the month: a month step has both
  if (el.dataset.month) return { kind: "month", month: el.dataset.month };
  const card = el.closest(".card"), scope = card || page, scopeKey = card ? cardKey(card) : null;
  if (el.dataset.i !== undefined) {
    const row = el.parentElement, sel = row.matches(".hours24") ? ".hours24" : ".week";
    return { kind: "item", scope: scopeKey, row: sel, rowIndex: [...scope.querySelectorAll(sel)].indexOf(row), index: el.dataset.i };
  }
  const index = [...scope.querySelectorAll("[data-hint]")].indexOf(el);
  return index < 0 ? null : { kind: "hint", scope: scopeKey, index };
}
function focusTarget(page, key) {
  const find = (sel, ok) => [...page.querySelectorAll(sel)].find(ok);
  if (key.kind === "help") return find(".help[data-card]", (el) => el.dataset.card === key.card);
  if (key.kind === "month") return find("[data-month]", (el) => el.dataset.month === key.month);
  if (key.kind === "key") return find("[data-focus-key]", (el) => el.dataset.focusKey === key.key);
  const scope = key.scope ? find(".card", (card) => cardKey(card) === key.scope) : page;
  if (!scope) return null;
  if (key.kind === "item") return [...(scope.querySelectorAll(key.row)[key.rowIndex]?.children || [])].find((el) => el.dataset.i === key.index);
  return scope.querySelectorAll("[data-hint]")[key.index] || null;
}
// How to read each card: one line per mark, its drawing and its text. The battery's has its two
// example rings above the lines (see the element).
const READ = {
  battery: ["solid", "gain", "use", "range", "low"].map((k) => [`<i class="${k}"></i>`, `help${k[0].toUpperCase() + k.slice(1)}`]),
  days: [[sw("pill", "--sun"), "helpDaysPill"], [sw("mark", "--ink"), "helpDaysUse"], [wxIcon("partly"), "helpDaysSky"]],
  daily: [[sw("solid", "--sun"), "helpProdMonths"], [sw("ghost", "--sun"), "helpProdEnd"], [sw("line", "--sun"), "helpWeekBar"], [sw("lineAhead", "--sun"), "helpProdAhead"],
    [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpWeekPick"]],
  share: [[sw("arc", "--sun"), "helpShareSun"], [sw("arc", "--batt"), "helpShareBatt"], [sw("arc", "--grid"), "helpShareGrid"],
    [`<b class="sw-num">%</b>`, "helpShareNum"], ["", "helpShareTotal"], ["", "helpShareAhead"], ["", "helpShareAheadFc"]],
  recent: [[sw("line", "--sun"), "helpRecentBar"], ["", "helpRecentSold"], [sw("lineAhead", "--sun"), "helpRecentAhead"], [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpRecentPick"]],
  payback: [[sw("arc", "--sun"), "helpPaybackArc"], ["", "helpPaybackCost"], ["", "helpPaybackLeft"]],
  battday: [[sw("line", "--sun"), "helpBattDayBars"], [sw("lineAhead", "--sun"), "helpBattDayGhost"], [sw("line", "--batt"), "helpBattDayLine"], [sw("lineAhead", "--batt"), "helpBattDayAhead"], [sw("usual", "--low"), "helpBattDayFloor"], [sw("dotPick", "--batt"), "helpBattDayPick"]],
  table: [[sw("solid", "--batt"), "helpBalMonths"], [sw("ghost", "--batt"), "helpBalEnd"], [sw("arc", "--grid"), "helpBalSplit"], ["", "helpBalNet"]],
  prices: [[sw("buy", "--grid"), "helpPricesBuy"], ["", "helpPricesBands"], [sw("sell", "--sent"), "helpPricesSell"], ["", "helpPricesRates"]],
};




// How much the browser enlarges text on its own: [page text, chart text], 1 where it does not. The
// Home Assistant app on Android shows the panel in a web view that grows text by the phone's font size
// but leaves the layout alone, so lines overflow their cards. A word in a fixed size on the page, against
// the same word on a canvas (which the web view leaves alone), gives the factor; an SVG word gives it for
// chart text, which may differ. The panel then zooms as a whole by it (see the :host rule in styles.js).
function textScale() {
  const font = "100px sans-serif", word = "Mmmmmmmmmm";
  const box = document.createElement("div");
  box.style.cssText = `position:fixed;left:-9999px;top:0;font:${font};white-space:nowrap;-webkit-text-size-adjust:100%;text-size-adjust:100%`;
  box.innerHTML = `<span>${word}</span><svg width="2000" height="200"><text y="150" style="font:${font}">${word}</text></svg>`;
  document.body.append(box);
  const page = box.firstChild.getBoundingClientRect().width, chart = box.querySelector("text").getComputedTextLength();
  box.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = font;
  const plain = ctx.measureText(word).width;
  // Small differences are font rounding, not a setting.
  return [page, chart].map((w) => (w / plain > 1.05 ? Math.round((w / plain) * 100) / 100 : 1));
}
let zoom; // textScale's answer, measured once per load: it forces a layout of the whole document

// One key per page, from what that page reads, so a live update builds Now alone (S4, P5): `base` (loading, the
// formats, the texts, the day, and the versions of the statistics and the forecast), then the live values each page
// draws, as themselves (a few hundred bytes). A picked day or hour changes its page in place (see _wireWeek); a
// picked month draws again whatever the keys (see _redraw). payback: what payback reads (see paybackView).
function pageKeys(data, { base, now, clock, sky }) {
  const money = JSON.stringify([data.sends, data.payback, data.lat, data.price, data.priceNow, data.billFixed?.now]);
  return {
    now: `${base}|${JSON.stringify([data.now, data.sun, data.weather, data.moon, data.batt, data.wear, sky.day])}`,
    // Today by hour moves its now line every 5 minutes.
    energy: `${base}|${Math.floor(now / FIVE_MIN)}|${JSON.stringify([data.now.soc, data.batt, data.sends])}`,
    // The band now changes by the hour.
    money: `${base}|${clock(now).hour}|${money}`,
    payback: `${base}|${money}`,
  };
}

// ---- Element ----
class SolarView extends HTMLElement {
  constructor() {
    super();
    // The render (see _render): one key per page, each page's view made when its key moves, its HTML written
    // when it is in view.
    this._drawn = "";     // the message on screen (offline, not set up), to skip identical redraws
    this._keys = {};      // each page's key when its view was made
    this._views = {};     // each page's view (nowView, energyView, moneyView)
    this._built = {};     // each page's key when its HTML was written
    this._html = {};      // each page's markup on screen, to write only the pages that changed
    this._skel = new Set(); // the pages showing the skeleton
    this._help = {};      // each card's help lines, from the views (see _applyHelp)
    this._visible = null; // the pages in view (see _wireTabs); null until the pager says, and then all count
    this._statsV = 0;     // bumped with each new _stats, so a key needs not hold them
    this._lookV = 0;      // bumped with each new _looked
    this._tVersion = 0;   // bumped with each new _t
    this._dirty = false;  // a render skipped while the tab is hidden or the panel off the page (see _asleep)
    this._force = null;   // the page a month was picked on, written in that render whatever the pager says (see _redraw)
    this._src = undefined;   // { ids, cfg }: which entities to read and the settings (readConfig), once the Energy settings answered
    this._stats = undefined; // totals from the statistics (totals)
    this._next = 0;          // when to load both again
    this._looked = {};       // the forecast and what follows from it (see predict in data.js)
    this._kept = {};         // the statistics kept between loads, by call (see fetchStats)
    this._last = undefined;  // the copy kept for the skeleton (see slim), read from storage once; null: none
    // The host attributes (dark, ready) are set in _render: a custom element constructor must
    // not set attributes on itself.
    const root = this.attachShadow({ mode: "open" });
    // Rain is a few drops at fixed places across the width, each started at another point of its fall.
    root.innerHTML = `<style>${CSS}</style>
<div class="sky"></div><div class="stars"></div><div class="rain" aria-hidden="true" hidden>${[[6, 0], [19, 1.3], [31, 0.6], [44, 1.9], [56, 0.3], [68, 1.6], [81, 0.9], [93, 2.1]]
  .map(([x, d]) => `<i style="left:${x}%;animation-delay:-${d}s"></i>`).join("")}</div><div class="snow" aria-hidden="true" hidden>${[[4, 4, 0, 8], [11, 3, 5.1, 9.5], [18, 5, 2.4, 7.5], [26, 3, 6.8, 10], [33, 6, 1.2, 8.5], [41, 4, 4.3, 9], [48, 3, 7.4, 7.8], [55, 5, 0.6, 9.8], [62, 4, 3.6, 8.2], [70, 3, 5.9, 10.2], [77, 6, 2.1, 8.8], [84, 4, 6.3, 7.6], [91, 3, 1.7, 9.2], [96, 5, 4.8, 8.4]]
  .map(([x, s, d, t]) => `<i style="left:${x}%;--s:${s}px;--t:${t}s;animation-delay:-${d}s"></i>`).join("")}</div><div class="veil"></div><div class="hint" aria-hidden="true"></div><div class="status" role="status"></div>
<button type="button" class="gear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6v4.6M12 17.8v4.6M1.6 12h4.6M17.8 12h4.6M4.6 4.6l3.3 3.3M16.1 16.1l3.3 3.3M4.6 19.4l3.3-3.3M16.1 7.9l3.3-3.3" stroke-width="3.4"/><circle cx="12" cy="12" r="5.9" stroke-width="3"/></svg></button>
<main class="pager">${PAGES.map((p) => `<section class="page ${p}" id="${p}"></section>`).join("")}</main>
<footer><ha-menu-button hidden></ha-menu-button><nav class="tabs">${PAGES.map((p) =>
  `<button type="button" data-page="${p}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICON[p]}</svg><span></span></button>`).join("")}</nav></footer>
<dialog class="show" aria-labelledby="show-title"><form method="dialog"><h2 id="show-title" data-t="showTitle"></h2><p data-t="showNote"></p>
${Object.entries(SWITCHES).map(([group, names]) => `<fieldset><legend data-t="${group}"></legend>${names.map((n) =>
  `<label><span data-t="sw${n[0].toUpperCase() + n.slice(1)}"></span><input type="checkbox" role="switch" name="${n}"></label>`).join("")}</fieldset>`).join("")}
${languagePicker()}
<button data-t="showDone"></button></form></dialog>
${Object.entries(READ).map(([card, lines]) => `<dialog class="read" data-card="${card}" aria-labelledby="read-${card}"><form method="dialog"><h2 id="read-${card}" data-t="helpTitle"></h2>
${card === "battery" ? `<div class="pair"><figure>${battRing(60, 75, [69, 81], "--batt", null, "")}<figcaption data-t="helpRise"></figcaption></figure>
<figure>${battRing(60, 45, [40, 52], "--batt", null, "")}<figcaption data-t="discharging"></figcaption></figure></div>` : ""}
<ul>${lines.map(([mark, key]) => `<li>${mark}<span data-t="${key}"></span></li>`).join("")}</ul>
<button data-t="helpClose"></button></form></dialog>`).join("")}`;
    this._pager = root.querySelector(".pager");
    this._menu = root.querySelector("ha-menu-button");
    this._tabs = [...root.querySelectorAll(".tabs button")];
    this._hint = root.querySelector(".hint");
    this._status = root.querySelector(".status");
    this._rain = root.querySelector(".rain");
    this._snow = root.querySelector(".snow");
    this._gear = root.querySelector(".gear");
    this._dialog = root.querySelector("dialog.show");
    try { this._show = JSON.parse(localStorage.getItem(SHOW_KEY)) ?? {}; } catch (e) { this._show = {}; }
    try { const l = localStorage.getItem(LANGUAGE_KEY); this._language = Object.hasOwn(LANGUAGES, l ?? "") ? l : ""; } catch (e) { this._language = ""; }
    this._wireHints(root);
    this._wireTabs(root);
    this._wireShow();
    this._wireWeek();
  }

  // Home Assistant can create this element and set hass, narrow and panel before this file has
  // finished loading (the load event does not wait for the imports above). Those values then sit
  // on the element as plain properties and hide the setters below, so the page stays empty.
  // Hand each one to its setter.
  connectedCallback() {
    for (const name of ["panel", "narrow", "hass"]) if (Object.hasOwn(this, name)) {
      const value = this[name];
      delete this[name];
      this[name] = value;
    }
    const [zf, zs] = (zoom ??= textScale());
    this.style.setProperty("--zf", zf);
    this.style.setProperty("--zs", zs);
    // Still nothing from Home Assistant: show the veil's plain day sky, not a blank page. The theme
    // is not known yet, so the system's stands in for it.
    if (!this._hass) this._paint("l", skyAt(30, false, matchMedia("(prefers-color-scheme: dark)").matches).colors);
    // Back after being taken off the page: the load dropped then is asked again.
    else if (this._dropped) this._loadSoon();
    this._dropped = false;
    document.addEventListener("visibilitychange", this._onVisible ??= () => this._wake());
    this._wake();
  }
  // Taken off the page: a load still on its way is dropped (see the run check in _load), and nothing is drawn
  // or saved until it is back (B17), so a page nobody sees neither draws nor overwrites the copy this browser
  // remembers.
  disconnectedCallback() {
    this._run = (this._run || 0) + 1;
    this._dropped = true;
    document.removeEventListener("visibilitychange", this._onVisible);
  }
  // While the tab is hidden or the panel off the page, Home Assistant's updates are only kept (P6, B17): the
  // last one is worked through when the panel is seen again.
  _asleep() { return !!this._dropped || (this.isConnected && document.hidden); }
  _wake() { if (this._dirty && this._hass && !this._asleep()) { this._dirty = false; this.hass = this._hass; } }

  _paint(prefix, colors) { colors.slice(0, 3).forEach((c, i) => this.style.setProperty(`--${prefix}${i + 1}`, c)); }

  // Hovering, tapping or focusing anything with data-hint shows its sentence. Delegated, because
  // the pages are redrawn whenever the data changes.
  _wireHints(root) {
    const tip = this._hint;
    // Escape hides the hint and keeps it hidden until the viewer leaves that target. A redraw replaces
    // the element, so the target is known by its focus key (see focusKey), not by the element alone.
    let dismissed = null, dismissedKey = null;
    const keyOf = (el) => {
      const page = el.closest(".page"), key = page && focusKey(page, el);
      return key ? `${page.id}:${JSON.stringify(key)}` : el;
    };
    const reset = () => { dismissed = dismissedKey = null; };
    const hide = () => tip.classList.remove("on");
    const show = (e) => {
      const el = e.target.closest?.("[data-hint]");
      // The skeleton holds placeholder numbers: never put them in a hint.
      if (!el || this._pager.classList.contains("skel")) { hide(); return; }
      if (dismissed && keyOf(el) === dismissedKey) { dismissed = el; hide(); return; }
      reset();
      this._hintFor = el; // see _render
      // What the mark is, small, over its value, split at the sentence's first colon ("12:00 PM: about
      // 3 kW" splits after "PM"); a dot in the mark's colour when it has one (--c).
      const [, title, body] = el.dataset.hint.match(/^(?:(.+?)\s?:\s)?(.+)$/s);
      const line = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
      tip.replaceChildren(...(title ? [line("small", title)] : []), line("b", body[0].toUpperCase() + body.slice(1)));
      const dot = el.style.getPropertyValue("--c");
      tip.classList.toggle("dot", !!dot);
      tip.style.setProperty("--dot", dot);
      // Rects come zoomed (see textScale), the hint is placed in the panel's own pixels.
      const z = this.currentCSSZoom || 1, unzoom = (b) => ({ left: b.left / z, top: b.top / z, bottom: b.bottom / z, width: b.width / z, height: b.height / z });
      const box = unzoom(this.getBoundingClientRect()), r = unzoom(el.getBoundingClientRect()), mid = r.left - box.left + r.width / 2;
      const left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, mid - tip.offsetWidth / 2));
      // Above the mark, else below it; where neither has room, on the roomier side, kept inside the panel.
      const above = r.top - box.top - tip.offsetHeight - 10, below = r.bottom - box.top + 10;
      const up = above >= 8 || (below + tip.offsetHeight > box.height - 8 && r.top - box.top > box.bottom - r.bottom);
      tip.classList.toggle("below", !up);
      // The pointer stays on the mark, inside the rounded corners.
      tip.style.setProperty("--x", `${Math.round(Math.max(16, Math.min(tip.offsetWidth - 16, mid - left)))}px`);
      tip.style.transform = `translate(${Math.round(left)}px,${Math.round(up ? Math.max(8, above) : Math.min(below, box.height - tip.offsetHeight - 8))}px)`;
      tip.classList.add("on");
    };
    root.addEventListener("pointerover", show);
    root.addEventListener("focusin", show);
    // Moving between the parts of one target (a ring's arcs) is not leaving it.
    const leave = (e) => {
      const el = e.target.closest?.("[data-hint]");
      if (el && el.isConnected && el === dismissed && !el.contains(e.relatedTarget)) reset();
    };
    // Escape is taken only when it hides a hint; otherwise it goes on to close a dialog as usual.
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !tip.classList.contains("on")) return;
      dismissed = this._hintFor;
      dismissedKey = keyOf(dismissed);
      hide();
      e.preventDefault();
      e.stopPropagation();
    });
    root.addEventListener("focusout", (e) => { leave(e); hide(); });
    root.addEventListener("pointerout", (e) => { if (!dismissed?.contains(root.activeElement)) leave(e); });
    this.addEventListener("pointerleave", () => { if (!dismissed?.contains(root.activeElement)) reset(); hide(); });
  }

  // The tab bar follows the swipe, and a tab scrolls the pager.
  _wireTabs(root) {
    const mark = (id) => this._tabs.forEach((b) =>
      (b.dataset.page === id ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
    mark("now");
    // After a tap the pager scrolls past the pages in between: the tapped tab stays marked until
    // its page arrives. A touch or the wheel means the viewer took over, so the swipe leads again.
    let going = "";
    // A hidden page (the error message hides Energy and Money) is never marked or scrolled to.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (!e.target.hidden && e.isIntersecting && (!going || e.target.id === going)) { going = ""; mark(e.target.id); }
    }, { root: this._pager, threshold: 0.6 });
    [...this._pager.children].forEach((p) => io.observe(p));
    // Which pages show any part of themselves: only those are written (see _render), the others when they come.
    // Until the first answer every page counts as seen. The page beside the one in view touches the pager's edge,
    // which counts as intersecting at 0: the 1 % step tells when it really comes in.
    const seen = new IntersectionObserver((entries) => {
      const shown = (this._visible ??= new Set());
      for (const e of entries) if (e.intersectionRatio > 0) shown.add(e.target.id); else shown.delete(e.target.id);
      if (PAGES.some((p) => shown.has(p) && this._built[p] !== this._keys[p])) this._render();
    }, { root: this._pager, threshold: [0, 0.01] });
    [...this._pager.children].forEach((p) => seen.observe(p));
    for (const type of ["pointerdown", "wheel"]) this._pager.addEventListener(type, () => { going = ""; }, { passive: true });
    this._activatePage = (id, instant = false) => {
      const page = root.getElementById(id);
      if (!page || page.hidden) return;
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      going = page.id;
      this._pager.scrollTo({ left: page.offsetLeft - this._pager.offsetLeft, behavior: instant || calm ? "instant" : "smooth" });
      mark(page.id);
    };
    this._tabs.forEach((b) => b.addEventListener("click", () => this._activatePage(b.dataset.page)));
  }

  // The gear opens the display switches. A switch redraws at once and is kept for this device; when
  // storage fails it still holds until the page is reloaded.
  _wireShow() {
    const boxes = [...this._dialog.querySelectorAll('input[role="switch"]')];
    boxes.forEach((b) => { b.checked = this._show[b.name] !== false; });
    this._gear.addEventListener("click", () => this._dialog.showModal());
    // Safari does not focus a tapped button, so the dialog would hand focus to the page instead.
    this._dialog.addEventListener("close", () => this._gear.focus());
    // The language: applied at once; Automatic clears it. Without storage it holds for this visit.
    const language = this._dialog.querySelector('select[name="language"]');
    language.value = this._language;
    language.addEventListener("change", () => {
      if (!Object.hasOwn(LANGUAGES, language.value) && language.value !== "") return;
      this._language = language.value;
      try { this._language ? localStorage.setItem(LANGUAGE_KEY, this._language) : localStorage.removeItem(LANGUAGE_KEY); } catch (e) { /* this visit only */ }
      this._render();
    });
    this._dialog.addEventListener("change", (e) => {
      if (!e.target.matches('input[role="switch"]')) return;
      this._show = Object.fromEntries(boxes.filter((b) => !b.checked).map((b) => [b.name, false]));
      try { localStorage.setItem(SHOW_KEY, JSON.stringify(this._show)); } catch (e) { /* this view only */ }
      this._render();
    });
    // A card's "?" opens how to read it, as the gear does. The button is redrawn with its page, so focus
    // goes back to the one on screen now.
    const root = this.shadowRoot;
    this._pager.addEventListener("click", (e) => {
      const help = e.target.closest?.(".help");
      const d = help && root.querySelector(`dialog.read[data-card="${help.dataset.card}"]`);
      if (!d) return;
      // Named as its button is, with the card's title.
      d.removeAttribute("aria-labelledby");
      d.setAttribute("aria-label", help.getAttribute("aria-label"));
      d.showModal();
    });
    // Its card gone meanwhile (an error message took the page), the gear takes focus instead.
    root.querySelectorAll("dialog.read").forEach((d) => d.addEventListener("close", () => {
      const help = root.querySelector(`.help[data-card="${d.dataset.card}"]`);
      (help?.checkVisibility() && !help.closest("[inert]") ? help : this._gear).focus();
    }));
  }

  // A day or an hour picked: highlighted, its figures under the chart (see dayLine and battDayCard). Changed
  // in place, and kept for the redraws. A day is picked by a tap, focus (the arrow keys move it) or a drag.
  // An hour only by a click, Enter or Space, or a finger's drag: hovering or focusing it shows it on both
  // charts with its hint (.hover), and a mouse moved with a button held changes nothing.
  // A month (Production, Month balance) is picked by a click, Enter or Space: its card is drawn again.
  _wireWeek() {
    const ROW = ":is(.week,.hours24) li", HOUR = ".hours24 li";
    const pick = (e) => {
      const bar = e.target.closest?.(ROW);
      if (!bar || bar.classList.contains("future")) return;
      // Each card keeps its own pick (by its data-pick: daily, recent, battday) across redraws.
      const card = bar.closest(".card");
      (this._pick ??= {})[card.dataset.pick] = +bar.dataset.i;
      card.querySelectorAll(ROW).forEach((li) => (li.dataset.i === bar.dataset.i ? li.setAttribute("aria-current", "true") : li.removeAttribute("aria-current")));
      card.querySelectorAll(".day").forEach((p) => { p.hidden = p.dataset.i !== bar.dataset.i; });
      // ‹ or › greyed when there is no hour or day that way (see steps).
      card.querySelectorAll("[data-step]").forEach((b) => {
        const to = bar.parentElement.children[+bar.dataset.i + +b.dataset.step];
        if (!to || to.classList.contains("future")) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
      });
      this._rove(card);
    };
    // ‹ and › beside the picked hour or day pick its neighbour, as a tap on it would (a month's go by month, below).
    const step = (e) => {
      const b = e.target.closest?.("[data-step]");
      if (!b) return false;
      const cells = [...b.closest(".card").querySelector(".week, .hours24").children];
      const to = cells[cells.findIndex((li) => li.hasAttribute("aria-current")) + +b.dataset.step];
      if (to) pick({ target: to });
      return true;
    };
    const month = (e) => {
      const b = e.target.closest?.("[data-month]");
      if (!b) return false;
      const card = b.closest(".card");
      // A new month starts from its last day.
      (this._pick ??= {})[`${card.dataset.pick}Month`] = b.dataset.month;
      if (card.dataset.pick === "daily") delete this._pick.daily;
      this._redraw(card.closest(".page").id);
      return true;
    };
    this._pager.addEventListener("click", (e) => {
      // Safari does not focus a button it clicks. A step takes focus itself, or a month's redraw would put it
      // back on the day that had it (see focusKey): that day's hint would open, and the day be picked.
      e.target.closest?.(".step")?.focus();
      if (!step(e) && !month(e)) pick(e);
    });
    this._pager.addEventListener("focusin", (e) => { if (!e.target.closest?.(HOUR)) pick(e); });
    // The hour under the pointer or focus, on both charts.
    const hover = (li) => this._pager.querySelectorAll(HOUR).forEach((c) => c.classList.toggle("hover", !!li?.dataset.hint && c.dataset.i === li.dataset.i));
    this._pager.addEventListener("pointerover", (e) => hover(e.target.closest?.(HOUR)));
    this._pager.addEventListener("focusin", (e) => hover(e.target.closest?.(HOUR)));
    this._pager.addEventListener("focusout", () => hover(null));
    this._pager.addEventListener("pointerleave", () => hover(null));
    // A drag picks whatever it passes over in the row it started in (the rows only scroll the page up and down).
    let row = null;
    this._pager.addEventListener("pointerdown", (e) => {
      const li = e.isPrimary ? e.target.closest?.(ROW) : null, hour = !!li?.matches(HOUR);
      row = li && (!hour || e.pointerType === "touch") ? li.parentElement : null;
      if (row && !hour) pick(e);
    });
    this._pager.addEventListener("pointermove", (e) => {
      const li = row && e.buttons ? [...row.children].find((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; }) : null;
      if (li && !li.hasAttribute("aria-current")) pick({ target: li });
    });
    this._pager.addEventListener("pointerup", () => { row = null; });
    this._pager.addEventListener("pointercancel", () => { row = null; });
    // Left and right move along a chart, and its one Tab stop moves along (see _rove).
    this._pager.addEventListener("keydown", (e) => {
      const li = e.target.closest?.(ROW), step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (li?.matches(HOUR) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(e); return; }
      const list = step && e.target.closest?.(ROVE), all = list ? [...list.querySelectorAll("[tabindex]")] : [], next = all[all.indexOf(e.target) + step];
      if (next) { e.preventDefault(); e.target.tabIndex = -1; next.tabIndex = 0; next.focus(); }
    });
  }

  // One Tab stop per chart or list, not one per hour, day or month: the picked one, else the first.
  // The arrows move it (see _wireWeek).
  _rove(page) {
    page.querySelectorAll(ROVE).forEach((list) => {
      const all = [...list.querySelectorAll("[tabindex]")], stop = all.find((c) => c.matches("[aria-current=true],[aria-pressed=true]")) ?? all[0];
      all.forEach((c) => { c.tabIndex = c === stop ? 0 : -1; });
    });
  }

  // Home Assistant's menu button is the only way out whenever its sidebar is not on screen:
  // on a narrow screen, or on any screen when the user chose to always hide the sidebar.
  // It gets hass only while shown (P20).
  _showMenu() {
    this._menu.hidden = !(this._narrow || this._hass?.dockedSidebar === "always_hidden");
    if (!this._menu.hidden && this._menu.hass !== this._hass) this._menu.hass = this._hass;
  }

  // Home Assistant passes the panel_custom entry here; its `config:` holds the owner's settings.
  set panel(p) { this._panel = p; this._next = 0; if (this._hass) this._loadSoon(); this._redraw(); }
  get panel() { return this._panel; }

  set narrow(v) { this._narrow = v; this._menu.narrow = v; this._showMenu(); }
  get narrow() { return this._narrow; }

  set hass(hass) {
    this._hass = hass;
    if (this._asleep()) { this._dirty = true; return; }
    this._showMenu();
    // A forecast the sensor just wrote is worked through at once, without asking the statistics again.
    if (this._stats && findForecast(hass)?.state !== this._seen) this._lookAhead();
    if (Date.now() >= this._next) this._loadSoon();
    this._render();
  }
  get hass() { return this._hass; }

  // Home Assistant sets hass and panel one after the other when the page opens: one load for both.
  _loadSoon() {
    if (this._soon) return;
    this._soon = true;
    queueMicrotask(() => { this._soon = false; if (!this._dropped) this._load(); });
  }

  // The forecast and what follows from it, with the level it is worked out at: when the statistics load and
  // when the sensor writes, not on every redraw (see predict).
  _lookAhead() {
    const hass = this._hass, { ids, cfg } = this._src, sensor = findForecast(hass);
    this._seen = sensor?.state;
    this._lookV++;
    this._looked = predict(hass, ids, cfg, this._stats, sensor, Date.now(), clockOf(hass.config?.time_zone));
  }
  // For the preview harness and anyone reading the element in the console.
  get _ahead() { return this._looked.ahead ?? null; }
  get _outlook() { return this._looked.outlook ?? null; }
  get _mode() { return this._looked.mode; }

  // Which entities to read (Energy settings plus config), then their totals from the statistics. Each call keeps
  // its answer for its own lifetime (see fetchStats): most loads ask only today's newest 5 minute rows. The
  // Energy settings are kept until a quarter past the hour, except while they are not set up.
  async _load() {
    const hass = this._hass, now = Date.now(), run = (this._run = (this._run || 0) + 1), clock = clockOf(hass.config?.time_zone);
    this._next = now + REFRESH_MS;
    const quarter = Math.floor(now / HOUR) * HOUR + 15 * MINUTE, until = quarter > now ? quarter : quarter + HOUR;
    try {
      let setup = this._setup && now < this._setup.until ? this._setup : null;
      if (!setup) {
        // "No prefs": the Energy page was never set up. The owner's config may still name entities.
        const [prefs, info] = await Promise.all([hass.callWS({ type: "energy/get_prefs" }).catch((e) => { if (e?.code === "not_found") return null; throw e; }),
          hass.callWS({ type: "energy/info" }).catch(() => ({}))]);
        // Not set up: asked again on the next load, so the page follows the owner setting it up.
        setup = { prefs, info, until: prefs ? until : 0 };
      }
      const src = readConfig(setup.prefs, this._panel?.config, setup.info?.cost_sensors), { ids, cfg } = src;
      // The skeleton takes its shape from the settings while the statistics load (see placeholder).
      if (!this._src && run === this._run) { this._src = src; this._render(); }
      const { rows, kept } = await fetchStats(hass, ids, cfg, this._kept ?? {}, now, clock);
      // `hass` and `panel` can each start a load: only the newest may answer, or entities read without
      // the config could land last.
      if (run !== this._run) return;
      this._setup = setup;
      this._src = src;
      this._kept = kept;
      // geo: the usual day's seasons (see usualDay).
      this._stats = totals(ids, cfg, rows, clock, now, [hass.config?.latitude, hass.config?.longitude]);
      this._statsV++;
      this._lookAhead();
      // Just after midnight "today" must start from zero.
      this._next = Math.min(this._next, now + this._stats.msToMidnight + 5e3);
      this._render();
    } catch (e) {
      if (run !== this._run) return; // an older load: the newest one keeps its own schedule
      console.warn("solar-view: loading the numbers failed", e);
      this._next = Date.now() + MINUTE; // try again in a minute, not in 5
    }
  }

  _render() {
    const hass = this._hass;
    if (!hass) return;
    if (this._asleep()) { this._dirty = true; return; }
    // This device's language (see LANGUAGE_KEY), else the viewer's, when its texts exist ("pt-BR", then
    // "pt"), else English. Numbers and dates follow that language either way.
    const locale = String(this._language || hass.locale?.language || hass.language || "en");
    const lang = [locale, locale.split("-")[0], "en"].find((l) => Object.hasOwn(LANGUAGES, l) && !failedLanguages.has(l));
    // Texts not loaded yet: the page stays as it is until they come, so texts and numbers change together.
    if (!STRINGS[lang]) { loadLanguage(lang).then(() => this._render()); return; }
    // Even the same value restyles the whole panel, and this runs on every state change in the house.
    if (this.getAttribute("lang") !== locale) this.setAttribute("lang", locale);
    const dark = !!hass.themes?.darkMode;
    // The texts, and the labels outside the pages, only again when the language or the config changes:
    // this runs on every state change in the house.
    if (this._lang !== lang || this._tConfig !== this._panel?.config) {
      this._lang = lang;
      this._tConfig = this._panel?.config;
      this._cfg = readConfig(null, this._panel?.config).cfg; // what the page needs before the Energy settings answer
      this._t = withOwnAdvice(STRINGS[lang], this._cfg, lang);
      this._tVersion++;
      learnGoIcons(STRINGS[lang].adviceGo);
      const t = this._t;
      this._pager.setAttribute("aria-label", t.pages);
      [t.tabNow, t.tabEnergy, t.tabMoney].forEach((label, i) => { this._tabs[i].lastChild.textContent = label; });
      this._gear.setAttribute("aria-label", t.gearLabel);
      this.shadowRoot.querySelectorAll("dialog [data-t]").forEach((el) => { el.textContent = t[el.dataset.t]; });
      // Automatic in this language (plain text where options are, see languagePicker), picked again so the
      // closed select's copy of it (selectedcontent) shows the new name.
      const pick = this._dialog.querySelector('select[name="language"]'), auto = pick.querySelector('option[value=""]');
      (auto.querySelector("span") ?? auto).textContent = t.languageAuto;
      pick.selectedIndex = -1;
      pick.value = this._language;
    }
    const t = this._t;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.toggleAttribute("dark", dark);

    // Three ways to have nothing to show. Still loading: the Energy settings or the statistics
    // have not answered, or Home Assistant is starting and the sensors are not there yet.
    // Not set up: no solar power sensor, or a required sensor that does not exist. Offline: every sensor
    // of a required kind exists but has no value. Drawing zeros instead would read as "battery empty".
    // An optional sensor never blanks the page (see requiredIds).
    const src = this._src, ids = src?.ids, kinds = ids ? requiredIds(ids) : [];
    const missing = kinds.flat().filter((id) => !hass.states[id]);
    const started = !hass.config || hass.config.state === "RUNNING";
    const setup = !!ids && (!ids.solarW.length || (missing.length > 0 && started));
    const silent = kinds.some((kind) => kind.every((id) => stateNum(hass, id) === null));
    if (ids && started) for (const id of optionalIds(ids)) if (!hass.states[id]) warnOnce(`${id} does not exist, so house use is worked out from the flows`);
    // While Home Assistant starts, sensors without a value are still loading, not offline.
    const loading = !setup && (!src || !this._stats || missing.length > 0 || (silent && !started));
    const offline = !loading && !setup && silent;
    // A message gets one plain page instead of the dashboard's rows and columns (see .pager.message).
    this._pager.classList.toggle("message", offline || setup);
    // The veil is a plain day sky over the real one. It fades out once there is data, so the
    // real sky colour arrives as a transition instead of a jump.
    this._paint("l", skyAt(30, false, dark).colors);
    this._pager.setAttribute("aria-busy", String(loading));
    this._pager.classList.toggle("skel", loading);
    // Placeholder numbers must not be read out as if they were real.
    // aria-hidden needs the value "true" (an empty one hides nothing); inert keeps focus out too.
    PAGES.forEach((p) => {
      $(p).inert = loading;
      if (loading) $(p).setAttribute("aria-hidden", "true"); else $(p).removeAttribute("aria-hidden");
    });
    if (offline || setup) {
      // Naming the missing sensors helps the owner; to anyone else they mean nothing.
      const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${line(body)}</svg>`;
      const message = offline ? `${icon(OFFLINE_ICON)}<h2>${t.offlineTitle}</h2><p>${t.offline}</p>`
        : `${icon(SETUP_ICON)}<h2>${t.setupTitle}</h2><p>${ids.solarW.length ? t.setupGone : t.setup}</p>
          <p class="lead">${t.setupLead}</p><ol class="path">${t.setupPath.split(" › ").map((s) => `<li>${s}</li>`).join("")}</ol><p>${t.setupEnd}</p>${
          missing.length && hass.user?.is_admin ? `<h3>${t.missing}</h3><ul class="ids">${missing.map((id) => `<li>${esc(id)}</li>`).join("")}</ul>` : ""}`;
      if (this._drawn === message) return;
      this._drawn = message;
      this.removeAttribute("ready");
      this._hint.classList.remove("on");
      this._rain.hidden = this._snow.hidden = true; // rain from a forecast nobody can see would only distract
      // Energy and Money have nothing to show: they and their tabs go, and Now comes into view at once, from
      // its top, even after a swipe to another page or a scroll down this one.
      const lost = PAGES.some((p) => $(p).contains(this.shadowRoot.activeElement));
      PAGES.forEach((p, i) => {
        $(p).innerHTML = p === "now" ? `<section class="card empty">${message}</section>` : "";
        $(p).hidden = this._tabs[i].hidden = p !== "now";
      });
      // Said once to a screen reader (the readings just went), and focus that was on them goes to the message.
      this._status.textContent = `${offline ? t.offlineTitle : t.setupTitle}. ${offline ? t.offline : ids.solarW.length ? t.setupGone : t.setup}`;
      const head = $("now").querySelector("h2");
      head.tabIndex = -1;
      if (lost) head.focus({ preventScroll: true });
      this._activatePage("now", true);
      $("now").scrollTop = this._pager.scrollTop = 0;
      this._html = {};
      this._built = {};
      this._skel.clear();
      this._skyKey = "";
      return;
    }

    // Loading draws the real markup from placeholder numbers and .skel greys it out, so the
    // skeleton has exactly the size of what replaces it.
    // A first visit draws nothing for up to a second, until the Energy settings answer (see _load): they say
    // which pages there are, and a skeleton without one would jump when it comes.
    // The copy kept last time is read once a visit, not on every update while loading (P18).
    if (this._last === undefined) this._last = remembered();
    if (loading && !src && !this._last && Date.now() < (this._holdUntil ??= Date.now() + 1000)) {
      this._held ??= setTimeout(() => this._render(), 1000);
      return;
    }
    // One read of the clock per render, handed to everything drawn (S21).
    const now = Date.now(), clock = clockOf(hass.config?.time_zone);
    const data = loading ? placeholder(hass, ids, src?.cfg, this._last, now) : readData(hass, ids, src.cfg, this._stats, this._looked, now);
    const day = this.testDay ?? Date.parse(clock(now).key) / DAY; // testDay: preview harness only (?day=)
    const cycle = hourCycle(this._cfg.timeFormat, hass.locale);
    const tz = hass.config?.time_zone, currency = hass.config?.currency || "EUR", fKey = [locale, currency, cycle, tz].join("|");
    if (this._fKey !== fKey) {
      this._fKey = fKey;
      this._f = formats(locale, currency, cycle, tz);
      this._clock = clock;
    }
    const f = this._f;
    this._drawn = ""; // no message on screen
    if (this._status.textContent) this._status.textContent = ""; // the error message, if one was said, is gone
    if (loading) this.removeAttribute("ready");
    else {
      // The skeleton's copy needs the shape, not every watt (see slim): kept once a load, with its first data (P10).
      if (this._saved !== this._stats) {
        this._saved = this._stats;
        this._last = slim(data);
        try { localStorage.setItem(LAST_KEY, JSON.stringify(this._last)); } catch (e) { /* storage is optional */ }
      }
      if (!this.hasAttribute("ready")) { // first real data: fade the veil out, let the content rise in
        this.setAttribute("ready", "");
        this._pager.classList.add("fresh");
        setTimeout(() => this._pager.classList.remove("fresh"), 900);
      }
    }

    // The display switches (see SHOW_KEY). Without the sun's height the sky goes straight from night to
    // day at sunrise, with no dawn or dusk: the colours of a high sun by day, of the deep night by night.
    const shown = (name) => this._show[name] !== false;
    const elevation = shown("sunHeight") ? data.sun.elevation : data.sun.elevation > 0 ? 90 : -90;
    const sky = skyAt(elevation, data.sun.dawn ?? data.sun.rising, dark, shown("clouds") ? data.weather.grey : 0);
    const skyKey = JSON.stringify([dark, this._show, data.sun, data.weather]);
    if (this._skyKey !== skyKey) {
      this._skyKey = skyKey;
      this._paint("sv-sky", sky.colors);
      // The first sky is set at once (read back, so the browser has it); from then on it glides, see :host([glide]) .sky.
      if (!this.hasAttribute("glide")) { getComputedStyle(this.shadowRoot.querySelector(".sky")).getPropertyValue("--sv-sky1"); this.setAttribute("glide", ""); }
      this._rain.hidden = !(data.weather.rain && shown("rain"));
      this._snow.hidden = !(data.weather.snow && shown("rain")); // the rain switch is for snow too
      this.style.setProperty("--glow", sky.colors[3]);
      this.style.setProperty("--stars", dark ? (0.7 * (1 - sky.up)).toFixed(2) : "0");
    }

    // The statistics and the forecast by their versions (bumped in _load and _lookAhead); while loading, the
    // skeleton's numbers whole.
    const base = [loading, fKey, this._tVersion, day, loading ? JSON.stringify(data) : `${this._statsV}|${this._lookV}`].join("|");
    const keys = pageKeys(data, { base, now, clock, sky });
    const c = { data, t, f, sky, loading, day, now, clock: this._clock, pick: this._pick };
    // A view is made when its page's key moves; the HTML only for a page in view, or one that shows something
    // older than this data could (never drawn, empty, or the skeleton), or one holding the focus; the others when
    // they come into view (P15).
    const fresh = PAGES.filter((p) => keys[p] !== this._keys[p]);
    // A panel not on a page has no view to go by (Home Assistant may set hass before it attaches it): all count.
    const focus = this.shadowRoot.activeElement, seen = (p) => !this.isConnected || !this._visible || this._visible.has(p) || p === this._force || $(p).contains(focus);
    const write = PAGES.filter((p) => this._built[p] !== keys[p] && (loading || seen(p) || !this._html[p] || this._skel.has(p)));
    const html = {};
    try {
      for (const p of fresh) {
        // Payback walks its months once per change of the numbers, not again for a month picked (P16).
        if (p === "money" && this._paybackKey !== keys.payback) { this._paybackKey = keys.payback; this._payback = paybackView(data, now, this._clock); }
        this._views[p] = p === "now" ? nowView(c) : p === "energy" ? energyView(c) : moneyView(c, this._payback);
        this._keys[p] = keys[p];
      }
      for (const p of write) {
        const v = this._views[p];
        html[p] = p === "now" ? nowPage(v, t, f, this._clock, now, loading) : p === "energy" ? energyPage(v, t, f, this._clock) : moneyPage(v, t, f);
      }
    } catch (e) {
      // Never a blank page: what is drawn stays. While loading the likely cause is a remembered
      // copy from an older version, so drop it and draw the typical numbers instead.
      console.error("solar-view: draw failed", e);
      this._keys = {};
      const had = !!this._last;
      this._last = null;
      try { localStorage.removeItem(LAST_KEY); } catch (e2) { /* no storage */ }
      if (loading && had) this._render();
      return;
    }
    // Only a page whose markup changed is written: the live values redraw Now alone, and a hint or focus on
    // another page stays. A written page has new elements: its hint goes (the sentence belonged to the old
    // numbers), and keyboard focus moves to the same control on it (see focusKey), or nowhere if it is gone.
    const changed = write.filter((p) => html[p] !== this._html[p]);
    const redrawn = (el) => !!el && changed.some((p) => $(p).contains(el));
    if (redrawn(this._hintFor)) this._hint.classList.remove("on");
    const active = this.shadowRoot.activeElement;
    const focusedPage = active ? changed.find((p) => $(p).contains(active)) : null;
    const focused = focusedPage ? focusKey($(focusedPage), active) : null;
    changed.forEach((p) => {
      $(p).innerHTML = html[p];
      this._rove($(p));
      // Each "?" named with its card's title, so a list of buttons tells them apart.
      $(p).querySelectorAll(".card > h2 + .help").forEach((b) => {
        const h = b.previousElementSibling;
        b.setAttribute("aria-label", `${t.helpTitle}: ${(h.querySelector("span") ?? h).textContent}`);
      });
    });
    for (const p of write) {
      this._html[p] = html[p];
      this._built[p] = keys[p];
      if (loading) this._skel.add(p); else this._skel.delete(p);
    }
    // Each card's help lines, from the views made now (S3).
    if (fresh.length) {
      for (const p of fresh) Object.assign(this._help, this._views[p].help);
      this._applyHelp();
    }
    // Pages come back after an error message; Money only with a card to show.
    PAGES.forEach((p, i) => { $(p).hidden = this._tabs[i].hidden = p === "money" && this._views.money.empty; });
    if (focused) focusTarget($(focusedPage), focused)?.focus({ preventScroll: true });
  }

  // Every page made and written again, whatever its key: a month picked, a new config.
  // `page`: the page acted on (a month picked on it), written now whether the pager reports it in view or not.
  _redraw(page = null) {
    this._drawn = ""; this._keys = {}; this._built = {};
    this._force = page;
    try { this._render(); } finally { this._force = null; }
  }

  // How to read each card leaves out the lines for marks it does not draw now (no forecast, no battery charge,
  // no export price, no weather): a line about a mark nobody can find only puzzles. Each view lists the help
  // lines its cards draw (`help`); a line is hidden when one of its texts is a help line its card does not draw.
  _applyHelp() {
    this.shadowRoot.querySelectorAll("dialog.read :is(li,.pair)").forEach((el) => {
      const drawn = this._help[el.closest("dialog").dataset.card];
      el.hidden = !!drawn && [...el.querySelectorAll("[data-t]")].some((x) => x.dataset.t.startsWith("help") && !drawn.includes(x.dataset.t));
    });
  }
}

// The sky's colours as colours, so they can glide (see .sky's transition). Registered for the whole page,
// as an @property inside a shadow root is ignored, under names nothing else in Home Assistant uses
// (window.CSS: CSS here is the stylesheet).
for (const i of [1, 2, 3]) try { window.CSS.registerProperty({ name: `--sv-sky${i}`, syntax: "<color>", inherits: false, initialValue: "transparent" }); } catch (e) { /* registered already, by an older copy of this file */ }

// A tab left open across an update loads the new version beside the old one: keep the old
// element until the page is refreshed instead of throwing.
if (!customElements.get("solar-view")) customElements.define("solar-view", SolarView);
export { STRINGS, LANGUAGES, loadLanguage, pageKeys }; // for the preview harness and the tests

/*
 * Most icons in solar-view.js are taken from Lucide (https://lucide.dev): sun, cloud, cloud-sun,
 * cloud-rain (drops slanted), cloud-snow, plug, plug-zap, zap, chart-column, coins,
 * circle-question-mark, washing-machine, cake, utensils, shirt, sparkle, smartphone-charging, wind,
 * wifi-off, move-left, move-right, triangle-alert and clock. The moon, battery, house, gear and tick
 * are drawn by this project.

 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * ---
 *
 * The Lucide icon clock is derived from the Feather project.
 *
 * The MIT License (MIT) (for the icons listed above)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
