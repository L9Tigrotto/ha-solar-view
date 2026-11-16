"""bills.py: pricing a month at its bill's figures. Run: python -m pytest tests -q"""
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
    ids = {"bought": ["sensor.g"], "sent": [], "solar": [], "batt_out": [], "batt_in": [], "load": ["sensor.l"]}
    got = bills.hour_rows({"sensor.g": [row(T, -5)], "sensor.l": [row(T, 2)]}, ids)
    assert got == [(datetime(2026, 11, 16, 11, tzinfo=UTC), 0, 2)]


def test_hour_rows_balance_and_load():
    ids = {"bought": ["sensor.g"], "sent": ["sensor.s"], "solar": ["sensor.p1", "sensor.p2"],
           "batt_out": ["sensor.bo"], "batt_in": ["sensor.bi"], "load": []}
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
    ids = {"bought": ["sensor.g"], "sent": [], "solar": [], "batt_out": [], "batt_in": [], "load": []}
    assert bills.hour_rows({"sensor.g": [row(T, 1)]}, ids) == [(datetime(2026, 11, 16, 11, tzinfo=UTC), 1, 1)]
    # the grid meter missing an hour: bought and house unknown
    ids["solar"] = ["sensor.p1"]
    assert bills.hour_rows({"sensor.g": [], "sensor.p1": [row(T, 2)]}, ids) == [
        (datetime(2026, 11, 16, 11, tzinfo=UTC), None, None)]


# ---- energy_ids ----
PREFS = {"energy_sources": [
    {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.in1"}, {"stat_energy_from": "sensor.in2"}],
     "flow_to": [{"stat_energy_to": "sensor.out"}]},
    {"type": "solar", "stat_energy_from": "sensor.sun"},
    {"type": "battery", "stat_energy_from": "sensor.bout", "stat_energy_to": "sensor.bin"}]}


def test_energy_ids_from_prefs_and_overrides():
    assert bills.energy_ids(PREFS, None) == {
        "bought": ["sensor.in1", "sensor.in2"], "sent": ["sensor.out"], "solar": ["sensor.sun"],
        "batt_out": ["sensor.bout"], "batt_in": ["sensor.bin"], "load": []}
    got = bills.energy_ids(PREFS, {"sensors": {"load_energy": "sensor.l"}})
    assert got["load"] == ["sensor.l"] and got["bought"] == ["sensor.in1", "sensor.in2"]
    # newer grid: one import and export pair
    new = {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.i", "stat_energy_to": "sensor.o"}]}
    assert bills.energy_ids(new, {})["bought"] == ["sensor.i"] and bills.energy_ids(new, {})["sent"] == ["sensor.o"]
    # sensors wins over entities; a list; [] switches a part off
    cfg = {"entities": {"solar_energy": "sensor.a", "battery_in_energy": "sensor.x"},
           "sensors": {"solar_energy": ["sensor.b", "sensor.c"], "battery_out_energy": []}}
    got = bills.energy_ids(PREFS, cfg)
    assert got["solar"] == ["sensor.b", "sensor.c"] and got["batt_in"] == ["sensor.x"] and got["batt_out"] == []


def test_energy_ids_grouped_entities():
    got = bills.energy_ids({}, {"plant": {"entities": {"grid_in_energy": "sensor.g"}}})
    assert got == {"bought": ["sensor.g"], "sent": [], "solar": [], "batt_out": [], "batt_in": [], "load": []}


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
