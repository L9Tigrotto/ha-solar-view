# Setup guide

This guide is for the person who installs the page. The people who read it need no guide: each card has a "?" button that explains it in their language. How each figure is worked out is in [How it works](how-it-works.md).

## What you need

- Home Assistant with the Energy dashboard set up (Settings, Dashboards, Energy), with a **power sensor for the solar panels**.
- Optional, and each turns on more of the page:
  - a grid connection with its power sensor;
  - a battery with its power sensor, its state of charge and its capacity;
  - a price on the grid connection, for the Money page;
  - a solar forecast linked to the solar panels (Forecast.Solar or Open-Meteo Solar Forecast, for example), for the coming days and the "wait" advice.
- Optional: [HACS](https://hacs.xyz), to install and update in a few clicks. Without it, copy the files by hand.

Developed and tested on Home Assistant 2026.9. Power sensors in the Energy settings are a fairly recent addition. On an older version, name the sensors yourself under [`sensors`](#sensors).

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

4. Restart Home Assistant. "Solar" appears in the sidebar.

HACS may also list the file under Settings, Dashboards, Resources. The page is a panel, not a card, and does not need it there: you can delete that entry.

**Updating:** new versions show up in Settings, Updates. Install the update and reload the page. On a phone, if the old page stays, close the app fully and open it again.

## Install by hand

1. Copy the `custom_components/solar_view/frontend` folder of this repository into `config/www/` and rename it to `solar-view`. You then have `config/www/solar-view/solar-view.js` with the folders `lib/`, `pages/` and `strings/` beside it.
2. Add the `panel_custom` entry above, with `module_url: /local/solar-view/solar-view.js?v=1`.
3. Restart Home Assistant.

**Updating:** replace the files, raise the number after `?v=` in `module_url`, and restart Home Assistant.

The number matters. Browsers and the phone app keep files under `/local/` for a long time. The main file loads all the others with its own `?v=`, so one new number refreshes them all.

## Every change needs a restart

Home Assistant reads `panel_custom` only when it starts. After **every** change under `config:` (or to `module_url`), do a full restart: Settings, System, the power button, Restart Home Assistant. A YAML reload is not enough, and neither is clearing the app's cache.

## What shows, and what it needs

The page hides what it cannot fill. Nothing shows as a zero that is really "unknown".

| Part of the page | Needs | Set it in |
|---|---|---|
| Now: the headline, the flow, the advice | A solar power sensor | Energy settings |
| Now: battery card | A battery with a state of charge | Energy settings |
| "Enough until", the battery in an hour, the washer line | A [prediction level](#prediction-levels) with house use, and the battery's size when there is a battery | `level`; `battery_kwh`, or the capacity in the Energy settings |
| Now: coming days | A solar forecast, or the forecast sensor | Energy settings |
| Battery warning | A state of health sensor, or the battery's install date | `battery_health`, `battery_install_date` |
| Energy: Power origin, Today by hour, Production | The energy sensors | Energy settings |
| Money page | A price on the grid connection, or the band prices of `tariff`, or `system_cost` alone | Energy settings, `tariff`, `system_cost` |
| Money: Payback | What the system cost. Hidden while no price is set, like the other Money cards. | `system_cost` |
| Money: price bands | Your contract's time bands (Italy) | `tariff` |

As an admin, open the gear at the top right. Its **Setup check** lists the main parts, on or off, and what to set for the ones that are off: the prediction level asked for and in use, the solar forecast (where the level would use it), the battery size, Money, Payback, the price bands, and each machine the washer line plans (while the page looks ahead). A last row, "Options not used" (Opzioni non usate), names the options the page ignored or could not read.

## Prediction levels

The page can look ahead at four levels. Without a `level` key it picks the highest one its data allows. Most homes need no key.

- **`none`**: no predictions. The page shows what happened and what happens now.
- **`usual_days`**: the page learns your usual day from the last 14 days: how much the house uses and how much sun there is, hour by hour. It needs 3 days on record. Until then, Now says how many days are left.
- **`usual_days_weather`**: the usual day, with the sun of the solar forecast in your Energy settings. This is the usual level for a home with a solar forecast.
- **`weather`**: it reads the forecast sensor `sensor.solar_view_forecast`, from a companion integration that is planned but not published yet, and takes only its sun and sky.

A level without its data steps down to the next one that has it, and says so once in the browser console. For example, `usual_days_weather` without a solar forecast works as `usual_days`. The Setup check in the gear shows the level asked for and the level in use. The full table of what each level shows is in [How it works](how-it-works.md#prediction-levels).

## Options

Everything is optional. It goes under `config:` in the same `panel_custom` entry, in groups. The groups only keep things tidy: every key works in any group, or at the top with no group. A key the page does not know, or a value it cannot read, is ignored and named once in the browser console, and in the Setup check's "Options not used" row. Remember the [restart](#every-change-needs-a-restart).

The options reach the browser of every user who can open Home Assistant, admins or not, so a `!secret` among them is readable there.

To keep the options out of `configuration.yaml`, put them in a file of their own:

```yaml
panel_custom:
  - name: solar-view
    url_path: solar
    sidebar_title: Solar
    sidebar_icon: mdi:solar-power-variant
    module_url: /hacsfiles/ha-solar-view/solar-view.js
    config: !include solar_view.yaml
```

`solar_view.yaml` then holds the groups, starting at the left margin.

### Plant

What the system is and what it cost. You may split these keys into the groups `battery`, `grid` and `payback` instead.

```yaml
plant:
  battery_kwh: 10
  battery_floor: 20
  battery_max_charge_kw: 2.1
  battery_max_discharge_kw: 3
  battery_install_date: "2025-03-15"
  export_max_kw: 0
  standby_w: 60
  grid_max_kw: 3.3
  system_cost: 9000
  install_date: "2025-03-15"
  saved_before: 0
```

| Option | Meaning | Default |
|---|---|---|
| `battery_kwh` | The whole battery's size in kWh, not only the part above `battery_floor`. With a battery, needed for every prediction drawn from it: "enough until", the battery in an hour, the washer line, the days to come on Daily returns. | The capacity in the Energy settings. Without either, those parts are off. |
| `battery_floor` | Percent at which the inverter stops discharging. The battery reads "Empty" at the floor and "Low" up to 15 percent above it. | `20` |
| `battery_max_charge_kw` | The most the battery takes in, in kW (40 A x 53.6 V is 2.1). Spare sun beyond it goes to the grid in the forecast. | No limit |
| `battery_max_discharge_kw` | The most the battery gives out, in kW. Use beyond it comes from the grid in the forecast. | No limit |
| `battery_install_date` | The day this battery went in, as `YYYY-MM-DD`. Set it again when you replace the battery. Without a `battery_health` sensor, a warning shows 9.5 years after it. | `install_date` |
| `export_max_kw` | The most the inverter sends to the grid, in kW. Set `0` on a zero-export inverter: the page then leaves out what is sent, its money and the sell price. | No limit |
| `standby_w` | The inverter's own use in W. Left out of the savings the forecast expects. | Worked out from `load_energy`, else `0` |
| `grid_max_kw` | The most the meter gives before it trips, in kW (a 3 kW contract in Italy holds 3.3). With it, the washer line says "wait" while the house draws too much. | No check |
| `system_cost` | What the panels and battery cost, in your currency. Turns on the Payback card. | No Payback card |
| `install_date` | The day the system started, as `YYYY-MM-DD`. Payback counts from its month. | The first month on record |
| `saved_before` | What the system saved before Home Assistant recorded it. Added to Payback. | `0` |

### Predictions

```yaml
predictions:
  level: usual_days_weather
  usual_days: 14
```

| Option | Meaning | Default |
|---|---|---|
| `level` | `none`, `usual_days`, `weather` or `usual_days_weather`. See [Prediction levels](#prediction-levels). | Automatic |
| `usual_days` | How many past days make the usual day. Fewer follow a new routine faster; more give a steadier estimate. From 3 to 60. | `14` |

### Machines

The machines the washer line says when to start. Not used at `level: none` or `weather`.

```yaml
machines:
  battery_margin: 10
  quiet_hours: "0-7"
  washer:
    kwh: 1
    hours: 2
    peak_kw: 2
    sensor: sensor.washer_energy
  dishwasher:
    kwh: 1.2
    hours: 3
```

| Option | Meaning | Default |
|---|---|---|
| `battery_margin` | Percent kept above `battery_floor` when a start is called free. | `10` |
| `quiet_hours` | Hours in which no start is suggested, as `"0-7"` or `"23:30-6:30"`. Only the start counts: a machine may run on into them. A 23:00 start in band F3 is often the cheapest. Use `"22-7"` if nobody wants late starts. | `"0-7"` |
| `washer`, `dryer`, `dishwasher` | The machines you can start at any time, planned in the order written. Each takes `kwh` (energy of a run), `hours` (length of a run), `peak_kw` (highest draw) and `sensor` (its energy sensor). With a sensor, the page learns the runs once 3 are on record. Without a sensor, a `kwh` or `hours` left out is 1 kWh or 2 hours, so the type alone is a run of 1 kWh over 2 hours. `false` leaves it out. | None: no machine, so no washer line |

Machines you do not move in time, such as an oven, need no entry. Their use is already in the house's.

### Prices

The bill's fixed part and the contract's time bands. The price per kWh itself comes from the Energy settings (see [Prices and fixed costs](#prices-and-fixed-costs)).

```yaml
prices:
  bill_fixed: sensor.bill_fixed
  tariff:
    type: three
    prices:
      f1: 0.19
      f2: 0.22
      f3: 0.19
```

| Option | Meaning | Default |
|---|---|---|
| `bill_fixed` | The fixed part of the electricity bill a month, in your currency: the id of a sensor, or a plain number. Added to every month's grid cost on Money. | `0` |
| `tariff` | The contract's time bands: `type` and the band prices from `prices`, `sensor` or both. See [Time bands](#time-bands). | No bands |

### Sensors

Replace what the Energy settings say, or add what they cannot know (see [Names under sensors](#names-under-sensors)). Each takes one entity id or a list; an empty list `[]` switches that part off.

```yaml
sensors:
  load_power: sensor.inverter_load_power
  load_energy: sensor.inverter_load_energy
```

### Advice

Your own advice lines: `advice` and `advice_replace`. See [Your own advice lines](#your-own-advice-lines).

## Prices and fixed costs

Prices and the bill's fixed part change from month to month, so they are not in the options. They live in Home Assistant, which keeps their history.

- **Prices:** set them on the grid connection in the Energy settings, as an entity that holds the price per kWh (per MWh or per Wh works too, by the entity's unit). Home Assistant then records what each kWh cost when it was used, and the page reads that. A fixed number works too, but then every month counts at it.
- **Fixed part:** a sensor named by `bill_fixed`, with `state_class: measurement`, so Home Assistant keeps its monthly mean. Each month counts with the value it had then. The simplest way is a number helper (Settings, Devices and services, Helpers, Create helper, Number) and a template sensor that copies it:

```yaml
template:
  - sensor:
      - name: Bill fixed
        unique_id: bill_fixed
        unit_of_measurement: "EUR"
        state_class: measurement
        state: "{{ states('input_number.bill_fixed') | float(0) }}"
```

### Bill prices

This needs the Solar view integration (the action and the bills sensor are its own). Once a bill has come, give its figures for each month it covers, and Money prices that month as the bill does. Call the action `solar_view.set_month_prices` (Developer tools, Actions, or from an automation):

```yaml
action: solar_view.set_month_prices
data:
  month: "2026-09"
  f1: 0.3512
  f2: 0.3301
  f3: 0.3004
  fixed: 14.20
```

| Field | Meaning |
|---|---|
| `month` | The month, `YYYY-MM`. Only a finished month: this month or a later one is refused. |
| `f1`, `f2`, `f3`, `f23` | What one more kWh cost in that band, with every per-kWh charge, excise and VAT included. Give `f1`, `f2` and `f3`; or `f1` and `f23`; or `f1` alone for a single price. |
| `fixed` | The month's fixed part with VAT: fixed fee, power fee and commercialisation. Half of a two-month bill's. Leave out TV licence, adjustments for earlier months and one-off charges. May be below 0. |

Calling again for a month replaces it; `month` alone removes it. The integration prices each hour of the month at its band's price, the grid energy bought and the house's own energy alike, and `sensor.solar_view_bills` lists every month with its prices, fixed part and money. Month balance and payback then use those figures, and the month's `fixed` replaces `bill_fixed` for that month.

- Home Assistant's meter can differ from the distributor's by a few percent, so the cost does not match the bill to the cent.
- A month with fewer than 95 % of its hours on record keeps the statistics' figure.
- A month priced in its first minutes misses its last hour until the integration is reloaded.

#### Reading the bills

Instead of typing the figures, copy each bill's PDF into a `solar_view_bills` folder in the config folder (`config/solar_view_bills/`, beside `configuration.yaml`). The integration reads it on start and at a quarter past each hour, and stores every month the bill covers as the action would: each band's price with every per-kWh charge, excise and VAT, and the fixed part with VAT. The folder is the switch: without it nothing is read. A folder made while Home Assistant runs is read from the next restart or reload of the integration.

- It reads Servizio a Tutele Graduali bills laid out like Hera's. Other suppliers' layouts are untested.
- Each file is read once, known by its bytes. A copy of the same file under another name (`bill(1).pdf`) is skipped, and a month you later fix or remove with the action stays as you left it. The same bill downloaded again usually has other bytes: it is read again and replaces its months.
- A file that could not be read is not tried again. To read it again, change it (download it anew) or remove it and the file `.storage/solar_view.files`.
- Two bills with the same month: the one read last wins (two read together: the later by name). A correction copied in after its original replaces it; copy an original in after its correction and the original wins.
- The log says `read bill <file>: <months>` for each bill, which month a bill replaced, and a warning for a file it could not read or with no month in it.

If your config folder is in git, add `solar_view_bills/` to its `.gitignore`: bills hold your name, address and supply codes.

#### Months without a bill (Italy, PUN Index GME)

For a contract priced on the PUN Index GME by band (such as Servizio a Tutele Graduali), turn on "Estimate months without a bill from the PUN Index GME" in the integration's options (Settings, Devices and services, Solar view, Configure). Every month after your first bill that has no bill of its own, this month included, is then estimated from the last bill before it: each band's price moves by 1.21 times what the PUN Index moved in that band since the billed month (1.10 for grid losses, 1.10 for VAT), and the fixed part stays the bill's. The bill's other per-kWh charges are taken as they were, so an estimate can be a cent or two off.

The integration downloads each month's hourly PUN from GME once (this month's once a day) and prices this month again at a quarter past each hour. Daily returns, the Prices card's bands, the advice and the days ahead use this month's estimated prices; `sensor.solar_view_bills` marks estimated months with `estimate: true`. Once the bill comes, give its figures as above and they replace the estimate. A month that starts on a weekend or a holiday has no F1 hour yet, so it stays unestimated until its first working day.

### Time bands

Italian contracts price electricity by the time bands that ARERA sets for every supplier:

- F1: Monday to Friday, 8 to 19.
- F2: Monday to Friday, 7 to 8 and 19 to 23; Saturday, 7 to 23.
- F3: every night from 23 to 7, and all of Sundays and national holidays (Easter Monday included).

The page knows these hours. `tariff` says what your contract prices:

```yaml
tariff:
  type: three              # single (one price), two (F1 and F23), three (F1, F2, F3)
  sensor: sensor.price     # optional: the price now, following the band
  prices:                  # optional: each a number or the id of an entity
    f1: 0.19
    f2: 0.22               # for type two, f23 (f2 works too): F2 and F3 together
    f3: 0.19
```

Each band takes its price from `prices`, else from `sensor` (the mean of that band's hours over the last 28 days; the sensor needs `state_class: measurement`). Every band of the type needs a price one way or the other. If one has none, the page uses no bands and says so in the browser console.

With bands, the washer line can pick cheaper hours, and the Electricity prices card shows the band now with a box per band. The money figures still use the Energy settings' price.

## Names under sensors

The names under `sensors` (the old name `entities` still works):

| Name | What it is |
|---|---|
| `solar_power`, `battery_power`, `grid_power` | Live power in W or kW. Battery is positive when discharging, grid is positive when importing. |
| `battery_soc` | Battery state of charge in percent. |
| `solar_energy`, `battery_out_energy`, `battery_in_energy`, `grid_in_energy`, `grid_out_energy` | Energy sensors with long-term statistics. |
| `grid_cost`, `grid_compensation` | What the grid cost and paid, in your currency, with long-term statistics. By default the cost entities of the Energy settings, or the cost sensors Home Assistant makes for a grid with a price. |
| `load_power`, `load_energy` | House use, live and as energy. Not part of the Energy settings. |
| `battery_health` | Battery state of health in percent, if your inverter reports one. When it reads, it alone decides the battery warning: below 70 percent. |

### House use

Without `load_power` and `load_energy`, the page works house use out as solar plus battery plus grid. That counts the inverter's own losses as house use, so it can read a little higher than the inverter's display. If your inverter has its own load sensors, name them.

## Your own advice lines

The advice card picks one line a day from a pool that fits the situation. Add lines of your own, per language:

```yaml
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
| `go` | Spare sun right now: 1000 W more than the house uses while the battery is nearly full (or there is no battery), or the battery is nearly full and the rest goes to the grid. Each built-in line names an appliance and shows its icon; your own lines show the washing machine. |
| `goFull` | Spare sun, and the battery is at 100 percent. These lines come before the `go` ones. |
| `soon` | Spare sun now, but the forecast says it fades within 3 hours. Only without a battery charge reading. |
| `later` | No spare sun now, but the forecast says clearly more within 3 hours. |
| `low` | Battery low (less than 16 percent above `battery_floor`), and no real sun or the grid is helping. |
| `empty` | Battery at `battery_floor`, and no real sun or the grid is helping. |
| `wait` | Little sun forecast today, clearly more tomorrow. |
| `ok` | Nothing to do, by day. |
| `okNight` | Nothing to do, by night. |
| `okFull` | Nothing to do, by day, and the battery is nearly or fully charged. |
| `okRefill` | Battery low, but the sun is charging it. |
| `short` | In the evening or at night: the battery carries the house, but runs out before the sun is back. |
| `okLasts` | In the evening or at night: the battery carries the house until the sun is back. |
| `fills` | By day: the battery fills later today, and 1 kWh or more of sun is left over. |

`soon`, `later` and `wait` need a solar forecast. `short`, `okLasts` and `fills` need a level with house use. While the washer line shows, it alone says when to run something: the card then shows no `go`, `soon`, `later` or `wait` line, and none of the built-in `low` and `empty` lines that speak of big loads.

Built-in lines that name the washer, the dryer or the dishwasher show only when that machine is listed under `machines`. Lines about the oven, the iron, the vacuum cleaner or a phone are not tied to a listed machine, and show always. If that leaves a `wait` or `later` pool empty, the card shows an `ok` line.

With `advice_replace: true`, a pool that has lines of yours shows only those. Keep a line short enough for two rows on a phone.

## The gear

The gear at the top right opens "Show on this device":

- switches for the sky: sun height, clouds, rain and snow;
- the language of the page on this device (Automatic follows the Home Assistant profile);
- the clock on this device: 12 or 24 hours (Automatic follows the Home Assistant profile);
- for admins, the [Setup check](#what-shows-and-what-it-needs).

Each device keeps its own choice, so a wall tablet can show less than a phone. Cards hide themselves when they have nothing to show, so they have no switch.

## Who sees what

Every user sees the same pages, in the language and time format of their profile, unless they pick another language in the gear. Money shows only when one of its cards has something to show. Only admin users see the Setup check and the names of missing sensors. That is tidiness, not security: any user can read the sensors anyway.

## FAQ

**I changed the options and nothing happened.** Restart Home Assistant fully. See [Every change needs a restart](#every-change-needs-a-restart).

**Why does the battery say "Empty" at 20 percent?** 20 is the default `battery_floor`, where most inverters stop discharging. Set your inverter's value.

**Why is there no "enough until"?** It shows only while the battery powers the house, for an end between half an hour and 18 hours away. It also needs a battery size and a level with house use. In the first 3 days there is no usual day yet.

**Why does it say to start the washer at 23:00?** In Italy, 23:00 starts band F3, often the cheapest hour. Set `quiet_hours: "22-7"` to avoid late starts.

**Why is the Balance red?** In that day or month the grid cost more than the sun saved and sold.

**Where is the Money page?** It needs a price on the grid connection in the Energy settings, the band prices of `tariff`, or `system_cost`.

**Why does Now say "Learning your usual day"?** The page needs 3 days on record before it can predict. It counts the days down.

## Troubleshooting

| What you see | What it means |
|---|---|
| "Let's set up the solar panels" | The Energy settings have no solar power sensor, or a named sensor does not exist. Admin users also see the names of the missing sensors, and without a solar power sensor the `sensors: solar_power` line for an older Home Assistant. |
| "Inverter not reachable" on Now | Every sensor of one kind (solar, battery or grid power, or the charge) exists but has no value. Energy and Money still show what is on record. It clears by itself. |
| "Last update: 14:05" under the headline | No live sensor has been updated for 20 minutes. The inverter or its integration may be frozen. |
| A part of the page is missing | Open the gear's Setup check (admins): a part that is off says what to set, and "Options not used" names a misspelt key or a value it could not read. The browser console has the same, in lines that start with `solar-view`. |
| A grey loading skeleton that stays | Home Assistant is still starting, or the statistics have not answered. |
| The old page after an update | Installed by hand: raise `?v=` and restart. On a phone, close the app fully and open it again. |

## Known limits

- Statistics reach back only to when Home Assistant started to record a sensor. To see earlier years, import the history (most inverter apps export a CSV) into the same sensors' long-term statistics, for example with the Import Statistics integration from HACS. The imported running total must meet the first value Home Assistant recorded, or that day shows a huge spike.
- Today's totals come from the 5 minute statistics and can lag a few minutes.
- More panels on the same sensors are not noticed at once. The usual day catches up over `usual_days` days. Update the panel size in your solar forecast, and raise `system_cost` by what the extension cost.
- "Enough until" knows the usual day, not today's plans. Weekdays and weekends share one usual day.
- A house with neither a battery nor a grid power sensor reads "using energy from the panels" at night.
- The thresholds behind the advice (for example 1000 W of spare sun) are constants in `custom_components/solar_view/frontend/lib/advice.js`, not options.
- Tested in desktop browsers and in the Android companion app. Not tested on iOS.

## Privacy

The page talks only to your own Home Assistant. It keeps three things in the browser's `localStorage`: the last numbers it showed (`solar-view-last`, so the loading skeleton has the right shape), the display switches (`solar-view-show`) and the language picked in the gear (`solar-view-language`). Nothing leaves the device.

The files are served without login, under `/hacsfiles/` or `/local/`, like everything in `config/www`. They hold code only, never your data. Do not put secrets in them.
