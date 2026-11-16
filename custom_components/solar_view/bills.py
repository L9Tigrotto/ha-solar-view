"""Bill prices: each month with a bill's figures priced band by band from its hourly statistics.
Plain functions, and Bills with Home Assistant imported only inside its methods, so tests/test_bills.py can run
them anywhere."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
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
# A month without a bill: each band moves from the last bill's by K x the PUN Index GME's move (spec part 2).
LOSSES = 0.10  # grid losses on the PUN (ARERA may revise them)
VAT = 0.10
K = (1 + LOSSES) * (1 + VAT)


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


def month_after(month: str) -> str:
    """The month after `month` ("2026-12" -> "2027-01")."""
    y, m = map(int, month.split("-"))
    return f"{y + m // 12:04d}-{m % 12 + 1:02d}"


def estimated_months(stored: dict, this_month: str) -> dict[str, str]:
    """Each month after the first stored one, up to `this_month`, with no bill of its own, to the latest stored
    month before it (the bill its estimate starts from)."""
    out: dict[str, str] = {}
    if not stored:
        return out
    last = min(stored)
    month = month_after(last)
    while month <= this_month:
        if month in stored:
            last = month
        else:
            out[month] = last
        month = month_after(month)
    return out


def estimate(bill: dict[str, float], pun_bill: dict[str, float], pun_month: dict[str, float]) -> dict[str, float]:
    """A month's band prices from the last bill before it: each band of `bill` (fixed left out) moved by K x the
    PUN's move from the bill's month (`pun_bill`) to this one (`pun_month`), EUR/kWh."""
    return {b: round(p + K * (pun_month[b] - pun_bill[b]), 5) for b, p in bill.items() if b != "fixed"}


def month_money(hours: list[tuple[datetime, float | None, float | None]], prices: dict[str, float],
                tz: ZoneInfo, month: str, until: datetime | None = None) -> dict | None:
    """What `month` ("2026-09") cost and saved at its bill's prices. `hours` are (start, bought kWh, house kWh):
    cost is bought x price, saved is house above bought x price. With `until` (this month: its last full hour),
    only the hours before it count, and the result also has each local day's {"cost", "saved"} under "days".
    None when the bands make no contract, no hour came before `until`, or fewer than 95 % of the month's hours
    up to `until` (in `tz`, clock changes counted) have bought known."""
    kind = kind_of(prices)
    if kind is None:
        return None
    y, m = map(int, month.split("-"))
    first = datetime(y, m, 1, tzinfo=tz)
    end = datetime(y + m // 12, m % 12 + 1, 1, tzinfo=tz)
    if until is not None:
        end = min(end, until)
    total = (end.astimezone(timezone.utc) - first.astimezone(timezone.utc)) / timedelta(hours=1)
    cost = saved = 0.0
    known = 0
    days: dict[str, list[float]] = {}
    for start, bought, house in hours:
        if bought is None or (until is not None and start >= until):
            continue
        local = start.astimezone(tz)
        price = prices[band_of(local.date(), local.hour, kind)]
        known += 1
        day = days.setdefault(local.date().isoformat(), [0.0, 0.0])
        day[0] += bought * price
        cost += bought * price
        if house is not None:
            day[1] += max(0.0, house - bought) * price
            saved += max(0.0, house - bought) * price
    if total <= 0 or known < SHARE * total:
        return None
    out: dict[str, Any] = {"cost": round(cost, 2), "saved": round(saved, 2)}
    if until is not None:
        out["days"] = {d: {"cost": round(c, 2), "saved": round(s, 2)} for d, (c, s) in sorted(days.items())}
    return out


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


def months_attr(stored: dict, money: dict[str, dict | None], estimates: dict[str, dict] | None = None,
                this_month: str | None = None) -> dict:
    """The sensor's months attribute: each stored month's prices, fixed part and money, then each estimated month
    ({month: {"prices", "fixed"}}) flagged "estimate". The money's per-day figures are kept, as "days", for
    `this_month`'s entry only."""
    out = {m: {"prices": {k: v for k, v in s.items() if k != "fixed"}, "fixed": s.get("fixed")}
           for m, s in stored.items()}
    out.update({m: {"prices": e["prices"], "fixed": e.get("fixed"), "estimate": True}
                for m, e in (estimates or {}).items()})
    for m, entry in out.items():
        cash = money.get(m)
        entry["money"] = None if cash is None else {k: v for k, v in cash.items() if k != "days"}
        if m == this_month and cash and "days" in cash:
            entry["days"] = cash["days"]
    return out


class Bills:
    """The months stored through the set_month_prices action and their priced `months` attribute, for
    sensor.solar_view_bills. Priced on setup and after each call; with `pun`, also each hour (this month's
    statistics grow), the months without a bill estimated from the PUN Index GME."""

    def __init__(self, hass: Any, pun: bool = False) -> None:
        from homeassistant.helpers.storage import Store

        from .const import BILLS_STORE, FILES_STORE, PUN_STORE

        self.hass = hass
        self._store = Store(hass, 1, BILLS_STORE)
        self._files_store = Store(hass, 1, FILES_STORE)
        self._files: dict[str, str] = {}  # {"<sha256 of a bill PDF>": "<its file name>"}, each read once
        self._reading = asyncio.Lock()  # one folder scan at a time (setup's can still run at a quarter past)
        self.stored: dict[str, dict[str, float]] = {}  # {"2026-09": {"f1": .., "f2": .., "f3": .., "fixed": ..}}
        self.months: dict = {}  # months_attr of the last pricing
        self._listeners: list[Callable[[], None]] = []
        self._lock = asyncio.Lock()  # one pricing at a time, so an older one never lands after a newer one
        self.pun = pun
        self._pun_store = Store(hass, 1, PUN_STORE)
        # {"2026-09": {"three": {..}, "two": {..}, "single": {..}}}; this month's entry also has its fetch "day"
        self._pun: dict[str, dict] = {}
        # (month, day) of a failed fetch: said once and not tried again that day (a try can take a minute, holding
        # the lock that set_month_prices waits on); ("file", name) of a bill PDF that could not be opened
        self._warned: set[tuple[str, str]] = set()
        # A finished month's money by month, with the prices it was priced at: the hourly pricing reads only this
        # month's statistics again. A month priced None (the recorder still starting) is read again.
        self._priced: dict[str, tuple[tuple, dict]] = {}

    def async_add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        """`cb` runs after each pricing; the returned function stops it."""
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    async def async_load(self) -> None:
        self.stored = await self._store.async_load() or {}
        self._files = await self._files_store.async_load() or {}
        if self.pun:
            self._pun = await self._pun_store.async_load() or {}

    async def async_set(self, month: str, figures: dict[str, float] | None) -> None:
        """Store `month`'s figures (None removes the month), save, then price again."""
        if figures is None:
            self.stored.pop(month, None)
        else:
            self.stored[month] = figures
        await self._async_save_and_price()

    async def _async_save_and_price(self) -> None:
        await self._store.async_save(self.stored)
        await self.async_price()

    async def async_read_folder(self) -> bool:
        """Each bill PDF in <config>/solar_view_bills/ not read before (by the SHA-256 of its bytes), in name order:
        its months stored as async_set stores them, the later file winning a month. Saved and priced when a month
        came; returns whether it did, so the caller prices otherwise."""
        from homeassistant.util import dt as dt_util

        from .const import BILLS_DIR
        from .stg import bill_months, read_pdf

        def scan(folder: Path) -> list[tuple[Path, str | None]]:
            # A folder that cannot be listed (permissions, a share gone) reads as empty: pricing still runs.
            try:
                if not folder.is_dir():
                    return []
                paths = sorted(p for p in folder.iterdir() if p.suffix.lower() == ".pdf" and p.is_file())
            except OSError as err:
                _LOGGER.warning("Solar view: the bills folder %s could not be listed: %s", folder, err)
                return []
            out: list[tuple[Path, str | None]] = []
            for path in paths:
                try:
                    out.append((path, hashlib.sha256(path.read_bytes()).hexdigest()))
                except OSError:
                    out.append((path, None))
            return out

        async with self._reading:
            files = await self.hass.async_add_executor_job(scan, Path(self.hass.config.path(BILLS_DIR)))
            new_files = changed = False
            for path, digest in files:
                if digest is None:
                    if ("file", path.name) not in self._warned:
                        self._warned.add(("file", path.name))
                        _LOGGER.warning("Solar view: bill %s could not be opened", path.name)
                    continue
                if digest in self._files:
                    continue
                self._files[digest] = path.name  # remembered even when it fails: not tried again each hour
                new_files = True
                try:
                    months = await self.hass.async_add_executor_job(lambda p=path: bill_months(read_pdf(p)))
                except Exception as err:  # noqa: BLE001
                    _LOGGER.warning("Solar view: bill %s could not be read: %s", path.name, err)
                    continue
                if not months:
                    _LOGGER.warning("Solar view: no month read from bill %s", path.name)
                    continue
                this_month = dt_util.now().strftime("%Y-%m")
                for month, figures in sorted(months.items()):
                    if month >= this_month:  # as the action: only a finished month takes a bill's prices
                        _LOGGER.warning("Solar view: bill %s has %s, which is not over yet: left out", path.name, month)
                        continue
                    old = self.stored.get(month)
                    if old is not None and old != figures:
                        _LOGGER.info("Solar view: %s from bill %s replaces the stored %s", month, path.name, old)
                    self.stored[month] = figures
                changed = True
                _LOGGER.info("Solar view: read bill %s: %s", path.name, ", ".join(sorted(months)))
            # The months before the hashes: stopped in between, a bill is read again rather than lost.
            if changed:
                await self._store.async_save(self.stored)
            if new_files:
                await self._files_store.async_save(self._files)
        if changed:
            await self.async_price()
        return changed

    async def _async_means(self, stored: dict, estimated: dict[str, str], now: datetime) -> None:
        """The PUN's band means of each month an estimate needs (its own and its bill's), from GME: a finished
        month once (again when it was last fetched unfinished), this month once a day. A failure warns once per
        month and day and keeps what is stored."""
        import aiohttp

        from homeassistant.helpers.aiohttp_client import async_get_clientsession

        from .pun import HEADERS, band_means, parse_zip, url_for

        this_month, today = now.strftime("%Y-%m"), now.date()
        need: dict[str, set[str]] = {}
        for month, bill in estimated.items():
            kind = kind_of({k: v for k, v in stored[bill].items() if k != "fixed"})
            if kind is not None:
                for m in (month, bill):
                    need.setdefault(m, set()).add(kind)
        changed = False
        for month, kinds in sorted(need.items()):
            entry = self._pun.get(month, {})
            if (month, today.isoformat()) in self._warned:
                continue
            if month == this_month:
                if entry.get("day") == today.isoformat():
                    continue
            elif "day" not in entry and kinds <= entry.keys():
                continue
            y, m = map(int, month.split("-"))
            first = date(y, m, 1)
            last = min(date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1), today)
            try:
                async with async_get_clientsession(self.hass).get(
                        url_for(first, last), headers=HEADERS, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    resp.raise_for_status()
                    data = await resp.read()
                prices = await self.hass.async_add_executor_job(parse_zip, data)
                means = {k: v for k in KINDS if (v := band_means(prices, k)) is not None}
                if not means:
                    raise ValueError("no hour in it")
            except (aiohttp.ClientError, TimeoutError, ValueError) as err:
                self._warned.add((month, today.isoformat()))
                _LOGGER.warning("Solar view: no PUN Index GME for %s (%s), keeping what is stored", month, err)
                continue
            self._pun[month] = {**means, **({"day": today.isoformat()} if month == this_month else {})}
            changed = True
        if changed:
            await self._pun_store.async_save(self._pun)

    async def async_price(self) -> None:
        """Every stored month priced from its own hours in Home Assistant's time zone, and with `pun` every month
        without a bill after the first one estimated (this month up to its last full hour); listeners told."""
        from homeassistant.components.energy.data import async_get_manager
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.statistics import statistics_during_period
        from homeassistant.util import dt as dt_util

        from .panel import async_read_config

        async with self._lock:
            stored = dict(self.stored)  # a call may change it while this one waits on the statistics
            tz = dt_util.get_default_time_zone()
            now = dt_util.now()
            this_month = now.strftime("%Y-%m")
            estimated = estimated_months(stored, this_month) if self.pun else {}
            if estimated:
                await self._async_means(stored, estimated, now)
            estimates: dict[str, dict] = {}
            for month, bill in estimated.items():
                prices = {k: v for k, v in stored[bill].items() if k != "fixed"}
                kind = kind_of(prices)
                pun_bill, pun_month = self._pun.get(bill, {}).get(kind), self._pun.get(month, {}).get(kind)
                if pun_bill and pun_month:  # a month never fetched is left out
                    estimates[month] = {"prices": estimate(prices, pun_bill, pun_month),
                                        "fixed": stored[bill].get("fixed")}
            # Each month to price: its prices and the hour its money stops at (None: the month's end).
            hour = now.replace(minute=0, second=0, microsecond=0)
            todo = {m: ({k: v for k, v in s.items() if k != "fixed"}, None) for m, s in stored.items()}
            todo.update({m: (e["prices"], hour if m == this_month else None) for m, e in estimates.items()})
            money: dict[str, dict | None] = {}
            if stored:
                ids = energy_ids((await async_get_manager(self.hass)).data or {}, await async_read_config(self.hass))
                wanted = {i for group in ids.values() for i in group}
                for month, (prices, until) in todo.items():
                    if not ids["bought"]:
                        money[month] = None
                        continue
                    key = tuple(sorted(prices.items()))
                    if until is None and self._priced.get(month, (None,))[0] == key:
                        money[month] = self._priced[month][1]
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
                        money[month] = month_money(hour_rows(stats, ids), prices, tz, month, until)
                        if until is None and money[month] is not None:
                            self._priced[month] = (key, money[month])
                    except Exception as err:  # noqa: BLE001
                        _LOGGER.warning("Solar view: %s could not be priced from the statistics: %s", month, err)
                        money[month] = None
            self.months = months_attr(stored, money, estimates, this_month)
        for cb in list(self._listeners):
            cb()
