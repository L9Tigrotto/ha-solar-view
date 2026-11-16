/* The panel's frame: the shadow DOM's markup (sky, rain, snow, gear, pager, tab bar), the gear's dialog and
   the help dialogs ("How to read this"), and how much the browser enlarges text. */
const v = new URL(import.meta.url).search; // this file's own ?v=, so /local/ never serves a stale sibling
/** @type {typeof import("./draw.js")} */
const { battRing, sw, wxIcon } = await import(`./draw.js${v}`);

const PAGES = ["now", "energy", "money"];

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
// the flags and the spans, and each option keeps its name as plain text. `languages`: LANGUAGES of solar-view.js.
const languagePicker = (languages) => `<fieldset class="language"><legend id="language-title" data-t="language"></legend>
<select name="language" aria-labelledby="language-title"><button type="button"><selectedcontent></selectedcontent></button>${
  Object.entries({ "": "", ...languages }).map(([code, name]) => `<option value="${code}"><svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">${FLAG[code]}</svg><span>${name}</span></option>`).join("")}</select></fieldset>`;
// The display switches, grouped by the heading they go under (see SHOW_KEY in solar-view.js).
const SWITCHES = { showSky: ["sunHeight", "clouds", "rain"] };

// The tab bar's icons (24 x 24, drawn with the text colour).
const TAB_ICON = {
  now: `<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>`,
  energy: `<path d="M3 3v16a2 2 0 0 0 2 2h16m-3-4V9m-5 8V5M8 17v-3"/>`,
  money: `<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48M15 6h1v4"/><path d="m6.134 14.768l.866-.5l2 3.464"/><circle cx="16" cy="8" r="6"/>`,
};

// How to read each card: one line per mark, its drawing and its text. The battery's has its two
// example rings above the lines (see readDialog).
const READ = {
  battery: ["solid", "gain", "use", "low"].map((k) => [`<i class="${k}"></i>`, `help${k[0].toUpperCase() + k.slice(1)}`]),
  days: [[sw("pill", "--sun"), "helpDaysPill"], [sw("mark", "--ink"), "helpDaysUse"], [wxIcon("partly"), "helpDaysSky"]],
  daily: [[sw("solid", "--sun"), "helpProdMonths"], [sw("ghost", "--sun"), "helpProdEnd"], [sw("line", "--sun"), "helpWeekBar"], [sw("lineAhead", "--sun"), "helpProdAhead"],
    [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpWeekPick"]],
  share: [[sw("arc", "--sun"), "helpShareSun"], [sw("arc", "--batt"), "helpShareBatt"], [sw("arc", "--grid"), "helpShareGrid"],
    [`<b class="sw-num">%</b>`, "helpShareNum"], ["", "helpShareTotal"], ["", "helpShareAhead"]],
  recent: [[sw("line", "--sun"), "helpRecentBar"], ["", "helpRecentSold"], [sw("lineAhead", "--sun"), "helpRecentAhead"], [sw("hollow", "--sun"), "helpDayToday"], [sw("dotPick", "--sun"), "helpRecentPick"]],
  payback: [[sw("arc", "--sun"), "helpPaybackArc"], ["", "helpPaybackCost"], ["", "helpPaybackLeft"]],
  battday: [[sw("line", "--sun"), "helpBattDayBars"], [sw("lineAhead", "--sun"), "helpBattDayGhost"], [sw("line", "--batt"), "helpBattDayLine"], [sw("lineAhead", "--batt"), "helpBattDayAhead"], [sw("usual", "--low"), "helpBattDayFloor"], [sw("dotPick", "--batt"), "helpBattDayPick"]],
  table: [[sw("solid", "--batt"), "helpBalMonths"], [sw("ghost", "--batt"), "helpBalEnd"], [sw("arc", "--grid"), "helpBalSplit"], ["", "helpBalNet"]],
  prices: [[sw("buy", "--grid"), "helpPricesBuy"], ["", "helpPricesBands"], [sw("sell", "--sent"), "helpPricesSell"], ["", "helpPricesRates"]],
};

// The shadow root's markup: the stylesheet, the sky and its rain and snow, the gear, one empty section per
// page and the tab bar. Texts come later (see _render). The dialogs are added when first opened.
// Rain is a few drops at fixed places across the width, each started at another point of its fall.
const shellHtml = (css) => `<style>${css}</style>
<div class="sky"></div><div class="stars"></div><div class="rain" aria-hidden="true" hidden>${[[6, 0], [19, 1.3], [31, 0.6], [44, 1.9], [56, 0.3], [68, 1.6], [81, 0.9], [93, 2.1]]
  .map(([x, d]) => `<i style="left:${x}%;animation-delay:-${d}s"></i>`).join("")}</div><div class="snow" aria-hidden="true" hidden>${[[4, 4, 0, 8], [11, 3, 5.1, 9.5], [18, 5, 2.4, 7.5], [26, 3, 6.8, 10], [33, 6, 1.2, 8.5], [41, 4, 4.3, 9], [48, 3, 7.4, 7.8], [55, 5, 0.6, 9.8], [62, 4, 3.6, 8.2], [70, 3, 5.9, 10.2], [77, 6, 2.1, 8.8], [84, 4, 6.3, 7.6], [91, 3, 1.7, 9.2], [96, 5, 4.8, 8.4]]
  .map(([x, s, d, t]) => `<i style="left:${x}%;--s:${s}px;--t:${t}s;animation-delay:-${d}s"></i>`).join("")}</div><div class="veil"></div><div class="hint" aria-hidden="true"></div><div class="status" role="status"></div>
<button type="button" class="gear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6v4.6M12 17.8v4.6M1.6 12h4.6M17.8 12h4.6M4.6 4.6l3.3 3.3M16.1 16.1l3.3 3.3M4.6 19.4l3.3-3.3M16.1 7.9l3.3-3.3" stroke-width="3.4"/><circle cx="12" cy="12" r="5.9" stroke-width="3"/></svg></button>
<main class="pager">${PAGES.map((p) => `<section class="page ${p}" id="${p}"></section>`).join("")}</main>
<footer><ha-menu-button hidden></ha-menu-button><nav class="tabs">${PAGES.map((p) =>
  `<button type="button" data-page="${p}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICON[p]}</svg><span></span></button>`).join("")}</nav></footer>`;

// The gear's dialog: the display switches, the language, and for admins the setup check (see _fillCheck). Texts
// come later (see _dialogTexts).
const gearDialog = (languages) => `<dialog class="show" aria-labelledby="show-title"><form method="dialog"><h2 id="show-title" data-t="showTitle"></h2><p data-t="showNote"></p>
${Object.entries(SWITCHES).map(([group, names]) => `<fieldset><legend data-t="${group}"></legend>${names.map((n) =>
  `<label><span data-t="sw${n[0].toUpperCase() + n.slice(1)}"></span><input type="checkbox" role="switch" name="${n}"></label>`).join("")}</fieldset>`).join("")}
${languagePicker(languages)}
<fieldset class="check" hidden><legend data-t="chkTitle"></legend><dl></dl></fieldset>
<button data-t="showDone"></button></form></dialog>`;

// How to read one card, "" for a card without one.
const readDialog = (card) => (Object.hasOwn(READ, card) ? `<dialog class="read" data-card="${card}" aria-labelledby="read-${card}"><form method="dialog"><h2 id="read-${card}" data-t="helpTitle"></h2>
${card === "battery" ? `<div class="pair"><figure>${battRing(60, 75, "--batt", null, "")}<figcaption data-t="helpRise"></figcaption></figure>
<figure>${battRing(60, 45, "--batt", null, "")}<figcaption data-t="discharging"></figcaption></figure></div>` : ""}
<ul>${READ[card].map(([mark, key]) => `<li>${mark}<span data-t="${key}"></span></li>`).join("")}</ul>
<button data-t="helpClose"></button></form></dialog>` : "");

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
  const page = box.firstElementChild.getBoundingClientRect().width, chart = box.querySelector("text").getComputedTextLength();
  box.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [1, 1]; // no canvas (blocked): nothing to measure against
  ctx.font = font;
  const plain = ctx.measureText(word).width;
  if (!(plain > 0)) return [1, 1];
  // Small differences are font rounding, not a setting.
  return [page, chart].map((w) => (w / plain > 1.05 ? Math.round((w / plain) * 100) / 100 : 1));
}

export { PAGES, shellHtml, gearDialog, readDialog, textScale };
