"""The hourly run: the last 14 days from the statistics, the weather from Open-Meteo, then the forecast for the
sensor, the Energy settings and the stored day-ahead statistic (the maths is in forecast.py)."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp

from homeassistant.components.energy.data import async_get_manager
from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.models import StatisticMeanType
from homeassistant.components.recorder.statistics import async_add_external_statistics, statistics_during_period
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import CONF_EXPORT_LIMIT, CONF_MODEL, CONF_SOC, DOMAIN, STALE_AFTER_HOURS, STAT_ID
from .forecast import (
    AIFS, WINDOW_DAYS, Row, attributes, is_throttled, merge_weather, roof_profile, sun_hours, update_pending,
    weather_url, wh_hours,
)

_LOGGER = logging.getLogger(__name__)
ISSUE = "no_weather"


class SolarViewCoordinator(DataUpdateCoordinator[dict[str, Any] | None]):
    """data: {"written", "attributes", "wh_hours"}, or None while there is nothing to forecast from."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=timedelta(hours=1))
        self._store: Store[dict[str, Any]] = Store(hass, 1, DOMAIN)
        self._saved: dict[str, Any] | None = None  # {"weather": {"fetched", "hourly"}, "pending": {hour: kWh}}
        self._said: set[str] = set()  # causes already logged, so each is said once until it goes away

    def _say(self, cause: str, message: str) -> None:
        if cause not in self._said:
            self._said.add(cause)
            _LOGGER.warning(message)

    async def _async_update_data(self) -> dict[str, Any] | None:
        if self._saved is None:
            self._saved = await self._store.async_load() or {}
        cfg = self.config_entry.options or self.config_entry.data
        lat, lon, model = cfg[CONF_LATITUDE], cfg[CONF_LONGITUDE], cfg.get(CONF_MODEL) or AIFS
        now, tz = dt_util.utcnow(), dt_util.get_default_time_zone()
        hourly = await self._weather(lat, lon, model, now)
        if hourly is None:  # stale: nothing old may pass for a forecast, in the sensor or the Energy settings
            await self._store.async_save(self._saved)
            return None
        weather = merge_weather(hourly, model)
        rows = await self._rows(cfg, now)
        profile = roof_profile(rows, lat, lon, tz, now) if rows is not None else None
        if rows is not None and profile is None:
            self._say("not_ready", "Solar view: fewer than 5 clear midday hours on record yet, no forecast")
        if profile is None:
            await self._store.async_save(self._saved)
            return None
        self._said.discard("not_ready")
        sun = sun_hours(profile, weather, tz)
        pending, done = update_pending(self._saved.get("pending", {}), sun, now, tz)
        if done:
            async_add_external_statistics(self.hass, {
                "source": DOMAIN, "statistic_id": STAT_ID, "name": "Solar view sun forecast",
                "unit_of_measurement": "kWh", "unit_class": "energy", "has_sum": False,
                "mean_type": StatisticMeanType.ARITHMETIC,
            }, [{"start": t, "mean": v} for t, v in done])
        self._saved["pending"] = pending
        await self._store.async_save(self._saved)
        return {"written": now, "attributes": attributes(sun, weather, now, tz, lat, lon),
                "wh_hours": wh_hours(sun, now, tz)}

    async def _weather(self, lat: float, lon: float, model: str, now: datetime) -> dict[str, Any] | None:
        """Open-Meteo's hourly block: a fresh one, else the last good one while under STALE_AFTER_HOURS old.
        Older: the repair issue and None. Never any: the issue and UpdateFailed, so setup retries."""
        try:
            session = async_get_clientsession(self.hass)
            async with session.get(weather_url(lat, lon, model), timeout=aiohttp.ClientTimeout(total=30)) as resp:
                resp.raise_for_status()
                hourly = (await resp.json())["hourly"]
        except (aiohttp.ClientError, TimeoutError, KeyError, ValueError) as err:
            last = self._saved.get("weather")
            fetched = datetime.fromisoformat(last["fetched"]) if last else None
            if fetched and now - fetched < timedelta(hours=STALE_AFTER_HOURS):
                _LOGGER.debug("Open-Meteo failed (%s), reusing the weather from %s", err, fetched)
                return last["hourly"]
            ir.async_create_issue(
                self.hass, DOMAIN, ISSUE, is_fixable=False, severity=ir.IssueSeverity.WARNING,
                translation_key=ISSUE,
                translation_placeholders={"since": dt_util.as_local(fetched).strftime("%H:%M") if fetched else "-"})
            if not last:
                raise UpdateFailed(f"No weather from Open-Meteo: {err}") from err
            _LOGGER.debug("Open-Meteo failed (%s), the weather from %s is too old to use", err, fetched)
            return None
        self._saved["weather"] = {"fetched": now.isoformat(), "hourly": hourly}
        ir.async_delete_issue(self.hass, DOMAIN, ISSUE)
        return hourly

    async def _rows(self, cfg: Any, now: datetime) -> list[Row] | None:
        """The past 14 days' hours: kWh made (all solar sources in the Energy settings), throttled or not.
        None without a solar source."""
        prefs = (await async_get_manager(self.hass)).data or {}
        sources = prefs.get("energy_sources", [])
        solar = [s["stat_energy_from"] for s in sources if s.get("type") == "solar" and s.get("stat_energy_from")]
        export = [x for s in sources if s.get("type") == "grid"
                  for x in [s.get("stat_energy_to"), *(f.get("stat_energy_to") for f in s.get("flow_to", []))] if x]
        if not solar:
            self._say("no_solar", "Solar view: no solar panels in the Energy settings, nothing to forecast")
            return None
        self._said.discard("no_solar")
        soc, limit = cfg.get(CONF_SOC), cfg.get(CONF_EXPORT_LIMIT)
        end = now.replace(minute=0, second=0, microsecond=0)
        ids = set(solar) | set(export) | ({soc} if soc else set())
        stats = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, end - timedelta(days=WINDOW_DAYS), end, ids, "hour",
            {"energy": "kWh"}, {"change", "max", "mean"})

        def summed(names: list[str]) -> dict[float, float]:
            out: dict[float, float] = defaultdict(float)
            for name in names:
                for r in stats.get(name, []):
                    if r.get("change") is not None:
                        out[r["start"]] += max(0.0, r["change"])
            return out

        made, exported = summed(solar), summed(export)
        charge = {r["start"]: r["max"] if r.get("max") is not None else r.get("mean") for r in stats.get(soc, [])}
        return [Row(datetime.fromtimestamp(t, timezone.utc), kwh,
                    is_throttled(charge.get(t), exported.get(t) if export else None, limit))
                for t, kwh in made.items()]
