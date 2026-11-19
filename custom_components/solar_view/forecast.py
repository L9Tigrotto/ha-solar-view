"""The sun forecast: a roof profile learned from the plant's last 14 days, times Open-Meteo's forecast sunlight.
Plain functions with no Home Assistant imports, so tests/test_forecast.py can run them anywhere.
Times are aware datetimes; hours are keyed by their UTC start."""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

AIFS = "ecmwf_aifs025_single"  # the default weather model, and the fallback for days a shorter model lacks
WINDOW_DAYS = 14     # the roof profile learns from this many past days
FALLBACK_DAYS = 45   # and from this many when those were all grey
OVERCAST_SHARE = 0.5  # the short window's clearest hour under this share of the long one's: all grey
CLEAR_MIN_W = 50.0   # rows whose clear-sky sunlight is at most this (W/m2) say nothing about the roof
FROZEN_MIN_W = 300.0  # clear sky this bright and exactly 0 made: the meter was frozen, not dark (as the page)
FULL_CHARGE_PERCENT = 97.0      # battery % at or above which spare sun may have been held back
CAP_SHARE = 0.9      # export at this share of the limit counts as capped
MIN_ROWS = 5         # unthrottled rows an hour of the day needs before throttled ones are left out
SPREAD = 0.2         # low and high: this much either way of the mid, until MIN_PAIRS days are on record
MIN_PAIRS = 15       # days of day-ahead forecast against real production before the range is learned
KEEP_PAIRS = 90      # the newest days kept
FIXED = (1 - SPREAD, 1 + SPREAD)
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


def clear_sky(start: datetime, latitude: float, longitude: float) -> float:
    """Clear-sky sunlight on flat ground at the middle of the hour starting at `start`, W/m2.
    clearSky of frontend/lib/sky.js, line for line: Haurwitz, no equation of time."""
    d = start.astimezone(timezone.utc) + timedelta(minutes=30)
    n = (d - datetime(d.year, 1, 1, tzinfo=timezone.utc)).total_seconds() / 86400
    rad = math.pi / 180
    decl = 23.45 * rad * math.sin(2 * math.pi * (284 + n) / 365)
    ha = (d.hour + d.minute / 60 + longitude / 15 - 12) * 15 * rad
    c = math.sin(latitude * rad) * math.sin(decl) + math.cos(latitude * rad) * math.cos(decl) * math.cos(ha)
    return 1098 * c * math.exp(-0.057 / c) if c > 0.01 else 0.0


def is_throttled(max_charge_percent: float | None, export_kwh: float | None, export_limit_kw: float | None) -> bool:
    """The battery was full and export was capped, so production may have been held back."""
    if max_charge_percent is None or export_limit_kw is None or max_charge_percent < FULL_CHARGE_PERCENT:
        return False
    return export_limit_kw == 0 or (export_kwh is not None and export_kwh >= CAP_SHARE * export_limit_kw)


def _p90(values: list[float]) -> float:
    return values[0] if len(values) == 1 else statistics.quantiles(values, n=10, method="inclusive")[-1]


def roof_profile(rows: list[Row], latitude: float, longitude: float, now: datetime) -> dict[int, float] | None:
    """kWh per W/m2 of sunlight for each UTC hour of the day: the 90th percentile of made over clear sky. UTC, not
    local, so a clock change never mixes two solar hours. A row whose previous hour had sun and is missing is left
    out: the recorder's catch-up row carries the energy of every hour missed. A dark or dim hour missed (clear sky
    at most CLEAR_MIN_W: a sensor unavailable at night) carries next to none, so the morning's first row stays.
    A row of exactly 0 under a clear sky over FROZEN_MIN_W is a stalled meter: it and the row after it are left out.
    An hour with under MIN_ROWS unthrottled rows takes the higher of their 90th percentile and its highest
    throttled row: a throttled row says the roof could make at least that much.
    From the last WINDOW_DAYS days; from FALLBACK_DAYS when those were all grey (their clearest hour under
    OVERCAST_SHARE of the longer window's), as clouds already in the forecast's sunlight would count twice.
    None until the clearest hour of today has MIN_ROWS unthrottled rows."""
    starts = {r.start for r in rows}
    # A cloud integration that stalls writes 0 in bright hours, then all it missed in one later row: both out.
    frozen = {r.start for r in rows if r.kwh == 0 and clear_sky(r.start, latitude, longitude) > FROZEN_MIN_W}
    midnight = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    clearest = max(range(24), key=lambda h: clear_sky(midnight + timedelta(hours=h), latitude, longitude))

    def learned(days: int) -> dict[int, float] | None:
        since = now - timedelta(days=days)
        by_hour: dict[int, list[tuple[float, bool]]] = {}
        for r in rows:
            if r.start < since or r.kwh is None or not math.isfinite(r.kwh):
                continue
            if r.start - HOUR not in starts and clear_sky(r.start - HOUR, latitude, longitude) > CLEAR_MIN_W:
                continue
            if r.start in frozen or r.start - HOUR in frozen:
                continue
            cs = clear_sky(r.start, latitude, longitude)
            if cs > CLEAR_MIN_W:
                by_hour.setdefault(r.start.astimezone(timezone.utc).hour, []).append((r.kwh / cs, r.throttled))
        if sum(not t for _, t in by_hour.get(clearest, [])) < MIN_ROWS:
            return None
        profile = {}
        for h in range(24):
            got = by_hour.get(h, [])
            kept, held = [v for v, t in got if not t], [v for v, t in got if t]
            profile[h] = _p90(kept) if len(kept) >= MIN_ROWS else max(([_p90(kept)] if kept else []) + held, default=0.0)
        return profile

    recent, longer = learned(WINDOW_DAYS), learned(FALLBACK_DAYS)
    if recent is None or (longer is not None and recent[clearest] < OVERCAST_SHARE * longer[clearest]):
        return longer
    return recent


def weather_url(latitude: float, longitude: float, model: str) -> str:
    """One Open-Meteo call: the chosen model and, behind it, AIFS for the days it lacks."""
    models = AIFS if model == AIFS else f"{model},{AIFS}"
    q = {"latitude": latitude, "longitude": longitude, "hourly": ",".join(VARS), "models": models,
         "forecast_days": 16, "past_days": 1, "timezone": "GMT"}
    return "https://api.open-meteo.com/v1/forecast?" + urlencode(q, safe=",")


def forecast_linked(sources: list[dict], entry_id: str) -> bool:
    """Whether the Energy settings' solar forecasts are this entry alone. The page and the Energy dashboard add up
    every forecast linked to any solar source, and this one already covers all the panels: another beside it counts
    the sun twice, and the page at auto reads the other alone when this one is not linked."""
    linked = {e for s in sources if s.get("type") == "solar" for e in s.get("config_entry_solar_forecast") or []}
    return linked == {entry_id}


def merge_weather(hourly: dict, model: str) -> dict[datetime, Weather]:
    """Open-Meteo's hourly block as Weather by UTC hour start: the chosen model's value where it has one, else
    AIFS's. Open-Meteo labels an hour by its end, so every value moves one hour back."""
    models = list(dict.fromkeys([model, AIFS]))

    def pick(var: str, i: int) -> float | None:
        for key in [f"{var}_{m}" for m in models] + [var]:
            values = hourly.get(key)
            v = values[i] if isinstance(values, list) and i < len(values) else None
            if v is not None:
                return v
        return None

    out = {}
    for i, t in enumerate(hourly.get("time", [])):
        start = datetime.fromisoformat(t).replace(tzinfo=timezone.utc) - HOUR
        out[start] = Weather(*(pick(v, i) for v in VARS))
    return out


def sun_hours(profile: dict[int, float], weather: dict[datetime, Weather]) -> dict[datetime, float]:
    """kWh mid per UTC hour start: the roof profile at that UTC hour times the forecast sunlight."""
    return {t: profile[t.astimezone(timezone.utc).hour] * w.sw for t, w in weather.items() if w.sw is not None}


def _midnight(day: date, time_zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time(), time_zone).astimezone(timezone.utc)


def _range(v: float, spread: tuple[float, float] = FIXED) -> list[float]:
    return [round(v * spread[0], 3), round(v, 3), round(v * spread[1], 3)]


def _hours_of(day: date, time_zone: ZoneInfo) -> list[datetime]:
    """The UTC hour starts of a local day: 23, 24 or 25 of them. Whole UTC hours, as the weather and the sun are
    keyed: in a zone off the hour by 30 or 45 minutes, the first one starting just after local midnight."""
    def whole(t: datetime) -> datetime:  # the first whole UTC hour at or after t
        h = t.replace(minute=0, second=0, microsecond=0)
        return h if h == t else h + HOUR
    t, end, out = whole(_midnight(day, time_zone)), whole(_midnight(day + timedelta(days=1), time_zone)), []
    while t < end:
        out.append(t)
        t += HOUR
    return out


def attributes(sun: dict[datetime, float], weather: dict[datetime, Weather], now: datetime, time_zone: ZoneInfo,
               latitude: float, longitude: float, spread: tuple[float, float] = FIXED) -> dict:
    """The forecast sensor's attributes (the page's contract, see sensorOf in frontend/lib/forecast.js): every hour
    of today and tomorrow, the rest of today, and every day from today on that the forecast fully covers.
    `spread`: the low and high as multiples of the mid (see learned_spread). Sun only: house use and prices are null, months left out."""
    today = now.astimezone(time_zone).date()
    none = Weather(None, None, None)
    hours = []
    for t in _hours_of(today, time_zone) + _hours_of(today + timedelta(days=1), time_zone):
        w = weather.get(t, none)
        hours.append({"t": t.astimezone(time_zone).isoformat(), "sun": _range(sun.get(t, 0.0), spread), "use": None,
                      "cloud": None if w.cloud is None else round(w.cloud),
                      "rain": None if w.rain is None else round(w.rain, 1), "buy": None, "sell": None})
    left = sum(sun.get(t, 0.0) * min(1.0, (t + HOUR - now) / HOUR) for t in _hours_of(today, time_zone) if t + HOUR > now)
    days, day = [], today
    last = max(sun).astimezone(time_zone).date() if sun else today
    while day <= last:  # a day with a gap is left out, not the days after it
        hs = _hours_of(day, time_zone)
        if not all(t in sun for t in hs):
            day += timedelta(days=1)
            continue
        lit = [weather[t].cloud for t in hs if weather[t].cloud is not None and clear_sky(t, latitude, longitude) > 0]
        days.append({"d": day.isoformat(), "sun": _range(sum(sun[t] for t in hs), spread), "use": None,
                     "cloud": round(sum(lit) / len(lit)) if lit else None,
                     "rain": round(sum(weather[t].rain or 0 for t in hs), 1)})
        day += timedelta(days=1)
    return {"hours": hours, "left": {"sun": _range(left, spread), "use": None}, "days": days}


def wh_hours(sun: dict[datetime, float], now: datetime, time_zone: ZoneInfo) -> dict[str, float]:
    """The Energy settings' Solar Forecast: Wh by UTC hour start, from the start of today."""
    start = _midnight(now.astimezone(time_zone).date(), time_zone)
    return {t.isoformat(): round(v * 1000, 1) for t, v in sorted(sun.items()) if t >= start}


def update_pending(pending: dict[str, float], sun: dict[datetime, float], now: datetime,
                   time_zone: ZoneInfo) -> tuple[dict[str, float], list[tuple[datetime, float]]]:
    """Day-ahead forecasts waiting to be stored. Tomorrow's hours are (re)written on every run, so each day keeps
    the last forecast made the day before; hours that have ended leave the map, returned in time order."""
    tomorrow = now.astimezone(time_zone).date() + timedelta(days=1)
    p = dict(pending)
    p.update({t.isoformat(): v for t, v in sun.items() if t.astimezone(time_zone).date() == tomorrow})
    done = sorted((datetime.fromisoformat(k), v) for k, v in p.items() if datetime.fromisoformat(k) + HOUR <= now)
    for t, _ in done:
        del p[t.isoformat()]
    return p, done


def record_pairs(ended: dict[str, float], pairs: dict[str, list[float]], rows: list[Row], now: datetime,
                 time_zone: ZoneInfo) -> tuple[dict[str, float], dict[str, list[float]]]:
    """Day-ahead forecast hours that have ended (`ended`, hour start -> kWh) against what was made: each local day that
    ended over an hour ago becomes [forecast, made] in `pairs` (by its date), summed over the hours that have both and
    were not throttled, as the roof profile leaves them out. Days with under 0.5 kWh on either side say nothing and
    are dropped. Returns what is left of `ended` (days still running, nothing older than 3 days) and the newest
    KEEP_PAIRS pairs."""
    made = {r.start: r for r in rows if r.kwh is not None and math.isfinite(r.kwh)}
    days: dict[date, list[datetime]] = {}
    for k in ended:
        t = datetime.fromisoformat(k)
        days.setdefault(t.astimezone(time_zone).date(), []).append(t)
    left, out = dict(ended), {k: list(v) for k, v in pairs.items()}
    for day, hours in days.items():
        if _midnight(day + timedelta(days=1), time_zone) > now - HOUR:
            continue
        both = [t for t in hours if t in made and not made[t].throttled]
        f, a = sum(ended[t.isoformat()] for t in both), sum(made[t].kwh for t in both)
        if f > 0.5 and a > 0.5 and day.isoformat() not in out:
            out[day.isoformat()] = [round(f, 3), round(a, 3)]
        for t in hours:
            del left[t.isoformat()]
    left = {k: v for k, v in left.items() if datetime.fromisoformat(k) > now - timedelta(days=3)}
    return left, dict(sorted(out.items())[-KEEP_PAIRS:])


def learned_spread(pairs: dict[str, list[float]]) -> tuple[float, float]:
    """The low and high multiples of the mid: the 10th and 90th percentile of made over forecast, one range for every
    day ahead (the day-ahead pairs are all there is, and on the owner's 245 backtest days a range by lead was not
    clearly different). The mid stays inside it. FIXED until MIN_PAIRS days are on record."""
    ratios = [a / f for f, a in pairs.values() if f > 0]
    if len(ratios) < MIN_PAIRS:
        return FIXED
    q = statistics.quantiles(ratios, n=10, method="inclusive")
    return round(min(1.0, q[0]), 3), round(max(1.0, q[-1]), 3)
