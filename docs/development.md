# Development

There is no build step. The files in `dist/` are what Home Assistant loads, and what HACS downloads: it takes every file in that folder and its subfolders, so nothing else belongs there. `solar-view.js` stays at the top (HACS looks for it by name); the rest is in `lib/`, `pages/` and `strings/`.

| File | What is in it |
|---|---|
| `solar-view.js` | Rules, logic, data loading, drawing, the custom element. |
| `strings/en.js` | Every English text. Also the fallback: any key another language lacks reads in English. |
| `strings/it.js`, `strings/es.js`, ... | Every text of one language. The panel loads English, plus the language on screen when it is first shown (see `loadLanguage` in `solar-view.js`). |
| `lib/styles.js` | The stylesheet, as one string. |
| `lib/forecast.js` | The day simulation and what the page derives from the forecast. Plain functions, no imports. |
| `preview/simulate-cases.json` | Not in `dist/`: the day simulation cases, shared with the integration's Python test (see Checks). |
| `preview/home-days.json` | Not in `dist/`: a real house's 2017, day by day, for the preview's past days. Built by `preview/home-days.py` from Open Power System Data's household data (house DE_KN_residential4 in Konstanz, about 11 kWp, CC BY 4.0, [doi:10.25832/household_data/2020-04-15](https://doi.org/10.25832/household_data/2020-04-15)), scaled to about 6 kWp (sun and use alike) and with a 10 kWh battery simulated on its hours, as the house had none. Days whose PV hours copy another day's (10 to 13 May, 23 November and 25 November to 31 December) are the same dates of 2016, listed in `from_2016`. |
| `preview/home-hours.json` | Not in `dist/`: the same house and simulated battery as `home-days.json`, hour by hour (sun and use in kWh, the battery's charge in % at the end of each hour, 24 slots a day), written by `preview/home-days.py` as its second file. The drawer's "real" live values read it. |
| `preview/home-weather.json` | Not in `dist/`: Konstanz's real weather in 2017, hour by hour (cloud cover %, rain mm), from Open-Meteo's historical weather API (ERA5, CC BY 4.0); the file holds the URLs that rebuild it. The days `home-days.json` takes from 2016 (`from_2016`) hold 2016's weather. With the drawer's weather on "real" (the default when the drawer switches a forecast on), the forecast sensor's days to come and hours are that house's sun and this weather on the same dates. |

## Preview tool

`preview/index.html` runs the real page against a fake Home Assistant, and checks it on every load. Today's numbers are made up per scenario; past days and months are a real house's (see `preview/home-days.json`). Serve the repository folder with any static web server, for example:

```bash
npx serve .
```

Then open `/preview/`.

| Parameter | Values |
|---|---|
| `scenario` | `midday`, `full`, `dawn`, `dusk`, `night`, `evening`, `poor`, `fading`, `brightening`, `poorNoForecast`, `winter` (little sun, most of the day from the grid), `nobattery`, `nodata`, `offline`, `firstDays`, `expanded` (a second solar meter whose rows start 2 days ago, as after adding an inverter), and with the mock forecast sensor (see below) `sunny`, `cloudy`, `rain`, `stale`, `battUnknown`, `exportOffFull` |
| `lang` | `en`, `it`, `es`, `fr`, `de`, `pt`, `nl`, `pl` |
| `dark` | `0` or `1` |
| `admin` | `0` views the page as a non-admin user (no sensor names in the setup message) |
| `extras` | `0` removes prices and forecast |
| `loading` | seconds of loading skeleton before the numbers arrive |
| `first` | `1` shows the skeleton of a first visit |
| `day` | which advice line of the pool to show |
| `page` | `now`, `energy` or `money`: open on that page |
| `shot` | `1` hides the tool's own controls (the drawer, see below), for screenshots |
| `check` | `skeleton` compares the loading skeleton with the loaded page |
| `sweep` | `1` runs every combination of sensor values through the page, see below |
| `display` | `name:0,name:0` turns those display switches off on this device, as the gear would. Names: `sunHeight`, `clouds`, `rain`. Without it every switch is on. |
| `clock` | `24`, `12` or `language`: the viewer's Time format in their Home Assistant profile (without it, 24 hours) |
| `gap` | `1` leaves holes in the fake statistics, as an inverter that was down: today's 1:00 and 2:00 and the 2nd of the month have no rows |

The forecast scenarios add a mock `sensor.solar_view_forecast`, written at the top of the present hour, so it is always fresh: `sunny`, `cloudy` (grey sky) and `rain` name its weather; `stale` makes it 4 hours old, so the page builds its own; `battUnknown` has a battery of unknown size; `exportOffFull` is a zero-export inverter with a full battery, so spare sun is lost. `firstDays` has no sensor and no usual day yet, so there is no forecast at all.

### The preview drawer

The round sliders button beside the gear opens a drawer that changes the page live, without a reload. A scenario is a preset: picking one fills the drawer, and what you change goes on top of it. Every change goes into the URL, only where it differs from the preset, so a link reproduces what you see.

| Group | What it sets | URL |
|---|---|---|
| Time | The clock of the whole preview page, the panel's and the fake data's: it keeps ticking from the date and time you pick. Moving it also moves the sun's height (up from 7:00 to 18:00) and today's fake statistics: each part follows a day profile (sun from 7:00 to 18:00, the battery giving at night, the house more in the evening), a scenario's totals are the day's at 15:00, and the charge line runs back from the live charge. Past days are the real house's day of the same date in 2017 (29 February takes 1 March), and each month row is that month's days summed. "real time" goes back to the real clock. | `at=2026-10-25T11:00` |
| Forecast | The prediction mode; each predicts all it can. Off (`none`: no sensor, no usual day), Usual day (`usual`: the page's own from past days, no Solar Forecast), Weather (`weather`: the mock sensor's sun, cloud and rain, house use null as the service writes it when switched off), Usual day + weather (`usualWeather`: the usual day with a Solar Forecast in the Energy settings, following the mock's sun and weather), Learned + weather (`learned`: the full mock sensor, sun, house use and prices); hover an option for the same. "sensor 4 h old" makes a sensor mode's sensor stale, so the page falls back to the usual day. The weather: clear, partly cloudy (80 % cloud), overcast (95 %), rain (the present hour); without the sensor it is the weather entity, as clear (5 % cloud), partly cloudy (70 %) or cloudy (95 %). The tariff's bands, three by default even on a preset without a tariff. | `fc`, `stale=1`, `weather`, `tariff` |
| Live values | Solar, battery and grid power, battery charge, sun height and whether it is rising. House use is what they add up to. "real (Konstanz 2017)" takes the first four, today's numbers, the battery's charge line and the usual day's hours from that house at the same date and time (`preview/home-hours.json`): on when a forecast is picked, off when a slider moves. The scenarios the checks use keep their fixed values. | `solar`, `battW`, `gridW`, `soc`, `elev`, `rising`, `real` |
| Battery | 10 kWh, size unknown, or no battery; the floor; export off (`export_max_kw: 0`). | `battery`, `floor`, `exportOff=1` |
| View | Theme, language, page, the advice line's day, admin, and the display switches (these reload the page). | `dark`, `lang`, `page`, `day`, `admin`, `display` |

"run checks" reloads the page without `?sweep` or `?check`, so every check runs again with what the drawer says (the time included: the checks pass at any time of day, the repeated hour of the night the clocks go back too). "skeleton check" and "sweep (slow)" run those (the sweep keeps the page busy for about two minutes, and a reload of its URL runs it again), "loading 2s" replays the loading skeleton. The line at the bottom says what the panel made of it: the time, where the forecast came from, the advice kind and the battery in an hour.

## Checks

The checks are `console.assert` calls in the preview page. The browser console must stay free of assertion failures; `window.failed` lists them too, for tools that cannot read the console.

Warnings that say "loading the numbers failed Error: check" come from the tool's own failure test and are expected.

The day simulation is checked against `preview/simulate-cases.json`: hours, battery and limits in, every hour's result out, rounded to 3 decimals. The integration's Python test will run the same file, so a rule change goes into both the code and the cases.

"Enough until" comes only from the outlook: a scenario without a forecast shows none, and the checks that need one give the scenario the mock forecast sensor.

`?sweep=1` feeds the real page about 49,000 combinations of solar, battery and grid power, battery charge, sun height and forecast (the mock forecast sensor among them, also with the clock held at 11:00 and 21:00 today, so the outlook's advice and the battery in an hour show at any time of the sweep), reads back what the page says, and holds it against plain rules ("filling up with sun" needs sun, a battery at the floor is "Empty", "enough until" shows the forecast's time, and none while the forecast says the battery never reaches the floor, the washer's line says what the outlook gives, with a start today or tomorrow on a whole hour outside the quiet hours, `short` only with an end time and `okLasts` only with "until the sun takes over", `fills` only by day with an outlook that fills the battery, the battery in an hour rises in green and falls in red and never at the floor, no "NaN" on Now, Energy or Money, and so on). It takes about two minutes; the preview's tabs share one browser storage, so run it alone, not beside `?check=skeleton`; `window.sweep.ms` has the time per forecast. The page then lists every outcome it saw with a count, anything it never saw, and the first combinations that break a rule. It must end with "0 rule breaks, never seen: nothing". The values and the rules are at the end of `preview/index.html`. Some combinations cannot happen in a real house; they are swept anyway.

Every load also checks that the marks on rings (the power origin rings too), the coming days' pills, the day and hour bars and the gear reach 3:1 contrast against the lightest sky of each theme, and logs each ratio as "contrast of the marks".

Every load also checks the texts' loading: the first load fetches only `strings/en.js` and the guessed language's file (the gear's choice, else the page's `lang`, which the preview sets from `?lang=` as Home Assistant does from the profile), and a language the gear picks that is not loaded yet comes without a reload, with its numbers, its go icons and the owner's own lines. A file that fails to load (the panel then stays English) is not checked: rename one in `dist/` by hand to try it.

`?check=skeleton` must log "0 differ": the loading skeleton has to sit exactly where the loaded page puts things, so nothing jumps when the numbers arrive. Run it after any change to markup, CSS or text length, at phone width.

## Publishing

The repository has no releases, so HACS follows the latest commit on `main`: every merge into `main` reaches every HACS install as an update. Run the preview checks before merging.

## Adding or fixing a language

Each language has its own file, `dist/strings/xx.js`, named by the language code. To add a language, copy `strings/en.js` to the new code's file, rename its `en` key to the code, and translate it.

- Every key of `en` must be there, and the language its own name in `LANGUAGES` (in `solar-view.js`), which the gear lists and the preview checks.
- An advice pool can have its own lines, two or more, except `adviceGo`: the same number as in `en`, in the same order, since each line names the appliance its icon shows.
- A text must not contain a double quote, `<`, `>` or `&`: some go into HTML attributes.
- Advice lines must fit two rows on a phone. Tab names and the labels under the icons must stay short.
- Many texts are fragments joined in code (`runOn` with `src` and `and`, for example). Read how `solar-view.js` uses a key before translating it.

The preview checks the first three on every load. Open it with `?lang=` set to your language and look at every page.

Italian was revised by a native speaker. The other translations were not, and Dutch and Polish in particular have never been read by one.
