"""forecast.py: the solar_view integration's plain functions. Run: python -m pytest tests -q"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "custom_components" / "solar_view"))
import forecast as f  # noqa: E402

UTC, ROME = timezone.utc, ZoneInfo("Europe/Rome")
LAT, LON = 43.4, 11.9
NOW = datetime(2026, 11, 16, 9, tzinfo=UTC)


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


# ---- clear sky: the page's clearSky (dist/lib/sky.js), values printed by node ----
@pytest.mark.parametrize("t,lat,lon,want", [
    ("2026-06-21T10:00", 43.4, 11.9, 958.9013240934609),
    ("2026-12-21T11:00", 43.4, 11.9, 371.27494811661995),
    ("2026-03-20T06:00", 47.7, 9.2, 143.0957981317),
    ("2026-11-16T07:00", 43.4, 11.9, 124.50864457182718),
    ("2026-11-16T22:00", 43.4, 11.9, 0),
])
def test_clear_sky_matches_page(t, lat, lon, want):
    assert f.clear_sky(utc(t), lat, lon) == pytest.approx(want, rel=1e-9, abs=1e-9)


# ---- throttled hours ----
def test_throttled_needs_full_battery_and_capped_export():
    assert f.is_throttled(97, 0, 0) and f.is_throttled(99, 3.0, 3.3)
    assert not f.is_throttled(96.9, 0, 0)
    assert not f.is_throttled(98, 1.0, 3.3)    # export not at the cap
    assert not f.is_throttled(98, 0, None)     # unlimited export never throttles
    assert not f.is_throttled(None, 0, 0)      # no SOC sensor
    assert not f.is_throttled(98, None, 3.3)   # no export known, limit above 0


# ---- roof profile ----
def rows_for(days, ratio, end=utc("2026-11-16T00:00")):
    """Every hour of `days` days before `end`, each making `ratio` x its clear sky."""
    return [f.Row(t, ratio * f.clear_sky(t, LAT, LON), False)
            for t in (end - timedelta(hours=h + 1) for h in range(days * 24))]


def at_local_hour(days, hour, ratio, throttled=False, end=utc("2026-11-16T00:00")):
    """One row a day at local `hour`, for `days` days before `end`."""
    out = []
    for d in range(1, days + 1):
        local = (end - timedelta(days=d)).astimezone(ROME).replace(hour=hour)
        t = local.astimezone(UTC)
        out.append(f.Row(t, ratio * f.clear_sky(t, LAT, LON), throttled))
    return out


def test_profile_is_p90_of_ratio_over_clear_rows():
    p = f.roof_profile(rows_for(14, 0.004), LAT, LON, ROME, NOW)
    assert p[12] == pytest.approx(0.004) and p[2] == 0


def test_profile_ignores_rows_with_clear_sky_under_50():
    rows = rows_for(14, 0.004)
    base = f.roof_profile(rows, LAT, LON, ROME, NOW)
    dim = [r for r in rows if 0 < f.clear_sky(r.start, LAT, LON) <= 50]
    assert dim, "no dim hours to test with"
    spiked = [f.Row(r.start, 100.0, False) if r in dim else r for r in rows]
    assert f.roof_profile(spiked, LAT, LON, ROME, NOW) == base


def test_profile_leaves_out_throttled_rows():
    # high on purpose: kept, they would lift the 90th percentile
    rows = at_local_hour(10, 12, 0.004) + at_local_hour(4, 12, 0.01, throttled=True)
    p = f.roof_profile(rows, LAT, LON, ROME, NOW)
    assert p[12] == pytest.approx(0.004)


def test_profile_uses_throttled_rows_as_a_floor_under_5():
    rows = at_local_hour(10, 12, 0.004) + at_local_hour(4, 13, 0.001, throttled=True)
    p = f.roof_profile(rows, LAT, LON, ROME, NOW)
    assert p[13] == pytest.approx(0.001)       # not 0: the throttled rows are all it has


def test_profile_not_ready_until_clearest_hour_has_5_rows():
    assert f.roof_profile(rows_for(4, 0.004), LAT, LON, ROME, NOW) is None
    assert f.roof_profile(rows_for(5, 0.004), LAT, LON, ROME, NOW) is not None
    throttled = at_local_hour(10, 12, 0.004, throttled=True)
    assert f.roof_profile(throttled, LAT, LON, ROME, NOW) is None


def test_profile_ignores_rows_older_than_14_days():
    cut = NOW - timedelta(days=14)
    rows = [f.Row(r.start, r.kwh * (2.5 if r.start < cut else 1), False) for r in rows_for(20, 0.004)]
    assert f.roof_profile(rows, LAT, LON, ROME, NOW)[12] == pytest.approx(0.004)


# ---- weather ----
def test_merge_shifts_back_one_hour_and_falls_back_to_aifs():
    hourly = {"time": ["2026-11-16T10:00", "2026-11-16T11:00", "2026-11-16T12:00"],
              "shortwave_radiation_icon_2i": [100, None, None],
              "cloud_cover_icon_2i": [20, None, None], "precipitation_icon_2i": [0, None, None],
              "shortwave_radiation_ecmwf_aifs025_single": [90, 200, 300],
              "cloud_cover_ecmwf_aifs025_single": [30, 40, 50], "precipitation_ecmwf_aifs025_single": [0, 0.5, 1]}
    w = f.merge_weather(hourly, "icon_2i")
    assert w[utc("2026-11-16T09:00")] == f.Weather(100, 20, 0)
    assert w[utc("2026-11-16T10:00")] == f.Weather(200, 40, 0.5)


def test_merge_reads_unsuffixed_keys_for_aifs_alone():
    hourly = {"time": ["2026-11-16T10:00"], "shortwave_radiation": [90], "cloud_cover": [30], "precipitation": [0]}
    assert f.merge_weather(hourly, f.AIFS)[utc("2026-11-16T09:00")] == f.Weather(90, 30, 0)


def test_weather_url():
    u = f.weather_url(43.4, 11.9, "icon_2i")
    for part in ("hourly=shortwave_radiation,cloud_cover,precipitation", "forecast_days=16", "past_days=1",
                 "timezone=GMT", "models=icon_2i,ecmwf_aifs025_single", "latitude=43.4", "longitude=11.9"):
        assert part in u
    assert "models=ecmwf_aifs025_single&" in f.weather_url(43.4, 11.9, f.AIFS) + "&"
