# Setup guide

## Requirements

- Home Assistant with the Energy dashboard set up (Settings, Dashboards, Energy): solar panels and a grid connection, each **with its power sensor**.
- Optional: a battery with power sensor, state of charge and capacity.
- Optional: a price on the grid connection, for the money figures.
- Optional: a solar forecast linked to the solar panels, for the "wait for tomorrow" advice and a better ["enough until"](#enough-until).
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

1. Copy the `dist` folder of this repository into `config/www/` and rename it to `solar-view`, so that you have `config/www/solar-view/solar-view.js`, `strings.js` and `styles.js`.
2. Add the `panel_custom` entry above, with `module_url: /local/solar-view/solar-view.js?v=1`.
3. Restart Home Assistant.

**Updating:** replace the three files, raise the number after `?v=` in `module_url`, and restart Home Assistant.

The number matters. Files under `/local/` are cached hard by browsers and by the phone app. The main file loads the other two with its own `?v=`, so one bump refreshes all three.

## How it gets its numbers

- Live values come from the power sensors named in the Energy settings.
- Day, week and month totals come from the long-term statistics of the energy sensors named there.
- Prices and the solar forecast come from the same place, when they are set.

### "Enough until"

While the battery powers the house, the Now page says how long it will last. It does not divide what is left by the present draw: a quiet night at 150 W says nothing about the breakfast hour.

Instead it learns the usual day from the last 14 days of hourly statistics: how much the house uses, and how much sun there is, in each hour of the day. From now on it goes forward one hour at a time:

- The rest of the present hour counts by its minutes. At 6:30, half of the 6 o'clock hour is still to come. For that half hour the higher of the present draw and the usual one counts, so an oven switched on right now is not ignored.
- Every later hour takes what the house usually uses at that hour, minus the sun of that hour. The sun comes from the solar forecast when there is one for that day, otherwise from the usual day.
- If the battery reaches `battery_floor` first, the page shows that time, rounded to the half hour. If the sun covers the house first, it says the battery is enough until the sun takes over. If neither happens within 18 hours, it shows no time.

During the first three days after install there is not enough history yet, and the page uses the present draw as before.

Parts you do not have hide themselves: no battery, no state of charge, no price, no forecast, no export.

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
      battery_floor: 10
      time_format: 24
      price_buy: 0.30
      price_sell: input_number.sell_price
      entities:
        load_power: sensor.inverter_load_power
        load_energy: sensor.inverter_load_energy
```

| Option | Meaning | Default |
|---|---|---|
| `battery_kwh` | Usable battery size in kWh. Used for "enough until", the hint on the battery bar and the cycle count. | The capacity in the Energy settings. Without either, those three are hidden. |
| `battery_floor` | Percent at which the inverter stops discharging. | `10` |
| `time_format` | `24` or `12`: the clock for "enough until", for every user. | Each user's Time format in their Home Assistant profile, which by default follows their language. |
| `price_buy`, `price_sell` | Price per kWh bought and sold: a number, or the id of an entity that holds one. | The prices on the grid connection in the Energy settings. |
| `entities` | Replace what the Energy settings say, or add what they cannot know. One entity id or a list. An empty list switches that part off. | The Energy settings. |
| `advice`, `advice_replace` | Your own advice lines, see below. | Built-in lines only. |

Names under `entities`:

| Name | What it is |
|---|---|
| `solar_power`, `battery_power`, `grid_power` | Live power in W or kW. Battery is positive when discharging, grid is positive when importing. |
| `battery_soc` | Battery state of charge in percent. |
| `solar_energy`, `battery_out_energy`, `battery_in_energy`, `grid_in_energy`, `grid_out_energy` | Energy sensors that have long-term statistics. |
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
| `go` | There is spare sun right now. |
| `goFull` | Spare sun, and the battery is nearly or fully charged. |
| `low` | Battery low and no sun. |
| `empty` | Battery at 0 and no sun. |
| `wait` | Little sun forecast today, clearly more tomorrow. Needs a solar forecast. |
| `ok` | Nothing to do, by day. |
| `okNight` | Nothing to do, by night. |
| `okFull` | Nothing to do, and the battery is nearly or fully charged. |
| `okRefill` | Battery low, but the sun is charging it. |

With `advice_replace: true`, a pool that has lines of yours shows only those. Keep a line short enough for two rows on a phone.

## Who sees what

Every user sees Now, Today and Past days in the language and time format of their profile. The Info page is shown to admin users only. That is tidiness, not security: the sensors behind it are readable by any user anyway.

## Troubleshooting

| What you see | What it means |
|---|---|
| "Nothing to show yet..." | The Energy settings have no solar power sensor, or a named sensor does not exist. Admin users also see the names of the missing sensors. |
| "The inverter is not answering..." | The sensors exist but have no value right now. It clears by itself. |
| No "enough until" on the battery card | The battery is charging or resting, the end is less than half an hour or more than 18 hours away, or there is no battery size (`battery_kwh`). |
| A grey loading skeleton that stays | Home Assistant is still starting, or the statistics have not answered. |
| The old page after an update | Installed by hand: raise `?v=` and restart. On a phone, close the app fully and reopen it. |

## Known limits

- Statistics only reach back to when Home Assistant started recording a sensor, so "last month" is incomplete during the first weeks. The per-day comparison only counts days that have data.
- Today's totals come from the 5 minute statistics and can lag a few minutes.
- "Enough until" knows the usual day, not today's plans: a washing machine started later than usual is only counted once it is running. Weekdays and weekends share one usual day. It assumes the battery alone carries the house.
- If one of several named sensors has no value, the whole page shows the "not answering" message.
- A house with neither a battery nor a grid power sensor reads "running on the sun" at night, because every flow is zero.
- The thresholds behind the advice (for example 1000 W of spare sun) are constants at the top of `solar-view.js`, not options.
- Tested in desktop browsers and in the Android companion app. Not tested on iOS.

## Privacy

The page talks only to your own Home Assistant. It remembers the last numbers it showed in the browser's `localStorage` (key `solar-view-last`), so the loading skeleton has the right shape next time. Nothing leaves the device.

The three files are served without login, under `/hacsfiles/` or `/local/`, like everything in `config/www`. They contain code only, never your data. Do not put secrets in them.
