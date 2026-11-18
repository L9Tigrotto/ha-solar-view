"""Builds preview/home-days.json: a real house's days for the preview's fake statistics.

Source: Open Power System Data, "Household Data" package, version 2020-04-15, house DE_KN_residential4
(Konstanz, Germany; about 11 kWp, a heat pump and an electric car, no battery), CoSSMic project. Licence CC BY 4.0:
https://doi.org/10.25832/household_data/2020-04-15

Usage: python home-days.py household_data_60min_singleindex.csv home-hours.json > home-days.json

Reads 2017 by the hour, local time. The meters are running totals; each hour is the change from the hour before.
Some 2017 days are copies, not readings: their PV hours repeat another day's exactly (10 to 13 May, 23 November and
25 November to the end of the year all read one clear November day). Those days take the same date of 2016 instead,
whose gaps lie inside single days (interpolated hours between real readings, so each day's total is real). The
dates taken from 2016 go into the json as "from_2016", for the weather file to match. House use is solar plus import minus export. The house had no battery, so
one of 10 kWh is simulated on the same hours: it takes spare sun up to BATT_MAX_KW and gives to the house down
to the floor, 95 % each way (about 90 % round trip), starting the year half full. The whole house is scaled by
SCALE first (sun and use alike), to a plant of about 6 kWp, so the days look like a smaller home's.

Each day of the year (365, 1 January first) is
[solar, grid in, grid out, battery out, battery in, grid in with the battery, grid out with the battery] in kWh.

The second file, home-hours.json, holds the same year by the hour for the preview's live values: 24 slots a day
(365 x 24, by the local hour; the day the clocks go back adds its repeated hour to the next, the day they go
forward repeats its missing one with no energy), each slot's sun and house use in kWh and the simulated battery's
charge in percent at the end of the hour. The battery's flows and the grid follow from those (see the preview).
"""
import csv
import json
import sys

HOUSE = "DE_KN_residential4"
BATT_KWH, FLOOR, BATT_MAX_KW, EFF = 10, 0.2, 5, 0.95
SCALE = 0.55  # about 11 kWp down to about 6

rows = [r for r in csv.DictReader(open(sys.argv[1], newline="", encoding="utf-8"))]
cols = [f"{HOUSE}_{p}" for p in ("pv", "grid_import", "grid_export")]
# Each day's hours as [sun, grid in, grid out] in kWh, scaled, for every day the file has.
hours, prev = {}, None
for r in rows:
    if any(r[c] == "" for c in cols):
        prev = None
        continue
    now = [float(r[c]) for c in cols]
    # The hour that ends at this row: the local time stamp is its start (CET or CEST).
    if prev is not None:
        hours.setdefault(r["cet_cest_timestamp"][:10], []).append([max(0.0, a - b) * SCALE for a, b in zip(now, prev)])
    prev = now
# A day with sun whose PV hours match another day's exactly is a copy.
seen = {}
for day, h in hours.items():
    if sum(x[0] for x in h) > 0.3:
        seen.setdefault(tuple(round(x[0], 3) for x in h), []).append(day)
copies = {d for ds in seen.values() if len(ds) > 1 for d in ds}
year = sorted(d for d in hours if d.startswith("2017"))
assert len(year) == 365, len(year)
from_2016 = [d for d in year if d in copies]
assert all("2016" + d[4:] in hours and "2016" + d[4:] not in copies for d in from_2016)
days, chargeLevel = {}, BATT_KWH / 2
slots = {"sun": [], "use": [], "chargeLevel": []}
for day in year:
    h_list = hours["2016" + day[4:] if day in copies else day]
    # 24 slots: 25 hours fold their last two into one, 23 hours repeat the charge in a slot with no energy.
    folded = h_list[:23] + [[sum(x) for x in zip(*h_list[23:])]] if len(h_list) > 24 else h_list
    for slot, (sun, grid_in, grid_out) in enumerate(folded):
        use = max(0.0, sun + grid_in - grid_out)
        spare = sun - use
        if spare > 0:
            put = min(spare, BATT_MAX_KW, (BATT_KWH - chargeLevel) / EFF)
            chargeLevel += put * EFF
            out, put_in, b_in, b_out = 0.0, put, 0.0, spare - put
        else:
            give = min(-spare, BATT_MAX_KW, (chargeLevel - BATT_KWH * FLOOR) * EFF)
            chargeLevel -= give / EFF
            out, put_in, b_in, b_out = give, 0.0, -spare - give, 0.0
        d = days.setdefault(day, [0.0] * 7)
        for i, v in enumerate((sun, grid_in, grid_out, out, put_in, b_in, b_out)):
            d[i] += v
        slots["sun"].append(round(sun, 3)); slots["use"].append(round(use, 3)); slots["chargeLevel"].append(round(chargeLevel / BATT_KWH * 100, 1))
    for _ in range(24 - len(folded)):
        slots["sun"].append(0.0); slots["use"].append(slots["use"][-1]); slots["chargeLevel"].append(slots["chargeLevel"][-1])

keys = sorted(days)
json.dump({"source": "Open Power System Data, Household Data 2020-04-15, DE_KN_residential4, 2017, copied days from 2016 (CC BY 4.0)",
           "scale": SCALE, "battery": {"kwh": BATT_KWH, "floor": FLOOR, "max_kw": BATT_MAX_KW},
           "from_2016": [k[5:] for k in from_2016],
           "days": [[round(v, 2) for v in days[k]] for k in keys]}, sys.stdout, separators=(",", ":"))
assert all(len(v) == 365 * 24 for v in slots.values())
json.dump({"source": "the same house and battery as home-days.json, by the hour", "scale": SCALE, **slots},
          open(sys.argv[2], "w"), separators=(",", ":"))
