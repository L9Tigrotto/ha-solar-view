"""bills.py: pricing a month at its bill's figures. Run: python -m pytest tests -q"""
import math
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "custom_components" / "solar_view"))
import bills  # noqa: E402

UTC, ROME = timezone.utc, ZoneInfo("Europe/Rome")
PRICES = {"f1": .3, "f2": .25, "f3": .2}
NOV = datetime(2026, 11, 1, tzinfo=ROME).astimezone(UTC)  # 720 hours, no clock change


def month_of(n=720, **set_hours):
    """The first n hours of November 2026, each bought 0 and house 0, except the local hours given
    ("d16h10": (bought, house))."""
    rows = [(NOV + timedelta(hours=h), 0.0, 0.0) for h in range(n)]
    for key, (bought, house) in set_hours.items():
        d, h = map(int, key[1:].split("h"))
        t = datetime(2026, 11, d, h, tzinfo=ROME).astimezone(UTC)
        rows = [(s, bought, house) if s == t else (s, b, u) for s, b, u in rows]
    return rows


# ---- bands: the page's bandOf (frontend/lib/forecast.js) ----
@pytest.mark.parametrize("day,hour,kind,want", [
    ("2026-11-16", 10, "three", "f1"), ("2026-11-16", 7, "three", "f2"), ("2026-11-16", 6, "three", "f3"),
    ("2026-11-16", 19, "three", "f2"), ("2026-11-16", 23, "three", "f3"), ("2026-11-14", 10, "three", "f2"),
    ("2026-11-15", 10, "three", "f3"), ("2026-12-08", 10, "three", "f3"), ("2027-03-29", 10, "three", "f3"),
    ("2024-04-01", 10, "three", "f3"),
    ("2026-11-16", 20, "two", "f23"), ("2026-11-15", 10, "single", "f1")])
def test_band_of_matches_page(day, hour, kind, want):
    assert bills.band_of(date.fromisoformat(day), hour, kind) == want


def test_band_of_easter_monday_only():
    assert bills.band_of(date(2027, 3, 30), 10, "three") == "f1"   # the Tuesday after
    assert bills.band_of(date(2024, 4, 2), 10, "three") == "f1"
    assert bills.band_of(date(2026, 11, 16), 8, "two") == "f1"


def test_kind_of():
    assert bills.kind_of({"f1": .3, "f2": .2, "f3": .1}) == "three"
    assert bills.kind_of({"f1": .3, "f23": .2}) == "two"
    assert bills.kind_of({"f1": .3}) == "single"
    assert bills.kind_of({"f1": .3, "f3": .1}) is None
    assert bills.kind_of({}) is None


# ---- month_money ----
def test_month_money_prices_each_band():
    # Mon 16 10:00 Rome is f1, 23:00 is f3
    got = bills.month_money(month_of(d16h10=(1, 3), d16h23=(2, 2)), PRICES, ROME, "2026-11")
    assert got == {"cost": 0.7, "saved": 0.6}


def test_month_money_single_prices_every_hour_at_f1():
    # Sunday 15 and a holiday hour, both at f1
    got = bills.month_money(month_of(d15h10=(1, 1), d1h3=(1, 2)), {"f1": .3}, ROME, "2026-11")
    assert got == {"cost": 0.6, "saved": 0.3}


def test_month_money_saved_never_negative():
    got = bills.month_money(month_of(d16h10=(2, 1)), PRICES, ROME, "2026-11")
    assert got == {"cost": 0.6, "saved": 0}


def test_month_money_none_without_hours_or_kind():
    assert bills.month_money([], PRICES, ROME, "2026-11") is None
    assert bills.month_money(month_of(), {"f2": .2}, ROME, "2026-11") is None


def test_month_money_cost_without_house():
    got = bills.month_money(month_of(d16h10=(1, None)), PRICES, ROME, "2026-11")
    assert got == {"cost": 0.3, "saved": 0}


def test_month_money_none_with_holes():
    assert bills.month_money(month_of(700), PRICES, ROME, "2026-11") == {"cost": 0, "saved": 0}
    assert bills.month_money(month_of(600), PRICES, ROME, "2026-11") is None
    # hours with bought unknown do not count
    holes = [(s, None if i < 100 else b, u) for i, (s, b, u) in enumerate(month_of())]
    assert bills.month_money(holes, PRICES, ROME, "2026-11") is None


def test_month_money_counts_clock_change_hours():
    # October 2026 in Rome has 745 hours (95 %: 707.75); counted as 744, 707 would pass
    start = datetime(2026, 10, 1, tzinfo=ROME).astimezone(UTC)
    rows = [(start + timedelta(hours=h), 0.0, 0.0) for h in range(745)]
    assert bills.month_money(rows[:707], PRICES, ROME, "2026-10") is None
    assert bills.month_money(rows[:708], PRICES, ROME, "2026-10") == {"cost": 0, "saved": 0}


# ---- hour_rows ----
def row(t, change):
    return {"start": t, "change": change}


T = 1794826800.0  # 2026-11-16 11:00 UTC


def test_hour_rows_clamps_and_converts():
    ids = {"bought": ["sensor.g"], "sent": [], "solar": [], "battery_out": [], "battery_in": [], "load": ["sensor.l"]}
    got = bills.hour_rows({"sensor.g": [row(T, -5)], "sensor.l": [row(T, 2)]}, ids)
    assert got == [(datetime(2026, 11, 16, 11, tzinfo=UTC), 0, 2)]


def test_hour_rows_balance_and_load():
    ids = {"bought": ["sensor.g"], "sent": ["sensor.s"], "solar": ["sensor.p1", "sensor.p2"],
           "battery_out": ["sensor.bo"], "battery_in": ["sensor.bi"], "load": []}
    stats = {"sensor.g": [row(T, 1), row(T + 3600, 0.5)], "sensor.s": [row(T, 0.5), row(T + 3600, 9)],
             "sensor.p1": [row(T, 2), row(T + 3600, 1)], "sensor.p2": [row(T, 1)],
             "sensor.bo": [row(T, 0.5), row(T + 3600, 0)], "sensor.bi": [row(T, 1), row(T + 3600, 0)]}
    got = bills.hour_rows(stats, ids)
    # balance 2 + 1 + 0.5 + 1 - 1 - 0.5 = 3; next hour p2 has no row: house unknown, bought known
    assert got == [(datetime(2026, 11, 16, 11, tzinfo=UTC), 1, 3), (datetime(2026, 11, 16, 12, tzinfo=UTC), 0.5, None)]
    # the balance is at least 0
    stats["sensor.s"] = [row(T, 10)]
    assert bills.hour_rows(stats, ids)[0][2] == 0
    # a load id replaces the balance
    ids["load"] = ["sensor.l"]
    assert bills.hour_rows({**stats, "sensor.l": [row(T, 4)]}, ids)[0] == (datetime(2026, 11, 16, 11, tzinfo=UTC), 1, 4)
    # no battery or solar ids: they count as nothing
    ids = {"bought": ["sensor.g"], "sent": [], "solar": [], "battery_out": [], "battery_in": [], "load": []}
    assert bills.hour_rows({"sensor.g": [row(T, 1)]}, ids) == [(datetime(2026, 11, 16, 11, tzinfo=UTC), 1, 1)]
    # the grid meter missing an hour: bought and house unknown
    ids["solar"] = ["sensor.p1"]
    assert bills.hour_rows({"sensor.g": [], "sensor.p1": [row(T, 2)]}, ids) == [
        (datetime(2026, 11, 16, 11, tzinfo=UTC), None, None)]


def test_hour_rows_meters_added_later():
    h0, h1 = datetime(2026, 11, 16, 11, tzinfo=UTC), datetime(2026, 11, 16, 12, tzinfo=UTC)
    ids = {"bought": ["sensor.g"], "sent": [], "solar": ["sensor.p1", "sensor.p2"],
           "battery_out": ["sensor.bo"], "battery_in": ["sensor.bi"], "load": []}
    # a battery and a second inverter first seen at h1: 0 before, so h0 keeps its house
    stats = {"sensor.g": [row(T, 1), row(T + 3600, 1)], "sensor.p1": [row(T, 2), row(T + 3600, 2)],
             "sensor.p2": [row(T + 3600, 1)], "sensor.bo": [row(T + 3600, 0.5)], "sensor.bi": [row(T + 3600, 0)]}
    assert bills.hour_rows(stats, ids) == [(h0, 1, 3), (h1, 1, 4.5)]
    # a load meter first seen at h1: h0 takes the balance
    ids["load"] = ["sensor.l"]
    assert bills.hour_rows({**stats, "sensor.l": [row(T + 3600, 4)]}, ids) == [(h0, 1, 3), (h1, 1, 4)]
    # a load meter with no rows at all, or missing an hour after its first: unknown, not the balance
    assert bills.hour_rows(stats, ids) == [(h0, 1, None), (h1, 1, None)]
    assert bills.hour_rows({**stats, "sensor.l": [row(T, 4)]}, ids)[1] == (h1, 1, None)
    # a sole solar meter missing before its first row is still unknown (no other meter counted that hour)
    ids = {"bought": ["sensor.g"], "sent": [], "solar": ["sensor.p2"], "battery_out": [], "battery_in": [], "load": []}
    assert bills.hour_rows(stats, ids)[0] == (h0, 1, None)


# ---- energy_ids ----
PREFS = {"energy_sources": [
    {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.in1"}, {"stat_energy_from": "sensor.in2"}],
     "flow_to": [{"stat_energy_to": "sensor.out"}]},
    {"type": "solar", "stat_energy_from": "sensor.sun"},
    {"type": "battery", "stat_energy_from": "sensor.bout", "stat_energy_to": "sensor.bin"}]}


def test_energy_ids_from_prefs_and_overrides():
    assert bills.energy_ids(PREFS, None) == {
        "bought": ["sensor.in1", "sensor.in2"], "sent": ["sensor.out"], "solar": ["sensor.sun"],
        "battery_out": ["sensor.bout"], "battery_in": ["sensor.bin"], "load": []}
    got = bills.energy_ids(PREFS, {"sensors": {"load_energy": "sensor.l"}})
    assert got["load"] == ["sensor.l"] and got["bought"] == ["sensor.in1", "sensor.in2"]
    # newer grid: one import and export pair
    new = {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.i", "stat_energy_to": "sensor.o"}]}
    assert bills.energy_ids(new, {})["bought"] == ["sensor.i"] and bills.energy_ids(new, {})["sent"] == ["sensor.o"]
    # sensors wins over entities; a list; [] switches a part off
    cfg = {"entities": {"solar_energy": "sensor.a", "battery_in_energy": "sensor.x"},
           "sensors": {"solar_energy": ["sensor.b", "sensor.c"], "battery_out_energy": []}}
    got = bills.energy_ids(PREFS, cfg)
    assert got["solar"] == ["sensor.b", "sensor.c"] and got["battery_in"] == ["sensor.x"] and got["battery_out"] == []


def test_energy_ids_grouped_entities():
    got = bills.energy_ids({}, {"plant": {"entities": {"grid_in_energy": "sensor.g"}}})
    assert got == {"bought": ["sensor.g"], "sent": [], "solar": [], "battery_out": [], "battery_in": [], "load": []}


# ---- months_attr ----
def test_months_attr():
    stored = {"2026-09": {"f1": .3, "f23": .2, "fixed": -4}, "2026-10": {"f1": .3}}
    assert bills.months_attr(stored, {"2026-09": {"cost": 1, "saved": 2}, "2026-10": None}) == {
        "2026-09": {"prices": {"f1": .3, "f23": .2}, "fixed": -4, "money": {"cost": 1, "saved": 2}},
        "2026-10": {"prices": {"f1": .3}, "fixed": None, "money": None}}


def test_energy_ids_odd_override_is_dropped_not_raised():
    """A number or a map where an id belongs is left out, as the page's readConfig does, never an error."""
    assert bills.energy_ids({}, {"sensors": {"grid_in_energy": 5}})["bought"] == []
    assert bills.energy_ids({}, {"sensors": {"grid_in_energy": {"a": 1}}})["bought"] == []


# ---- PUN estimate: months to estimate, estimate, money until now ----
def test_estimated_months_after_first_bill():
    assert bills.estimated_months({"2026-08": {}, "2026-09": {}}, "2026-11") == {"2026-10": "2026-09",
                                                                                  "2026-11": "2026-09"}
    # a gap between two bills is estimated from the latest bill before it; none before the first bill
    assert bills.estimated_months({"2026-06": {}, "2026-08": {}, "2026-11": {}}, "2026-11") == {
        "2026-07": "2026-06", "2026-09": "2026-08", "2026-10": "2026-08"}
    # across a new year
    assert bills.estimated_months({"2026-11": {}}, "2027-02") == {"2026-12": "2026-11", "2027-01": "2026-11",
                                                                   "2027-02": "2026-11"}
    assert bills.estimated_months({}, "2026-11") == {}
    assert bills.estimated_months({"2026-11": {}}, "2026-11") == {}


def test_estimates_reach_back_ten_years_at_most():
    # A typo year sends no download for every month since: only the last ten years, from the old bill.
    got = bills.Bills._estimated({"1999-09": {}}, datetime(2026, 11, 19))
    assert min(got) == "2016-11" and max(got) == "2026-11" and len(got) == 121 and set(got.values()) == {"1999-09"}


def test_estimate_follows_pun_times_k():
    assert bills.K == pytest.approx(1.21)
    sep = {"f1": .3468, "f2": .3, "f3": .25, "fixed": -4}
    got = bills.estimate(sep, {"f1": .20635, "f2": .2, "f3": .19}, {"f1": .23339, "f2": .2, "f3": .18})
    assert got == {"f1": .37952, "f2": .3, "f3": .2379}


def test_month_money_until_counts_elapsed_hours():
    until = datetime(2026, 11, 3, tzinfo=ROME)  # 48 hours elapsed: 95 % is 45.6
    rows = month_of(d1h10=(1, 3), d2h10=(2, 2), d16h10=(5, 5))
    assert bills.month_money(rows[:45], PRICES, ROME, "2026-11", until) is None
    # the hours at or after until are ignored (d16), the 95 % rule counts only the elapsed ones
    got = bills.month_money(rows, PRICES, ROME, "2026-11", until)
    # Sun 1 (holiday) 10:00 f3 0.2: cost 0.2 saved 0.4; Mon 2 10:00 f1 0.3: cost 0.6 saved 0
    assert got == {"cost": 0.8, "saved": 0.4,
                   "days": {"2026-11-01": {"cost": 0.2, "saved": 0.4}, "2026-11-02": {"cost": 0.6, "saved": 0}}}
    assert sum(d["cost"] for d in got["days"].values()) == pytest.approx(got["cost"])
    assert sum(d["saved"] for d in got["days"].values()) == pytest.approx(got["saved"])


def test_month_money_until_first_instant_is_none():
    assert bills.month_money(month_of(), PRICES, ROME, "2026-11", datetime(2026, 11, 1, tzinfo=ROME)) is None


def test_month_money_until_after_month_end_counts_whole_month():
    got = bills.month_money(month_of(), PRICES, ROME, "2026-11", datetime(2026, 12, 5, tzinfo=ROME))
    assert got["cost"] == 0 and len(got["days"]) == 30


def test_months_attr_flags_estimates_and_keeps_days_for_this_month():
    stored = {"2026-09": {"f1": .3, "fixed": -4}}
    day = {"2026-11-02": {"cost": 0.6, "saved": 0}}
    money = {"2026-09": {"cost": 1, "saved": 2, "days": day}, "2026-10": {"cost": 3, "saved": 4, "days": day},
             "2026-11": {"cost": 0.6, "saved": 0, "days": day}}
    estimates = {"2026-10": {"prices": {"f1": .31}, "fixed": -4}, "2026-11": {"prices": {"f1": .32}, "fixed": -4}}
    assert bills.months_attr(stored, money, estimates, "2026-11") == {
        "2026-09": {"prices": {"f1": .3}, "fixed": -4, "money": {"cost": 1, "saved": 2}},
        "2026-10": {"prices": {"f1": .31}, "fixed": -4, "money": {"cost": 3, "saved": 4}, "estimate": True},
        "2026-11": {"prices": {"f1": .32}, "fixed": -4, "money": {"cost": 0.6, "saved": 0}, "estimate": True,
                    "days": day}}


def test_load_reader_takes_the_owners_bill_months_function(tmp_path):
    assert bills.load_reader(tmp_path) is None  # no bill_reader.py: no reader
    (tmp_path / bills.READER_FILE).write_text("def bill_months(path):\n    return {'2026-09': {'f1': 0.3, 'fixed': 5.0}}\n", encoding="utf-8")
    assert bills.load_reader(tmp_path)(tmp_path / "x.pdf") == {"2026-09": {"f1": 0.3, "fixed": 5.0}}
    (tmp_path / bills.READER_FILE).write_text("def other():\n    pass\n", encoding="utf-8")
    with pytest.raises(AttributeError):
        bills.load_reader(tmp_path)


def test_hour_rows_meter_added_in_a_later_month():
    h0 = datetime(2026, 11, 16, 11, tzinfo=UTC)
    ids = {"bought": ["sensor.g"], "sent": [], "solar": ["sensor.p"], "battery_out": ["sensor.bo"],
           "battery_in": ["sensor.bi"], "load": ["sensor.l"]}
    stats = {"sensor.g": [row(T, 1)], "sensor.p": [row(T, 2)]}  # this month: no battery, no load meter yet
    later = T + 40 * 86400
    since = {"sensor.g": T, "sensor.p": T, "sensor.bo": later, "sensor.bi": later, "sensor.l": later}
    assert bills.hour_rows(stats, ids, since) == [(h0, 1, 3)]
    # without knowing when they came, they read as missing; a load meter never on record stays unknown
    assert bills.hour_rows(stats, ids) == [(h0, 1, None)]
    assert bills.hour_rows(stats, ids, {**since, "sensor.l": math.inf}) == [(h0, 1, None)]


def test_energy_ids_count_an_id_once_and_groups_match_settings():
    got = bills.energy_ids({}, {"sensors": {"grid_in_energy": ["sensor.g", "sensor.g"]}})
    assert got["bought"] == ["sensor.g"]
    import settings
    assert bills.GROUPS == settings.GROUPS


def test_hour_rows_meter_added_mid_month():
    # a battery added at h1 in this month: its month row starts on the 1st, yet h0 (before h1) is excused
    h0, h1 = datetime(2026, 11, 16, 11, tzinfo=UTC), datetime(2026, 11, 16, 12, tzinfo=UTC)
    ids = {"bought": ["sensor.g"], "sent": [], "solar": ["sensor.p"], "battery_out": ["sensor.bo"], "battery_in": ["sensor.bi"], "load": []}
    stats = {"sensor.g": [row(T, 1), row(T + 3600, 1)], "sensor.p": [row(T, 2), row(T + 3600, 2)],
             "sensor.bo": [row(T + 3600, 0.5)], "sensor.bi": [row(T + 3600, 0)]}
    nov1, dec1 = NOV.timestamp(), datetime(2026, 12, 1, tzinfo=ROME).timestamp()
    since = {"sensor.g": nov1 - 86400 * 400, "sensor.p": nov1 - 86400 * 400, "sensor.bo": nov1, "sensor.bi": nov1}
    assert bills.hour_rows(stats, ids, bills.since_outside(since, nov1, dec1)) == [(h0, 1, 3), (h1, 1, 3.5)]
    # a meter on record since an earlier month that misses an hour this month is unknown then, not excused
    gap = {"sensor.g": [row(T, 1), row(T + 3600, 1)], "sensor.p": [row(T + 3600, 2)]}
    ids2 = {**ids, "battery_out": [], "battery_in": []}
    assert bills.hour_rows(gap, ids2, bills.since_outside(since, nov1, dec1))[0] == (h0, 1, None)
