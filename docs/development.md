# Development

There is no build step. The files in `dist/` are what Home Assistant loads, and what HACS downloads. HACS takes every file in that folder and its subfolders, so nothing else belongs there. `solar-view.js` stays at the top, because HACS looks for it by name (`hacs.json`).

## Files

`dist/` holds `solar-view.js` and three folders: `lib/`, `pages/` and `strings/`.

| File | What is in it |
|---|---|
| `solar-view.js` | The custom element: loading, the render, focus and hints. It loads every other file with its own `?v=`. |
| `lib/core.js` | Time, number and text helpers shared by all. |
| `lib/format.js` | Numbers, money, times and dates as the page writes them. |
| `lib/config.js` | The panel's `config:` and the Energy settings, read and checked (`readConfig`); the setup check. |
| `lib/stats.js` | The statistics calls (a fetch table with a lifetime per call) and their totals. |
| `lib/data.js` | What the page shows, as one object; the prediction level in use (`modeOf`); the skeleton's numbers. |
| `lib/forecast.js` | The day simulation, the forecast in use, "enough until" and the washer line. |
| `lib/advice.js` | The advice card's rules and the battery words. |
| `lib/money.js` | The money rules and payback. |
| `lib/sky.js` | The sky's colours, cloud and rain now, the sun's path. |
| `lib/draw.js` | Rings, charts and icons shared by the pages. |
| `lib/shell.js` | The frame: sky, gear, tabs, dialogs. |
| `lib/styles.js` | The stylesheet, as one string. |
| `pages/now.js`, `pages/energy.js`, `pages/money.js` | One per page: a view model of plain data, then its HTML. |
| `strings/en.js` | Every English text. Also the fallback: any key another language lacks reads in English. |
| `strings/it.js`, `strings/es.js`, ... | Every text of one language, loaded the first time it is on screen. |

Outside `dist/`:

| File | What is in it |
|---|---|
| `jsconfig.json` | Type checking with JSDoc, for development only (see [Checks](#checks)). |
| `preview/index.html` | The preview tool. |
| `preview/simulate-cases.json` | The day simulation cases: hours, battery and limits in, every hour's result out. A rule change goes into both the code and the cases. |
| `preview/home-days.json` | A real house's 2017, day by day, for the preview's past days. Built by `preview/home-days.py` from Open Power System Data's household data (house DE_KN_residential4 in Konstanz, about 11 kWp, CC BY 4.0, [doi:10.25832/household_data/2020-04-15](https://doi.org/10.25832/household_data/2020-04-15)). Scaled to about 6 kWp, with a 10 kWh battery simulated on its hours. Days whose solar hours copy another day's (10 to 13 May, 23 November, 25 November to 31 December) are the same dates of 2016, listed in `from_2016`. |
| `preview/home-hours.json` | The same house and battery, hour by hour. The drawer's "real" live values read it. |
| `preview/home-weather.json` | Konstanz's real weather in 2017, hour by hour (cloud cover, rain), from Open-Meteo's historical weather API (ERA5, CC BY 4.0). The file holds the URLs that rebuild it. |

## Preview tool

`preview/index.html` runs the real page against a fake Home Assistant, and checks it on every load. Today's numbers are made up per scenario; past days and months are the real house's. Serve the repository folder with any static web server:

```bash
npx serve -l 3000 .
```

Then open `http://127.0.0.1:3000/preview/`. Always use `/preview/?…` for a link with parameters. `npx serve` turns `/preview/index.html?…` into `/preview/` and drops the parameters.

### Scenarios

`?scenario=` picks one. Without it, `midday`.

| Scenario | What it is |
|---|---|
| `midday`, `full`, `dawn`, `dusk`, `night`, `evening` | Times of day; `full` has a full battery and spare sun. |
| `poor`, `fading`, `brightening`, `poorNoForecast` | The forecast advice: `wait`, `soon` (no battery), `later`, and the poor day without a forecast. |
| `winter` | Little sun, an almost empty battery, most of the day from the grid. |
| `nobattery` | Panels and a grid connection, no battery. |
| `nodata` | The Energy settings were never set up. |
| `offline` | The sensors exist but have no value. |
| `sunny`, `cloudy`, `rain` | With the mock forecast sensor, in that weather. |
| `stale` | The mock forecast sensor is 4 hours old, so the page builds its own forecast. |
| `firstDays` | No usual day yet and no sensor: no forecast at all. |
| `battUnknown` | A battery of unknown size. |
| `exportOffFull` | A zero-export inverter with a full battery: spare sun is lost. |
| `paidBack`, `paidBefore` | Payback done within the months on record, or before Home Assistant recorded. |
| `expanded` | A second solar meter whose rows start 2 days ago, as after adding an inverter. |
| `batteryExpiring` | A battery installed 9 years and 7 months ago: the battery warning shows. |

The forecast scenarios add a mock `sensor.solar_view_forecast`, written at the top of the present hour, so it is always fresh. The drawer leaves `sunny`, `cloudy`, `rain`, `dawn` and `dusk` out of its list: its weather list and time slider do the same.

### URL parameters

| Parameter | Values |
|---|---|
| `scenario` | See above. |
| `at` | The page's clock, for example `2026-11-09T09:30`. It keeps ticking from there. It also sets the sun's height, unless `elev` is given. Without it, the real clock. |
| `lang` | `en`, `it`, `es`, `fr`, `de`, `pt`, `nl`, `pl`. Without it, the browser's language. |
| `dark` | `0` or `1`. Without it, the system theme. |
| `text` | `1.5` or `2`: the panel as a phone app with text enlarged that much (2 is about the largest). |
| `page` | `now`, `energy` or `money`: opens on that page once the checks have run. |
| `shot` | `1` hides the tool's own button, for screenshots (see [Screenshots](screenshots.md)). |
| `visible` | `all`, `now` or `null`: every panel counts those pages in view, whatever its pager says. Use `all` when the browser tab is hidden. |
| `admin` | `0` views the page as a non-admin user. |
| `extras` | `0` removes prices, payback and forecast. |
| `payback` | `0` leaves out the payback settings. |
| `price` | `0` removes every price but keeps the payback settings (Payback then hides). |
| `display` | `name:0,name:0` turns those display switches off on this device. Names: `sunHeight`, `clouds`, `rain`. |
| `clock` | `24`, `12` or `language`: the viewer's time format in their profile. Without it, 24 hours. |
| `day` | Which advice line of the pool to show, as if it were day N. |
| `loading` | Seconds of loading skeleton before the numbers arrive. |
| `first` | `1` shows the skeleton of a first visit. |
| `gap` | `1` leaves holes in the fake statistics, as an inverter that was down: today's 1:00 and 2:00 and the 2nd of the month. |
| `check` | `skeleton` compares the loading skeleton with the loaded page. |
| `sweep` | `1` runs every combination of sensor values through the page. |

The drawer's own parameters (see below) also go in the URL: `fc`, `level`, `stale`, `weather`, `tariff`, `solar`, `battW`, `gridW`, `soc`, `elev`, `rising`, `real`, `battery`, `floor`, `exportOff`.

### The preview drawer

The round sliders button beside the gear opens a drawer that changes the page live, without a reload. A scenario is a preset: picking one fills the drawer, and what you change goes on top of it. Every change goes into the URL, only where it differs from the preset, so a link reproduces what you see.

| Group | What it sets | URL |
|---|---|---|
| Scenario | The preset. | `scenario` |
| Time | The clock of the whole preview, the panel's and the fake data's. Moving it also moves the sun (up from 7:00 to 18:00) and today's fake statistics. Past days are the real house's day of the same date in 2017. "real time" goes back to the real clock. | `at` |
| Data on record | What the fake Home Assistant has: `none` (no data), `usual_days` (past days' hours), `weather` (the mock sensor's sun and sky, no house use), `usual_days_weather` (past days' hours and a Solar Forecast). Then the panel's own `level`: `auto` (no key) or one of the four names, so a level whose data is missing can be tried. "sensor 4 h old" makes the sensor stale. The weather: `real` (Konstanz 2017), `sunny`, `cloudy`, `overcast`, `rain`, `snow`. The bands: `none`, `two`, `three` (the default). | `fc`, `level`, `stale=1`, `weather`, `tariff` |
| Live values | Solar, battery and grid power, battery charge, sun height and whether it is rising. House use is what they add up to. "real (Konstanz 2017)" takes them from that house at the same date and time; it turns on when a forecast is picked, and off when a slider moves. | `solar`, `battW`, `gridW`, `soc`, `elev`, `rising`, `real` |
| Battery | `known` (10 kWh), `unknown` (size unknown) or `none`; the floor; export off. | `battery`, `floor`, `exportOff=1` |
| View | Theme, language, page, the advice line's day, admin, text size and the display switches (the last two reload the page). | `dark`, `lang`, `page`, `day`, `admin`, `text`, `display` |

"run checks" reloads the page without `?sweep` or `?check`, so every check runs again with what the drawer says. "skeleton check" and "sweep (slow)" run those, and "loading 2s" replays the loading skeleton. The line at the bottom says what the panel made of it: the time, the level in use, where the forecast came from, the advice kind and the battery in an hour.

## Checks

Run all of these before a commit that changes `dist/`.

- **Unit tests:** `node --test test/` must end with 0 failures. The `test/` folder is not in git: it exists only in the maintainer's working copy.
- **Types:** `npx -p typescript@5.6.3 tsc -p jsconfig.json --noEmit` must give 0 errors. It checks the JSDoc types of `dist/`, non-strict.
- **Preview:** open `/preview/?at=2026-11-09T09:30` and then the real clock. The browser console must stay free of assertion failures. `window.failed` lists them too, for tools that cannot read the console.
- **Skeleton:** after any change to markup, CSS or text length, run `/preview/?check=skeleton` at phone width (375 x 812), also with `&text=1.5` and `&text=2`. It must log "0 differ": the loading skeleton has to sit where the loaded page puts things, so nothing jumps when the numbers arrive.
- **Words:** every load runs `wordCheck`. No word may break over two lines or stick out of its card. Try 375 x 812 with `?text=1.5` and `?text=2`, in Italian and German, on every page. `window.wordCheck()` runs it again in the console.
- **Sweep:** after a change to Now's words or rules, run `/preview/?sweep=1` alone in its tab. It takes three to four minutes and must end with "0 rule breaks, never seen: nothing".

The preview checks are `console.assert` calls in `preview/index.html`. Warnings that say "loading the numbers failed Error: check" come from the tool's own failure test and are expected.

What the load checks cover, besides the cards themselves:

- The day simulation against `preview/simulate-cases.json`, rounded to 3 decimals.
- Contrast: the marks on rings, the coming days' bars, the day and hour bars and the gear reach 3:1 against the lightest sky of each theme. Each ratio is logged as "contrast of the marks".
- The texts' loading: the first load fetches only `strings/en.js` and the guessed language's file. A language picked in the gear that is not loaded yet comes without a reload.
- Every language has every text, and every advice pool has its lines.

The sweep feeds the real page about 49,000 combinations of solar, battery and grid power, battery charge, sun height and forecast. It reads back what the page says and holds it against plain rules. Examples: "filling up with sun" needs sun; a battery at the floor is "Empty"; "enough until" shows the forecast's time; the washer line starts on a whole hour outside the quiet hours; no timing advice beside a washer line, and no advice line there that speaks of big loads (washer, oven, appliances); no "NaN" anywhere. The page then lists every outcome it saw with a count, anything it never saw, and the first combinations that break a rule. The values and the rules are at the end of `preview/index.html`. The preview's tabs share one browser storage, so do not run the sweep beside `?check=skeleton`.

## Testing a local copy in Home Assistant

To try your changes on a real Home Assistant beside the installed page:

1. Copy `dist/` to `config/www/<folder>/`, for example `config/www/solar-view-test/`.
2. Add a second `panel_custom` entry. Its `module_url` ends in `&name=` with the same name as `name:`, so the copy defines its own element. Two panels cannot share one element name: without it the copy defines `solar-view` again, which the installed page already holds, and the test panel stays blank with no error.

   ```yaml
   panel_custom:
     - name: solar-view-test
       url_path: solar-test
       sidebar_title: Solar test
       sidebar_icon: mdi:flask
       module_url: /local/solar-view-test/solar-view.js?v=1&name=solar-view-test
   ```

3. Restart Home Assistant fully.

For each new copy, raise `?v=` in its `module_url` and restart Home Assistant again. Clearing the app's cache is not enough: browsers and the phone app keep `/local/` files, and Home Assistant reads `module_url` only when it starts.

## Publishing

The repository has no releases, so HACS follows the latest commit on `main`. Every merge into `main` reaches every HACS install as an update. Run the checks before merging.

## Adding or fixing a language

Each language has its own file, `dist/strings/xx.js`, named by the language code. To add a language, copy `strings/en.js` to the new code's file, rename its `en` key to the code, and translate it.

- Every key of `en` must be there, and the language must have its own name in `LANGUAGES` (in `solar-view.js`). The gear lists it from there.
- An advice pool can have its own lines, two or more, except `adviceGo`. That one needs the same number of lines as in `en`, in the same order, since each line names the appliance its icon shows.
- A text must not contain a double quote, `<`, `>`, `&` or an em dash: some go into HTML attributes.
- Advice lines must fit two rows on a phone. Tab names and the labels under the icons must stay short.
- Many texts are fragments joined in code: `runOn` takes one of `src` as `{a}`, for example. Read how the pages use a key before you translate it.
- `untilOne` is extra: `until` for an end time at one o'clock, only where the language says it differently.

The preview checks every key, the advice lines and the characters on every load. Open it with `?lang=` set to your language, at `?text=2` too, and look at every page.

Italian was revised by a native speaker. The other translations were not. Dutch and Polish in particular have never been read by one.
