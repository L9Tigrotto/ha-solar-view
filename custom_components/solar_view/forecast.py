"""The sun forecast: a roof profile learned from the plant's last 14 days, times Open-Meteo's forecast sunlight.
Plain functions with no Home Assistant imports, so tests/test_forecast.py can run them anywhere.
Times are aware datetimes; hours are keyed by their UTC start."""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

AIFS = "ecmwf_aifs025_single"  # the default weather model, and the fallback for days a shorter model lacks
WINDOW_DAYS = 14     # the roof profile learns from this many past days
CLEAR_MIN_W = 50.0   # rows whose clear-sky sunlight is at most this (W/m2) say nothing about the roof
FULL_SOC = 97.0      # battery % at or above which spare sun may have been held back
CAP_SHARE = 0.9      # export at this share of the limit counts as capped
MIN_ROWS = 5         # unthrottled rows an hour of the day needs before throttled ones are left out
SPREAD = 0.2         # low and high: this much either way of the mid
HOUR = timedelta(hours=1)
VARS = ("shortwave_radiation", "cloud_cover", "precipitation")


@dataclass(frozen=True)
class Row:
    """One past hour: its UTC start, kWh made, and whether spare sun may have been held back."""
    start: datetime
    kwh: float
    throttled: bool


@dataclass(frozen=True)
class Weather:
    """One forecast hour: shortwave W/m2, cloud cover %, precipitation mm (None when not given)."""
    sw: float | None
    cloud: float | None
    rain: float | None


def clear_sky(start: datetime, lat: float, lon: float) -> float:
    """Clear-sky sunlight on flat ground at the middle of the hour starting at `start`, W/m2.
    clearSky of dist/lib/sky.js, line for line: Haurwitz, no equation of time."""
    d = start.astimezone(timezone.utc) + timedelta(minutes=30)
    n = (d - datetime(d.year, 1, 1, tzinfo=timezone.utc)).total_seconds() / 86400
    rad = math.pi / 180
    decl = 23.45 * rad * math.sin(2 * math.pi * (284 + n) / 365)
    ha = (d.hour + d.minute / 60 + lon / 15 - 12) * 15 * rad
    c = math.sin(lat * rad) * math.sin(decl) + math.cos(lat * rad) * math.cos(decl) * math.cos(ha)
    return 1098 * c * math.exp(-0.057 / c) if c > 0.01 else 0.0


def is_throttled(soc_max: float | None, export_kwh: float | None, export_limit_kw: float | None) -> bool:
    """The battery was full and export was capped, so production may have been held back."""
    if soc_max is None or export_limit_kw is None or soc_max < FULL_SOC:
        return False
    return export_limit_kw == 0 or (export_kwh is not None and export_kwh >= CAP_SHARE * export_limit_kw)


def _p90(values: list[float]) -> float:
    return values[0] if len(values) == 1 else statistics.quantiles(values, n=10, method="inclusive")[-1]


def roof_profile(rows: list[Row], lat: float, lon: float, tz: ZoneInfo, now: datetime) -> dict[int, float] | None:
    """kWh per W/m2 of sunlight for each local hour of the day: the 90th percentile of made over clear sky.
    None until the clearest hour of today has MIN_ROWS unthrottled rows."""
    since = now - timedelta(days=WINDOW_DAYS)
    by_hour: dict[int, list[tuple[float, bool]]] = {}
    for r in rows:
        if r.start < since or r.kwh is None or not math.isfinite(r.kwh):
            continue
        cs = clear_sky(r.start, lat, lon)
        if cs > CLEAR_MIN_W:
            by_hour.setdefault(r.start.astimezone(tz).hour, []).append((r.kwh / cs, r.throttled))
    midnight = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    clearest = max(range(24), key=lambda h: clear_sky((midnight + timedelta(hours=h)).astimezone(timezone.utc), lat, lon))
    if sum(not t for _, t in by_hour.get(clearest, [])) < MIN_ROWS:
        return None
    profile = {}
    for h in range(24):
        got = by_hour.get(h, [])
        kept = [v for v, t in got if not t]
        use = kept if len(kept) >= MIN_ROWS else [v for v, _ in got]
        profile[h] = _p90(use) if use else 0.0
    return profile


def weather_url(lat: float, lon: float, model: str) -> str:
    """One Open-Meteo call: the chosen model and, behind it, AIFS for the days it lacks."""
    models = AIFS if model == AIFS else f"{model},{AIFS}"
    q = {"latitude": lat, "longitude": lon, "hourly": ",".join(VARS), "models": models,
         "forecast_days": 16, "past_days": 1, "timezone": "GMT"}
    return "https://api.open-meteo.com/v1/forecast?" + urlencode(q, safe=",")


def merge_weather(hourly: dict, model: str) -> dict[datetime, Weather]:
    """Open-Meteo's hourly block as Weather by UTC hour start: the chosen model's value where it has one, else
    AIFS's. Open-Meteo labels an hour by its end, so every value moves one hour back."""
    models = list(dict.fromkeys([model, AIFS]))

    def pick(var: str, i: int) -> float | None:
        for key in [f"{var}_{m}" for m in models] + [var]:
            v = (hourly.get(key) or [None] * (i + 1))[i]
            if v is not None:
                return v
        return None

    out = {}
    for i, t in enumerate(hourly.get("time", [])):
        start = datetime.fromisoformat(t).replace(tzinfo=timezone.utc) - HOUR
        out[start] = Weather(*(pick(v, i) for v in VARS))
    return out
