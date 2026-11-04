# Setup guide

## Requirements

- Home Assistant with the Energy dashboard set up (Settings, Dashboards, Energy): solar panels and a grid connection, each **with its power sensor**.
- Optional: a battery with power sensor, state of charge and capacity.
- Optional: a price on the grid connection, for the money figures.
- Optional: a solar forecast linked to the solar panels, for the "wait for tomorrow" advice and ["enough until"](#enough-until).
- Optional: [HACS](https://hacs.xyz), to install and update in a few clicks. Without it, copy the files by hand.

Developed and tested on Home Assistant 2026.9. Power sensors in the Energy settings are a fairly recent addition. On an older version, name the sensors yourself under [`entities`](#options).

## Install with HACS

1. In HACS, open the three dots menu, **Custom repositories**. Add `https://github.com/L9Tigrotto/ha-solar-view` with the type **Dashboard**.
2. Search HACS for **Solar View** and download it. The files land in `config/www/community/ha-solar-view/`.
3. Add this to `configuration.yaml`:

   ```yaml
   panel_custom:
     - name: solar-view
       url_path: solar
       sidebar_title: Solar
       sidebar_icon: mdi:solar-power-variant
       module_url: /hacsfiles/ha-solar-view/solar-view.js
   ```

4. Restart Home Assistant (a full restart, not a YAML reload). "Solar" appears in the sidebar.

HACS may also list the file under Settings, Dashboards, Resources. The page is a panel, not a card, and does not need it there: you can delete that entry.

**Updating:** new versions show up in Settings, Updates. Install the update and reload the page. `/hacsfiles/` tells the browser not to cache, so nothing else is needed. On a phone, if the old page stays, close the app fully and reopen it.

## Install by hand

1. Copy the `dist` folder of this repository into `config/www/` and rename it to `solar-view`, so that you have `config/www/solar-view/solar-view.js` and every other file of `dist` beside it: `styles.js`, `forecast.js` and one `strings-xx.js` per language.
2. Add the `panel_custom` entry above, with `module_url: /local/solar-view/solar-view.js?v=1`.
3. Restart Home Assistant.

**Updating:** replace the files, raise the number after `?v=` in `module_url`, and restart Home Assistant.

The number matters. Files under `/local/` are cached hard by browsers and by the phone app. The main file loads the others with its own `?v=`, so one bump refreshes them all.

## How it gets its numbers

- Live values come from the power sensors named in the Energy settings.
- Hour, day and month totals come from the long-term statistics of the energy sensors named there.
- Prices and the solar forecast come from the same place, when they are set.
- Money of past months comes from the cost statistics Home Assistant keeps for a grid with a price (its own cost sensors, or the cost entity named in the Energy settings), so a new price leaves past months as they were. A month without them, from before prices were set, is counted at today's price. Saved has no statistic of its own: it is counted at the month's average grid price.

The page asks Home Assistant for today's 5 minute statistics every 5 minutes. Everything else (the Energy settings, the day, hour and month rows, the solar forecast) only changes when Home Assistant writes its hourly statistics, a little after each hour, so it is asked again a quarter past each hour.

### "Enough until"

While the battery powers the house and there is a forecast (the forecast sensor, or the solar forecast in the Energy settings with a usual day), the Now page says how long it will last. It does not divide what is left by the present draw: a quiet night at 150 W says nothing about the breakfast hour.

Instead it learns the usual day from the last 14 days of hourly statistics (change the number with [`usual_days`](#options)): how much the house uses, and how much sun there is, in each hour of the day. From now on it goes forward one hour at a time:

- The rest of the present hour counts by its minutes. At 6:30, half of the 6 o'clock hour is still to come. For that half hour the higher of the present draw and the usual one counts, so an oven switched on right now is not ignored.
- Every later hour takes what the house usually uses at that hour, minus the sun of that hour. The sun comes from the solar forecast when there is one for that day, otherwise from the usual day.
- If the battery reaches `battery_floor` first, the page shows that time, rounded to the half hour. If the sun covers the house first, it says the battery is enough until the sun takes over. If neither happens within 18 hours, it shows no time.

Without a forecast, or during the first three days after install (not enough history yet), there is no estimate: the battery card only says that the battery powers the house. A guess from the present draw would read as a promise.

Parts you do not have hide themselves: no battery, no state of charge, no price, no forecast, no export.

## Reading the page

With the forecast sensor (`sensor.solar_view_forecast`), the page also shows where the day and the month should end. A range is what is likely: most days land inside it, not all.

No numbers on record (the inverter, the power or the connection was down) never show as zeros: a day, an hour or a month without them keeps its place, empty, and says "no numbers on record".

- **Energy, power origin:** made, used, from the sun, from the battery, from the grid, and sent while export is on. Solid is so far. The faded column with a solid outline is where it should end by tonight, and the thin line with caps across its top runs from a low to a high day. On made and used, two dashed lines show a usual day of the last `usual_days`: what it had made or used by now, and its whole day. With no forecast and no usual day, the card shows a ring of where today's power came from (sun, battery, grid; its "?" has the colour key), the share from the sun and the battery in the middle and what the house used so far in the ring's gap, each source named beside its part, then each source's kWh so far under it (direct solar, battery, grid, and sent when something was).
- **Energy, today by hour:** today from midnight to 23:59, on two charts with one timeline, each with its own title and unit. On top, with a battery, the charge in % hour by hour so far and where it should go until midnight (dashes); the red dashed line is `battery_floor`. Under it, energy supply and use in kWh: a line each for what the sun made, what the house used and what came from the grid, a point an hour: solid for the hours done, dashed from there on as the forecast expects them. What is still to come is shaded, and a thin line marks now on both charts, named "Now" over the top one. Point at an hour on either chart (or move to it with the arrow keys) to see it on both, with its figures in a hint; click or tap it (or press Enter) to pick it: a dot marks it on each line, and its figures show under the charts (solar, home use, grid, and the battery's average charge; this hour's marked "so far"). An hour still to come says what the forecast expects in a sentence. A finger can drag across to pick; a mouse dragged with its button held picks nothing.
- **Energy, next hours:** this hour and the 5 after it: the sun likely in each, in kW, with its low to high line, and a cloud or rain from the forecast sensor.
- **Energy, coming days:** up to 7 days from tomorrow, from the forecast sensor only: the weather and a bar from the low to the high sun of the day in kWh, every day on one scale.
- **Energy, production:** a bar for each of the last 12 months, always January to December: each the latest of its name, so a month of last year gives way to this year's once it starts. Last year's months carry their year, this one "so far" and is picked at first; point at a month to see its total, click it to pick it. Under the bars the picked month's total, then its days as a line, a dot over each date, under the month's full name. Today, still under way, is a hollow dot; the last day is picked at first; tap, drag along or focus another day (the arrow keys move it) to give it the big dot and see its figures under the chart (solar, home use, grid, the self-supplied share, and export when there was any). A day with no numbers on record is a gap in the line; the days to come stay empty. The page reads a year of day rows for this; Home Assistant keeps all its history.
- **Best time for the washer:** two hours today or tomorrow when a load of about 1 kWh runs on sun that would otherwise be sent or lost, taking almost nothing from the grid or the battery. Shown only when there is such a time.
- **Money, payback:** with `system_cost` set, a ring of how much of the system's cost has come back since `install_date`, what came back in its middle and the cost in its gap ("Plant cost"), and about how long is left (only with a forecast or a usual day); once paid back, the month it happened and what came back since. Each coming month counts like the same month last year, or like an average month while there is less than a year on record (then the time left is a range).
- **Money, daily returns:** a line of what the system brought in each day of this month (saved and earned, without the bill's fixed part), a dot a day, and this month's total so far under it. Today is a hollow dot and picked at first; tap or drag along the line to see a day's returns, grid cost and net. A day nobody can price keeps its place, without a dot; a grid cost nobody can price leaves the net unknown too.
- **Money, electricity prices:** the price now of a kWh bought from the grid (Home ← Grid) and, while export is on, sold to it (Home → Grid): the forecast sensor's present hour when it is fresh, else the Energy settings' price. Its "?" explains both arrows.
- **Money, month balance:** each of the last 12 months' net benefit as a bar (up from the zero line, or down in red when the grid cost more), with the same months and labels as Production; the zero line sits as low as the months need, so the bars use the card's full height. Point at one to see its net, click it to pick it. Under the bars the picked month, this one at first: what the grid cost to the left of a middle line, what the sun and the battery saved plus what was sold to the right, on one scale, each with its figure, then saved, export (while export is on) and the net benefit (saved plus sold, less the grid cost; below zero in red, with a minus). With `bill_fixed` set, the cost and the net include the bill's fixed part. With the forecast sensor, this month also says where its net should end. A figure nobody can price, or a month with no numbers on record, says so.
- **Sky:** its colours follow the sun's height: night, dawn or dusk, then a day that keeps a little of the dawn or dusk colours while the sun is low and turns its deepest blue only with a high sun (50 degrees and up), so mornings, afternoons and winter days look warmer than a summer noon. The night mirrors it: a little of the dusk or dawn colours while the sun is just under the horizon, the darkest night only once it is 18 degrees down. Greyer the cloudier the forecast (from 50 percent cloud, fully grey at 90), and a few drops fall when it forecasts rain for this hour. Without a fresh sensor, the cloud is the `cloud_coverage` of a `weather` entity (what it sees now; not every weather integration has it), and rain follows that entity when it says it is raining. Snow falls whenever that entity says `snowy` (snow alone, which also stops the sensor's rain: it counts snow as rain) or `snowy-rainy` (snow and rain). The Rain and snow switch turns off both.
- With the sensor, "enough until" follows its forecast instead of the usual day.

Without the forecast sensor, the first days after install show less: no best time, and Energy's today card is a ring of where the house's power came from (sun, battery, grid) until there is a usual day. With no forecast at all it stays that ring. Without the sensor, or with one over 3 hours old, the page falls back to what it can build itself from the solar forecast in the Energy settings and the usual day: the same cards, but each with one value and no range (no low to high line, no "likely"), and no clouds or rain from it.

## Display settings

The gear at the top right opens "Show on this device": switches for how the sky looks (sun height, clouds, rain and snow), and the language of the page on this device (Automatic follows the Home Assistant profile). Cards hide themselves when they have nothing to show, so they have no switch. Each device keeps its own choice, so a wall tablet can show less than a phone. The choice is stored in the browser: clearing the site's data or storage turns everything back on.

With sun height off, the sky goes straight from night to day at sunrise, without dawn or dusk.

## Options

Everything is optional and goes under `config:` in the same `panel_custom` entry.

```yaml
panel_custom:
  - name: solar-view
    url_path: solar
    sidebar_title: Solar
    sidebar_icon: mdi:solar-power-variant
    module_url: /hacsfiles/ha-solar-view/solar-view.js
    config:
      battery_kwh: 10
      battery_floor: 20
      usual_days: 14
      time_format: 24
      system_cost: 9000
      install_date: "2025-03-15"
      saved_before: 0
      bill_fixed: sensor.bill_fixed
      entities:
        load_power: sensor.inverter_load_power
        load_energy: sensor.inverter_load_energy
```

| Option | Meaning | Default |
|---|---|---|
| `battery_kwh` | Battery size in kWh: the whole battery, not only the part above `battery_floor`. Used for "enough until", the hint on the battery bar and the cycle count. | The capacity in the Energy settings. Without either, those three are hidden. |
| `battery_floor` | Percent at which the inverter stops discharging. "Enough until" ends there, and the battery words count from it: "Empty" at the floor, "Low" up to 15 percent above it. | `20` |
| `usual_days` | How many past days make the usual day behind "enough until". Fewer adapt faster to a new routine, more give a steadier estimate. At least 3. | `14` |
| `time_format` | `24` or `12`: the clock for "enough until", for every user. | Each user's Time format in their Home Assistant profile, which by default follows their language. |
| `battery_max_charge_kw` | The most the battery takes in, in kW: the charging current times the charging voltage (40 A x 53.6 V is 2.1). Used by the forecast: spare sun beyond it goes to the grid or is lost. | No limit. |
| `export_max_kw` | The most the inverter sends to the grid, in kW. `0` on a zero-export inverter. Used by the forecast. | No limit. |
| `standby_w` | The inverter's own use in W. Left out of the savings and of the home made share. | Worked out from `load_energy` when it reads at least 1 kWh a day less than what flows in and out, else `0`. A value set here always wins. |
| `system_cost` | What the panels and battery cost, in your currency. Shows the payback card. | Not set: no payback card. |
| `install_date` | The day the system started, as `YYYY-MM-DD` (a day that does not exist, such as `2026-02-30`, is ignored). Payback counts from its month, as written, in any time zone. | The first month in the statistics. |
| `saved_before` | What the system saved before Home Assistant recorded it, added to payback. Months between `install_date` and the first month in the statistics count as nothing unless it is set. | `0` |
| `bill_fixed` | The id of a sensor holding the fixed part of the electricity bill a month (meter fee, standing charge), in your currency, with `state_class: measurement`. Added whole to every month's cost on Money, and so to the net. Change the sensor's value when the fixed part changes (a new operator, say): each month counts with the average it had that month, so past months stay as they were. Months older than the sensor take its first month's value. A plain number still works, but counts the same for every month. See [Prices and fixed costs](#prices-and-fixed-costs). | `0` |
| `entities` | Replace what the Energy settings say, or add what they cannot know. One entity id or a list. An empty list switches that part off. | The Energy settings. |
| `advice`, `advice_replace` | Your own advice lines, see below. | Built-in lines only. |

## Prices and fixed costs

Prices and the bill's fixed part change from month to month, so they are not in the config: they live in Home Assistant, which keeps their history.

- **Prices:** set them on the grid connection in the Energy settings, as an entity that holds the price per kWh. Home Assistant then records what each kWh cost when it was used, and the page reads that. A fixed number there works too, but every month is then counted at it.
- **Fixed part:** a sensor named by `bill_fixed`. The simplest is a number helper (Settings > Devices & services > Helpers > Create helper > Number, unit `EUR`, in your currency) and a template sensor that copies it with `state_class: measurement`, so Home Assistant keeps its monthly average:

```yaml
template:
  - sensor:
      - name: Bill fixed
        unique_id: bill_fixed
        unit_of_measurement: "EUR"
        state_class: measurement
        state: "{{ states('input_number.bill_fixed') | float(0) }}"
```

Names under `entities`:

| Name | What it is |
|---|---|
| `solar_power`, `battery_power`, `grid_power` | Live power in W or kW. Battery is positive when discharging, grid is positive when importing. |
| `battery_soc` | Battery state of charge in percent. |
| `solar_energy`, `battery_out_energy`, `battery_in_energy`, `grid_in_energy`, `grid_out_energy` | Energy sensors that have long-term statistics. |
| `grid_cost`, `grid_compensation` | What the grid cost and paid in your currency, as sensors with long-term statistics. By default the cost entities of the Energy settings, or the cost sensors Home Assistant makes for a grid with a price. |
| `load_power`, `load_energy` | House consumption, live and as energy. Not part of the Energy settings. |

### House consumption

Without `load_power` and `load_energy`, the page works house consumption out as solar plus battery plus grid. That counts the inverter's own losses as house use, so it can read somewhat higher than the figure on the inverter's display. If your inverter has its own load sensors, name them.

## Your own advice lines

The advice card picks one line per day from a pool that fits the situation. Add lines of your own, per language, without touching the files:

```yaml
config:
  advice_replace: false
  advice:
    en:
      go:
        - "Sun to spare: time for the dishwasher"
      okNight:
        - "Good night, the house has all it needs"
```

| Pool | When |
|---|---|
| `go` | There is spare sun right now: 1000 W more than the house uses while the battery is nearly full (or there is no battery), or the battery is nearly full and the rest goes to the grid. Each built-in line names one appliance and shows its icon; your own lines show the washing machine. |
| `goFull` | Spare sun, and the battery is full (100 percent). These lines come before the `go` ones. |
| `soon` | Spare sun now, but the forecast says it fades within 3 hours. Only without a battery: a nearly full one carries the cycle. Needs a solar forecast. |
| `later` | No spare sun now, but the forecast says clearly more within 3 hours. Needs a solar forecast. |
| `low` | Battery low (less than 16 percent above `battery_floor`) and no sun. |
| `empty` | Battery at `battery_floor` and no sun. |
| `wait` | Little sun forecast today, clearly more tomorrow. Needs a solar forecast that covers tomorrow. |
| `ok` | Nothing to do, by day. |
| `okNight` | Nothing to do, by night. |
| `okFull` | Nothing to do, by day, and the battery is nearly or fully charged. |
| `okRefill` | Battery low, but the sun (not the grid) is charging it. |
| `short` | Instead of `ok` or `okNight`, in the evening or at night: the battery carries the house, but the forecast says it runs out before the sun takes over. Needs the forecast sensor or a usual day. |
| `okLasts` | Instead of `ok` or `okNight`, in the evening or at night: the battery carries the house, and the forecast says it lasts until the sun takes over. Needs the forecast sensor or a usual day. |
| `fills` | Instead of `ok`, by day: the forecast says the battery fills later today, and 1 kWh or more of spare sun then goes to the grid or is lost. Needs the forecast sensor or a usual day. |

With `advice_replace: true`, a pool that has lines of yours shows only those. Keep a line short enough for two rows on a phone.

## Who sees what

Every user sees Now, Energy and Money in the language and time format of their profile, unless they pick another language in the gear (that changes the language only, not the clock). Only admin users see the names of missing sensors in the setup message. That is tidiness, not security: the sensors are readable by any user anyway.

## Troubleshooting

| What you see | What it means |
|---|---|
| "Let's set up the solar panels" | The Energy settings have no solar power sensor, or a named sensor does not exist. Admin users also see the names of the missing sensors under "Sensors not found". |
| "Inverter not reachable" | The sensors exist but have no value right now. It clears by itself. |
| No "enough until" on the battery card | The battery is charging or resting, the end is less than half an hour or more than 18 hours away, there is no battery size (`battery_kwh`), or there is no forecast. |
| A grey loading skeleton that stays | Home Assistant is still starting, or the statistics have not answered. |
| The old page after an update | Installed by hand: raise `?v=` and restart. On a phone, close the app fully and reopen it. |

## Known limits

- Statistics only reach back to when Home Assistant started recording a sensor, so "last month" is incomplete during the first weeks. To see a system's earlier years, import its history (most inverter apps export a CSV) into the same sensors' long-term statistics, for example with the Import Statistics integration from HACS: every card reads the statistics, so they fill in by themselves. The imported running total must meet the first value Home Assistant recorded, or the day they meet shows a huge spike.
- Today's totals come from the 5 minute statistics and can lag a few minutes.
- "Enough until" knows the usual day, not today's plans: a washing machine started later than usual is only counted once it is running. Weekdays and weekends share one usual day. It assumes the battery alone carries the house.
- If one of several named sensors has no value, the whole page shows the "not answering" message.
- A house with neither a battery nor a grid power sensor reads "using energy from the panels" at night, because every flow is zero.
- The thresholds behind the advice (for example 1000 W of spare sun) are constants at the top of `solar-view.js`, not options.
- Tested in desktop browsers and in the Android companion app. Not tested on iOS.

## Privacy

The page talks only to your own Home Assistant. It remembers the last numbers it showed in the browser's `localStorage` (key `solar-view-last`), so the loading skeleton has the right shape next time. The display settings are kept there too (key `solar-view-show`). Nothing leaves the device.

The files are served without login, under `/hacsfiles/` or `/local/`, like everything in `config/www`. They contain code only, never your data. Do not put secrets in them.
