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


# ---- sensor attributes, Energy hours, day-ahead map ----
def flat(start, n, sw=500.0, cloud=40.0, rain=0.2):
    return {start + timedelta(hours=i): f.Weather(sw, cloud, rain) for i in range(n)}


ONE = {h: 0.001 for h in range(24)}  # 500 W/m2 makes 0.5 kWh every hour


def build(now, w):
    return f.attributes(f.sun_hours(ONE, w, ROME), w, now, ROME, LAT, LON)


@pytest.mark.parametrize("now,n", [(utc("2026-11-16T09:30"), 48), (utc("2026-03-28T09:30"), 47), (utc("2026-10-24T09:30"), 49)])
def test_hours_cover_today_and_tomorrow_on_normal_and_dst_days(now, n):
    a = build(now, flat(now.replace(minute=0) - timedelta(days=2), 24 * 20))
    ts = [h["t"] for h in a["hours"]]
    assert len(ts) == n and len(set(ts)) == n
    assert ts[0] == now.astimezone(ROME).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    h0 = a["hours"][0]
    assert h0["sun"] == [0.4, 0.5, 0.6] and h0["use"] is None and h0["buy"] is None and h0["sell"] is None
    assert h0["cloud"] == 40 and h0["rain"] == 0.2
    assert "months" not in a


def test_days_sum_their_hours_and_drop_a_partial_last_day():
    w = flat(utc("2026-11-15T23:00"), 24 * 3 + 5)  # today, tomorrow, the day after, and 5 hours more
    a = build(utc("2026-11-16T09:30"), w)
    assert [d["d"] for d in a["days"]] == ["2026-11-16", "2026-11-17", "2026-11-18"]
    d0 = a["days"][0]
    assert d0["sun"] == [pytest.approx(9.6), pytest.approx(12.0), pytest.approx(14.4)] and d0["use"] is None
    assert d0["rain"] == pytest.approx(4.8) and d0["cloud"] == 40


def test_day_cloud_is_the_mean_over_daylight_hours():
    w = flat(utc("2026-11-15T23:00"), 24 * 3)
    w = {t: (f.Weather(v.sw, 100, v.rain) if f.clear_sky(t, LAT, LON) == 0 else v) for t, v in w.items()}
    assert build(utc("2026-11-16T09:30"), w)["days"][0]["cloud"] == 40  # night's 100 % left out


def test_left_counts_only_the_part_of_today_still_ahead():
    a = build(utc("2026-11-16T08:30"), flat(utc("2026-11-15T23:00"), 24 * 3))  # 09:30 in Rome
    assert a["left"]["use"] is None
    assert a["left"]["sun"] == [pytest.approx(5.8), pytest.approx(7.25), pytest.approx(8.7)]


def test_wh_hours_from_start_of_today_in_wh():
    sun = f.sun_hours(ONE, flat(utc("2026-11-15T20:00"), 24 * 3), ROME)
    wh = f.wh_hours(sun, utc("2026-11-16T08:30"), ROME)
    assert min(wh) == "2026-11-15T23:00:00+00:00" and wh["2026-11-15T23:00:00+00:00"] == 500.0
    assert "2026-11-15T22:00:00+00:00" not in wh


def test_sun_hours_skip_hours_without_sunlight_given():
    w = {utc("2026-11-16T11:00"): f.Weather(None, 50, 0), utc("2026-11-16T12:00"): f.Weather(400, 50, 0)}
    assert f.sun_hours(ONE, w, ROME) == {utc("2026-11-16T12:00"): pytest.approx(0.4)}


def test_pending_keeps_last_forecast_of_the_day_before_and_writes_once():
    p, out = f.update_pending({}, {utc("2026-11-17T10:00"): 1.0}, utc("2026-11-16T08:00"), ROME)
    assert out == [] and p == {"2026-11-17T10:00:00+00:00": 1.0}
    p, out = f.update_pending(p, {utc("2026-11-17T10:00"): 2.0}, utc("2026-11-16T20:00"), ROME)
    assert p["2026-11-17T10:00:00+00:00"] == 2.0                       # overwritten the day before
    p, out = f.update_pending(p, {utc("2026-11-17T10:00"): 9.0}, utc("2026-11-17T08:00"), ROME)
    assert p["2026-11-17T10:00:00+00:00"] == 2.0 and out == []          # frozen on the day itself
    p, out = f.update_pending(p, {}, utc("2026-11-17T11:00"), ROME)
    assert out == [(utc("2026-11-17T10:00"), 2.0)] and p == {}          # written once the hour has ended
