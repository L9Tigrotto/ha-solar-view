"""Bill prices: each month with a bill's figures priced band by band from its hourly statistics.
Plain functions, and Bills with Home Assistant imported only inside its methods, so tests/test_bills.py can run
them anywhere."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

_LOGGER = logging.getLogger(__name__)

# Italian national holidays ("MM-DD"), all F3; Easter Monday too (easter_monday). As the page's bandOf.
HOLIDAYS = ("01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26")
KINDS = {"three": {"f1", "f2", "f3"}, "two": {"f1", "f23"}, "single": {"f1"}}
# The groups solar_view.yaml may put its keys in, as the page's configOf reads them.
GROUPS = ("plant", "battery", "grid", "payback", "predictions", "machines", "prices", "display")
# Each figure: its name under sensors:, and the Energy settings source type and field it comes from otherwise.
ENERGY = {"bought": ("grid_in_energy", "grid", "stat_energy_from"), "sent": ("grid_out_energy", "grid", "stat_energy_to"),
          "solar": ("solar_energy", "solar", "stat_energy_from"),
          "batt_out": ("battery_out_energy", "battery", "stat_energy_from"),
          "batt_in": ("battery_in_energy", "battery", "stat_energy_to"), "load": ("load_energy", None, None)}
SHARE = 0.95  # hours with bought known a month needs before it is priced


def kind_of(prices: dict[str, float]) -> str | None:
    """The contract the bands given make: three, two or single. None for any other mix."""
    return next((k for k, bands in KINDS.items() if set(prices) == bands), None)


def easter_monday(year: int) -> date:
    """Easter Monday of `year` (the Gregorian computus)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    n = h + l - 7 * m + 114
    return date(year, n // 31, n % 31 + 1) + timedelta(days=1)


def band_of(day: date, hour: int, kind: str) -> str:
    """The band of the hour starting at local `hour` on `day`, as the page's bandOf: F1 Monday to Friday 8 to 19;
    F2 Monday to Friday 7 to 8 and 19 to 23, Saturday 7 to 23; F3 the rest, Sundays and holidays.
    Two bands join F2 and F3 as f23; single is f1 all day."""
    if kind == "single":
        return "f1"
    wd = day.weekday()  # Monday 0, Sunday 6
    if wd == 6 or day.strftime("%m-%d") in HOLIDAYS or day == easter_monday(day.year) or hour < 7 or hour >= 23:
        band = "f3"
    elif wd == 5 or hour < 8 or hour >= 19:
        band = "f2"
    else:
        band = "f1"
    return "f23" if kind == "two" and band != "f1" else band


def month_money(hours: list[tuple[datetime, float | None, float | None]], prices: dict[str, float],
                tz: ZoneInfo, month: str) -> dict | None:
    """What `month` ("2026-09") cost and saved at its bill's prices. `hours` are (start, bought kWh, house kWh):
    cost is bought x price, saved is house above bought x price. None when the bands make no contract, or fewer
    than 95 % of the month's hours (in `tz`, clock changes counted) have bought known."""
    kind = kind_of(prices)
    if kind is None:
        return None
    y, m = map(int, month.split("-"))
    first = datetime(y, m, 1, tzinfo=tz)
    after = datetime(y + m // 12, m % 12 + 1, 1, tzinfo=tz)
    total = (after.astimezone(timezone.utc) - first.astimezone(timezone.utc)) / timedelta(hours=1)
    cost = saved = 0.0
    known = 0
    for start, bought, house in hours:
        if bought is None:
            continue
        local = start.astimezone(tz)
        price = prices[band_of(local.date(), local.hour, kind)]
        known += 1
        cost += bought * price
        if house is not None:
            saved += max(0.0, house - bought) * price
    if known < SHARE * total:
        return None
    return {"cost": round(cost, 2), "saved": round(saved, 2)}


def energy_ids(prefs: dict, config: dict) -> dict[str, list[str]]:
    """The ids of each figure: from the Energy settings (`prefs`), unless the panel config names them under
    sensors: or entities: (at the top or in a group, as the page reads it; sensors wins). One id or a list."""
    top = config if isinstance(config, dict) else {}
    flat = {k: v for k, v in top.items() if k not in GROUPS and k != "sensors"}
    for g in GROUPS:
        if isinstance(top.get(g), dict):
            flat.update(top[g])
    own = flat.get("entities") if isinstance(flat.get("entities"), dict) else {}
    if isinstance(top.get("sensors"), dict):
        own = {**own, **top["sensors"]}
    # Older Home Assistant keeps a grid as lists of flows, newer as one import and export pair.
    sources = [x for s in (prefs or {}).get("energy_sources", [])
               for x in [s, *({**f, "type": s.get("type")} for k in ("flow_from", "flow_to") for f in s.get(k) or [])]]
    out = {}
    for key, (name, kind, field) in ENERGY.items():
        given = own.get(name)
        if given is not None:
            out[key] = [i for i in (given if isinstance(given, list) else [given]) if isinstance(i, str) and i]
        else:
            out[key] = [s[field] for s in sources if kind and s.get("type") == kind and s.get(field)]
    return out


def hour_rows(stats: dict[str, list[dict]], ids: dict[str, list[str]]
              ) -> list[tuple[datetime, float | None, float | None]]:
    """Each hour's (start, bought kWh, house kWh) from statistics rows ({"start": epoch seconds, "change"}).
    House is the load meter when named, else what flowed in minus what flowed out, at least 0 (the page's
    houseKwh). A figure with no ids counts as 0; one whose meter has no row that hour is None."""
    # ponytail: a meter added later makes its earlier hours None (the page's missingOk rule is not ported);
    # port it if a month with a second inverter added mid-month must be priced.
    change = {i: {r["start"]: max(0.0, r["change"]) for r in stats.get(i, []) if r.get("change") is not None}
              for key in ENERGY for i in ids.get(key, [])}
    starts = sorted({t for rows in change.values() for t in rows})

    def part(key: str, t: float) -> float | None:
        if any(t not in change[i] for i in ids.get(key, [])):
            return None
        return sum(change[i][t] for i in ids.get(key, []))

    out = []
    for t in starts:
        bought = part("bought", t)
        if ids.get("load"):
            house = part("load", t)
        else:
            flows = [part(k, t) for k in ("solar", "batt_out", "batt_in", "sent")]
            house = None if bought is None or None in flows else max(0.0, flows[0] + flows[1] + bought - flows[2] - flows[3])
        out.append((datetime.fromtimestamp(t, timezone.utc), bought, house))
    return out


def months_attr(stored: dict, money: dict[str, dict | None]) -> dict:
    """The sensor's months attribute: each stored month's prices, fixed part and money."""
    return {m: {"prices": {k: v for k, v in s.items() if k != "fixed"}, "fixed": s.get("fixed"), "money": money.get(m)}
            for m, s in stored.items()}


class Bills:
    """The months stored through the set_month_prices action and their priced `months` attribute, for
    sensor.solar_view_bills. Priced on setup and after each call, not hourly: a finished month's statistics stay."""

    def __init__(self, hass: Any) -> None:
        from homeassistant.helpers.storage import Store

        from .const import BILLS_STORE

        self.hass = hass
        self._store = Store(hass, 1, BILLS_STORE)
        self.stored: dict[str, dict[str, float]] = {}  # {"2026-09": {"f1": .., "f2": .., "f3": .., "fixed": ..}}
        self.months: dict = {}  # months_attr of the last pricing
        self._listeners: list[Callable[[], None]] = []
        self._lock = asyncio.Lock()  # one pricing at a time, so an older one never lands after a newer one

    def async_add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        """`cb` runs after each pricing; the returned function stops it."""
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    async def async_load(self) -> None:
        self.stored = await self._store.async_load() or {}

    async def async_set(self, month: str, figures: dict[str, float] | None) -> None:
        """Store `month`'s figures (None removes the month), save, then price again."""
        if figures is None:
            self.stored.pop(month, None)
        else:
            self.stored[month] = figures
        await self._store.async_save(self.stored)
        await self.async_price()

    async def async_price(self) -> None:
        """Every stored month priced from its own hours in Home Assistant's time zone; listeners told."""
        from homeassistant.components.energy.data import async_get_manager
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.statistics import statistics_during_period
        from homeassistant.util import dt as dt_util

        from .panel import async_read_config

        async with self._lock:
            stored = dict(self.stored)  # a call may change it while this one waits on the statistics
            tz = dt_util.get_default_time_zone()
            money: dict[str, dict | None] = {}
            if stored:
                ids = energy_ids((await async_get_manager(self.hass)).data or {}, await async_read_config(self.hass))
                wanted = {i for group in ids.values() for i in group}
                for month, figures in stored.items():
                    if not ids["bought"]:
                        money[month] = None
                        continue
                    # One month that cannot be priced (the recorder still starting, a bad stored key) leaves
                    # the others priced: it says so and keeps its statistics' figure on the page.
                    try:
                        y, m = map(int, month.split("-"))
                        start = datetime(y, m, 1, tzinfo=tz)
                        end = datetime(y + m // 12, m % 12 + 1, 1, tzinfo=tz)
                        stats = await get_instance(self.hass).async_add_executor_job(
                            statistics_during_period, self.hass, start, end, wanted, "hour", {"energy": "kWh"},
                            {"change"})
                        prices = {k: v for k, v in figures.items() if k != "fixed"}
                        money[month] = month_money(hour_rows(stats, ids), prices, tz, month)
                    except Exception as err:  # noqa: BLE001
                        _LOGGER.warning("Solar view: %s could not be priced from the statistics: %s", month, err)
                        money[month] = None
            self.months = months_attr(stored, money)
        for cb in list(self._listeners):
            cb()
