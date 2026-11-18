# How it works

How the page gets each figure, forecast and advice line. To install and set it up, read the [setup guide](setup.md). The page's own words are given in English, with the Italian in brackets where it helps.

## Where the numbers come from

- Live values come from the power sensors named in the Energy settings (or under `sensors`).
- Hour, day and month totals come from the long-term statistics of the energy sensors named there.
- Prices and the solar forecast come from the same place, when they are set. A price entity per MWh or per Wh is turned into a price per kWh.
- The money of past months comes from the bills sensor for a month with a bill's prices (see Bill prices in setup.md), else from the cost statistics Home Assistant keeps for a grid with a price. A new price therefore leaves past months as they were. A month without either counts at today's price.

The page asks for today's 5 minute statistics every 5 minutes. The rest (the Energy settings, the hour, day and month rows, the solar forecast) only changes when Home Assistant writes its hourly statistics. The page asks for it again a quarter past each hour, and the day rows once a day.

## Prediction levels

`level` sets how far the page looks ahead. Without the key, the page picks the highest level its data allows, in this order: `usual_days_weather` when a usual day and a Solar Forecast are both there, `weather`, `usual_days_weather` with the Solar Forecast alone, `usual_days`, `none`.

| `level` | Sun from | House use from | Worked out by |
|---|---|---|---|
| `none` | nothing | nothing | nothing |
| `usual_days` | the usual day, scaled by the season | the usual day | the page |
| `weather` | the forecast sensor | nothing | the sensor |
| `usual_days_weather` | the Solar Forecast in the Energy settings | the usual day | the page |

The forecast sensor is `sensor.solar_view_forecast`, from the planned `solar_view` integration. The page trusts it only while it was written less than 3 hours ago.

What each level shows:

| Part of the page | `none` | `usual_days` | `weather` | `usual_days_weather` |
|---|---|---|---|---|
| Coming days on Now | | | yes | yes |
| Advice `soon`, `later`, `wait` | | | yes | yes |
| "Enough until", the battery in an hour, the washer line, advice `short`, `okLasts`, `fills` | | yes | | yes |
| Today by hour: the hours to come | | yes | sun only | yes |
| Power origin: the small rings (wide screens) | | yes | | yes |
| Production: days to come and month end | | yes | yes | yes |
| Daily returns: days to come; Month balance: month end | | yes | | yes |
| Payback: time left | | yes | | yes |

`weather` has no house use, so nothing that needs it shows there.

### Old names

Any other value that is not one of the four says so once in the browser console, and the level is automatic.

### Step down

A level whose data is missing steps down, again and again while data is missing. Each step says so once in the browser console. Nothing shows on screen, but the Setup check in the gear names the level asked for and the level in use.

- `weather` steps down to `none`.
- `usual_days_weather` steps down to `usual_days` only without a Solar Forecast. The Solar Forecast alone is enough: the usual day joins once it is on record.
- `usual_days` needs 3 days on record, else `none`.

### The forecast sensor's facts

While the forecast sensor is fresh, some of what it says is a fact, not a forecast. The page uses these at every level: the cloud and rain of this hour for the sky, the weather icons of the coming days, and the sell price now (and the buy price, without bands). Only the forecast parts (days to come, the month end) follow the level.

## The usual day

The page learns the usual day from the last 14 days of hour statistics (`usual_days`): how much the house uses and how much sun there is, in each hour of the day.

- With 5 days or more behind an hour, its lowest and highest sun are left out. One odd hour (a recorder catching up) cannot carry it. House use keeps them all: an oven or a car charged now and then is real energy.
- The sun follows the season. Each hour of a day to come is scaled by how much sun that hour gets in a clear sky that day, against the usual days. The page takes the clear sky from Home Assistant's location. So in autumn each day expects a little less sun than the days behind it, and in spring a little more. On one plant in October, this cut the usual day's error on the next day from 21 to 17 percent.
- The low and high of a day come from how much the whole days differed: their 25th and 75th percentile, for sun and for use. A day from the Solar Forecast takes 20 percent either way.
- The usual runs of each machine with a `sensor` stay in house use. Only the washer line takes them out, before it adds each run where it plans it.

There is no usual day until every hour has 3 days behind it. Until then, Now shows "Learning your usual day: predictions start in N days".

## The forecast, hour by hour

From now on, the forecast goes forward one hour at a time.

- **The present hour** counts by its minutes. At 6:30, half of the 6 o'clock hour is still to come. For that half hour, the higher of the present draw and the usual one counts, and the lower of the present sun and the expected one. An oven switched on or a cloud right now is not ignored. Every card that looks ahead counts the present hour the same way.
- **Every later hour** takes what the house usually uses at that hour, minus the sun of that hour. The sun comes from the solar forecast for a day it has any hour of (an hour it leaves out, such as the night, has no sun). Otherwise it comes from the usual day.
- **A day the solar forecast covers only in part**, with under three quarters of the hours of its fullest day, counts as not forecast. This is often the last day of a forecast cut short.
- **Today's sun so far** sets the rest of today. Once the usual day would have made 0.5 kWh by now, the rest of today's usual sun is scaled by what the sun really made against that, up to 1.5 times. A grey morning makes a grey afternoon. With export capped and the battery full at some point today, the sun so far was held back, not clouded: it may then only raise the rest of today.
- **The battery** fills from spare sun, up to `battery_max_charge_kw`, with losses on the way in. Its round trip is measured from 7 days of battery rows, else taken as 95 percent. Spare sun beyond it goes to the grid up to `export_max_kw`; the rest is lost. A shortfall takes the battery down to `battery_floor` (up to `battery_max_discharge_kw`), then the grid.

The page runs three runs of each forecast: the low, the likely and the high. Most cards show the likely run; a range shows the low and the high.

### House use in the forecast

The forecast counts house use as the balance: solar plus battery plus grid. This adds up with the battery and grid meters. With a forecast, Power origin and Today by hour count what was used so far the same way. `standby_w` (the inverter's own use) is left out of the savings the forecast expects.

## "Enough until"

While the battery powers the house, the battery card says how long it will last. It does not divide what is left by the present draw: a quiet night at 150 W says nothing about the breakfast hour. It follows the likely run of the forecast instead.

- If the battery reaches `battery_floor` first, the card shows that time, rounded to the half hour.
- If the sun covers the house first, it says the charge should last until the sun is back.
- If the end is less than half an hour or more than 18 hours away, it shows no time.

It needs a level with house use and a battery of known size. Without them, the card only says that the battery powers the house. A guess from the present draw would read as a promise.

## The washer line

The washer line says when to start each machine under `machines`: only the ones you list. With none listed, there is no washer line. It sits at the bottom of the battery card. Without a battery charge reading, it has a card of its own on Now. The reason shows under it.

- **Starts** are now and every whole hour of today and tomorrow. Each is weighed until sunrise the day after tomorrow. That night is tomorrow's night again, so a start late tomorrow pays for a night it leaves short. The battery is kept `battery_margin` points above `battery_floor`, so a forecast a little off still leaves it above the floor.
- **The earliest free start wins.** A free start takes nothing more from the grid in all that time. The sun covers it, the battery covers it until the sun is back, or the sun refills what it takes. Charge it leaves missing at that last sunrise counts as export given up, not as grid. Today's starts use the likely run. Tomorrow's, further off, must be free on the low run too.
- **Otherwise the start that costs least wins.** The cost is the grid energy it adds at each hour's price, plus the export it gives up at the sell price, plus the battery charge it leaves missing at the end. Tomorrow's starts count the worse of the likely and the low run. With `tariff`, each hour has its band's price, so the line may say "Cheaper hours (F3)". Without a price for every hour, the least grid energy wins.
- **Today before tomorrow.** A start tomorrow wins only when it saves at least what 0.3 kWh of grid costs (at the mean price) over the best start today.
- **No guessed sun tomorrow.** When tomorrow's sun is only the usual day's (no hour of tomorrow in the Solar Forecast), tomorrow's low run has no sun at all. A start tomorrow can still win on cheaper hours or on the battery, never on that guessed sun.
- **Never a start inside `quiet_hours`.** The machine may still run on into them. The default `"0-7"` keeps 23:00 open, which starts band F3 on weekdays.
- **"Wait"** instead of "now" when the house's draw now, plus the machine's peak, less the sun now and the battery, is over `grid_max_kw`.
- **Machines are planned in the order listed**, each after the ones before, so two never count on the same sun.

A machine with a `sensor` learns its runs: the energy of a run from the last 10 runs in 90 days of hour statistics, and its length and peak from the 5 minute statistics (Home Assistant keeps those about 10 days). Until 3 runs are on record, the typed figures count. The peak is 2 kW when nothing better is known.

## The advice card

The advice card shows one line a day from a pool that fits the moment. The pools and when each shows are listed in the [setup guide](setup.md#your-own-advice-lines). Some rules behind them:

- **Spare sun** (`go`) is 1000 W more sun than the house uses, while the battery is nearly full (85 percent or more) or there is no charge reading. Sending more than 50 W to the grid with a nearly full battery counts too.
- **`soon`** needs this hour's forecast sun at 500 W or more, and the next 3 hours under 40 percent of it.
- **`later`** needs the next 3 hours at 500 W or more on average, and twice this hour's forecast.
- **`wait`** needs today's forecast under 55 percent of a usual day, and tomorrow's at least 1.5 times today's.
- **`soon`, `later` and `wait`** read the Solar Forecast at `usual_days_weather`, and the forecast sensor at `weather`.
- **One voice for timing.** While the washer line shows, it alone says when to run something. The card then drops `go`, `soon`, `later` and `wait`, and shows `ok` or a battery line (`okLasts`, `short`, `fills`). The built-in `low` and `empty` lines that speak of big loads are left out too.
- At night with the battery at its floor and the grid carrying the house, the battery rests as it should: no alarm colours.

## Now

- **Headline:** the one or two sources that really carry the house right now, biggest first, with a line under it for what else flows.
- **Battery words:** "Empty" (Scarica) at `battery_floor`, "Low" up to 15 points above it, "Good" from there, "Almost full" from 85 percent, "Full" at 100.
- **Battery warning:** above the advice, a red card when the battery nears its end. A `battery_health` sensor under 70 percent decides alone when it reads. Without one, the card shows 9.5 years after `battery_install_date`.
- **Big text:** at about the largest text on a phone, the battery card comes before the flow, with a smaller ring, so the charge shows without a scroll.
- **Battery in an hour:** the ring shows where the charge should be in an hour, from the likely run.
- **Coming days:** up to 7 days from tomorrow. At `weather` they come from the forecast sensor. At `usual_days_weather` they come from the Solar Forecast, as far as it reaches, 20 percent either way, also before a usual day is on record. Each day has a bar from 0 to its likely sun, a thin line from the low to the high, and its figure. An upright line marks a usual day's house use (not at `weather`, nor before a usual day is on record): a bar past it is a day the sun can cover the house. The weather icons come from the fresh forecast sensor, at every level.
- **Offline:** when every sensor of one kind (solar, battery or grid power, or the charge) has no value, Now shows "Inverter not reachable" with the time of the last reading. Energy and Money still show what is on record.
- **Frozen:** when no live sensor has been updated for 20 minutes, the headline gets "Last update: 14:05" under it.

## Energy

- **Power origin:** a ring of where today's power came from (sun, battery, grid). The share from the sun and the battery is in its middle. Under it, each source's kWh so far, and what was sent when there was any. On a wide screen with a forecast that has house use, two small rings sit beside it: the same split in an hour and at the end of the day, as the likely run expects.
- **Today by hour:** today from midnight to 23:59, on two charts with one timeline. On top, with a battery, the charge in percent hour by hour, and dashes for where it should go until midnight. The red dashed line is `battery_floor`. Under it, a line each for what the sun made, what the house used and what came from the grid: solid for the hours done, dashed for the hours to come. Tap or point at an hour to see its figures under the charts.
- **Production:** a bar for each of the last 12 months, oldest on the left, this month on the right. The year mark ('25) sits where the year changes. A month with days not on record shows the total of the days it has, marked as partial. Under the bars, the picked month's days as a line, a dot a day. With a forecast, this month's days to come continue the line as dashes: tomorrow as the forecast expects it, later days from the Solar Forecast as far as it reaches, then the usual day's sun. This month's bar gets a faded block up to where the month should end. A month with a day of no numbers on record has no month end. Before a usual day is on record, the dashes at `usual_days_weather` are the Solar Forecast's days alone, with no month end. At `weather`, the days to come stop where the sensor's forecast stops, and the month end shows only once they reach the month's last day.

## Money

The money has these names:

- **Saved** (Risparmiati): what the sun and the battery saved. The house's own energy (its use less what came from the grid) at the month's average grid price, from the cost statistics. Without them, at today's price.
- **Export** (Vendita): what was sold to the grid, while export is on.
- **Grid cost** (Costo della rete): what the grid cost, from the cost statistics, else the imported kWh at today's price. On Month balance, with `bill_fixed` set, it includes the bill's fixed part.
- **Balance** (Saldo): saved plus export, less the grid cost. Below zero it is red, with a minus. It is the household's energy balance, not the plant's gain.

Each card counts sales once: Payback's line and Daily returns' **Savings** (Risparmi) hold saved plus export; Month balance shows Saved and Export apart.

A figure nobody can price says "no price on record". A day or month with no numbers on record says so. Neither ever shows as a zero.

- **Payback:** with `system_cost` set, a ring of how much of the cost has come back since `install_date`, plus `saved_before`. Under it: "This month: 18 € saved" (Questo mese: 18 € risparmiati), or "saved and sold" while export is on, and about how long is left. Once paid back, the month it happened and what came back since. With no price set, the card is hidden.
  - The time left counts each coming month like the same month last year. While there is less than a year on record, it guesses from the months so far and the sun at Home Assistant's latitude. Summer brings more sun, but the house uses less of it, so most of the extra goes out at the selling price. Until a year is on record, the time left is a range: every coming month 20 percent better and worse.
  - The rest of this month counts first: what such a month brings, less what this one brought so far.
- **Daily returns:** a line of what the system brought back each day of this month (savings, without the bill's fixed part), a dot a day. Tap a day to see its Savings (saved plus export), Grid cost and Balance. With a forecast that has house use, the days left this month continue the line as dashes. They are priced at the Energy settings' price.
- **Electricity prices:** the price now of a kWh bought from the grid and, while export is on, sold to it. The buy price is the tariff's band now when there are bands, else the forecast sensor's present hour while it is fresh, else the Energy settings' price. With two or three bands, a box per band shows its hours today, the share of this month's grid energy bought in it, and its price.
- **Month balance:** each of the last 12 months' Balance as a bar, oldest on the left, the same months as Production. A bar goes down, in red, when the grid cost more. Under the bars, the picked month: its grid cost on the left of a middle line, its savings and sales on the right ("Saved + export", Risparmio + vendita, while export is on), then Saved, Export (while export is on) and Balance. For this month, faded bars show where each should end: this month so far plus the rest of today and every day to come.

## The sky

- **Colours** follow the sun's height: night, dawn or dusk, then day. The day keeps a little of the dawn or dusk colours while the sun is low, and turns its deepest blue only from 50 degrees up. The night is darkest once the sun is 18 degrees down.
- **Clouds** grey the sky from 50 percent cloud, fully grey at 90. The cloud comes from the fresh forecast sensor's present hour, else (no fresh sensor, or one without this hour) from the `cloud_coverage` of a `weather` entity (not every weather integration has it).
- **Rain** falls when the fresh sensor forecasts more than 0.2 mm this hour, else when the weather entity says it is raining.
- **Snow** falls when the weather entity says `snowy` or `snowy-rainy`. The sensor knows no snow.
- The gear's switches turn off the sun height (the sky then jumps from night to day at sunrise), the clouds, and the rain and snow.

## Gaps in the records

No numbers on record (the inverter, the power or the connection was down) never show as zeros. A day, an hour or a month without them keeps its place, empty, and says "no numbers on record". A meter that only counts up puts a missing day's energy into the next day on record, so a month with a day missing between two others still has its total.

A sensor added later beside another of the same kind (a second inverter's solar sensor, say) counts as nothing before its first numbers. The days and months before it keep the first sensor's figures, and the usual day goes on.
