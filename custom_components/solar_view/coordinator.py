"""The hourly run: the last 14 days from the statistics, the weather from Open-Meteo, then the forecast for the
sensor, the Energy settings and the stored day-ahead statistic (the maths is in forecast.py)."""
from __future__ import annotations

import logging
import math
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

from .bills import Bills
from .const import (
    CONF_EXPORT_LIMIT, CONF_MODEL, CONF_CHARGE_SENSOR, DOMAIN, ISSUE_PICK, ISSUE_WEATHER, STALE_AFTER_HOURS, STAT_ID,
)
from .forecast import (
    AIFS, FALLBACK_DAYS, Row, attributes, forecast_linked, is_throttled, merge_weather, roof_profile, sun_hours,
    learned_spread, record_pairs, update_pending, weather_url, wh_hours,
)

_LOGGER = logging.getLogger(__name__)
REFETCH_AFTER = timedelta(minutes=55)  # saved weather younger than this is used without asking Open-Meteo


class SolarViewCoordinator(DataUpdateCoordinator[dict[str, Any] | None]):
    """data: {"written", "attributes", "wh_hours"}, or None while there is nothing to forecast from."""

    bills: Bills  # set by async_setup_entry before the platforms load

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=timedelta(hours=1))
        self._store: Store[dict[str, Any]] = Store(hass, 1, DOMAIN)
        self._saved: dict[str, Any] | None = None  # {"weather": {"fetched", "hourly"}, "pending": {hour: kWh},
        # "ended": the day-ahead hours that ended, "pairs": {day: [forecast, made]} (see forecast.record_pairs)}
        self._linked = False  # see _rows
        self._said: set[str] = set()  # causes already logged, so each is said once until it goes away

    def _say(self, cause: str, message: str) -> None:
        if cause not in self._said:
            self._said.add(cause)
            _LOGGER.warning(message)

    async def _async_update_data(self) -> dict[str, Any] | None:
        if self._saved is None:
            self._saved = await self._store.async_load() or {}
        entry_config = {**self.config_entry.data, **self.config_entry.options}
        latitude, longitude = entry_config[CONF_LATITUDE], entry_config[CONF_LONGITUDE]
        model = (entry_config.get(CONF_MODEL) or "").strip() or AIFS  # saved before the options flow stripped it
        now, time_zone = dt_util.utcnow(), dt_util.get_default_time_zone()
        hourly = await self._weather(latitude, longitude, model, now)
        if hourly is None:  # stale: nothing old may pass for a forecast, in the sensor or the Energy settings
            return None
        weather = merge_weather(hourly, model)
        rows = await self._rows(entry_config, now)
        profile = roof_profile(rows, latitude, longitude, now) if rows is not None else None
        if rows == []:
            self._say("no_stats", "Solar view: the Energy settings' solar panels have no statistics yet, no forecast")
        elif rows is not None and profile is None:
            self._say("not_ready", "Solar view: fewer than 5 clear midday hours on record yet, no forecast")
        if profile is None:
            await self._store.async_save(self._saved)
            return None
        self._said -= {"no_stats", "not_ready"}
        sun = sun_hours(profile, weather)
        pending, done = update_pending(self._saved.get("pending", {}), sun, now, time_zone)
        if done:
            async_add_external_statistics(self.hass, {
                "source": DOMAIN, "statistic_id": STAT_ID, "name": "Solar view sun forecast",
                "unit_of_measurement": "kWh", "unit_class": "energy", "has_sum": False,
                "mean_type": StatisticMeanType.ARITHMETIC,
            }, [{"start": t, "mean": v} for t, v in done])
        self._saved["pending"] = pending
        ended = {**self._saved.get("ended", {}), **{t.isoformat(): v for t, v in done}}
        self._saved["ended"], self._saved["pairs"] = record_pairs(ended, self._saved.get("pairs", {}), rows, now, time_zone)
        await self._store.async_save(self._saved)
        spread = learned_spread(self._saved["pairs"])
        # weather_fetched: when Open-Meteo last answered (the weather may be reused up to STALE_AFTER_HOURS old).
        return {"written": now, "attributes": {**attributes(sun, weather, now, time_zone, latitude, longitude, spread),
                                               "weather_fetched": self._saved["weather"]["fetched"],
                                               # linked: the Energy settings' solar forecast is this one alone, so
                                               # the page may give it this sensor's learned range (see data.js)
                                               "linked": self._linked},
                "wh_hours": wh_hours(sun, now, time_zone)}

    async def _weather(self, latitude: float, longitude: float, model: str, now: datetime) -> dict[str, Any] | None:
        """Open-Meteo's hourly block: a fresh one, else the last good one while under STALE_AFTER_HOURS old.
        Older: the repair issue and None. Never any: UpdateFailed, so setup retries (no issue: setup shows it).
        One under REFETCH_AFTER old for the same place and model is used as it is: a restart or an options edit
        reloads the entry, and Open-Meteo's models update hourly at most."""
        last = self._saved.get("weather")
        if last and last.get("where") == [latitude, longitude, model] and now - datetime.fromisoformat(last["fetched"]) < REFETCH_AFTER:
            return last["hourly"]
        try:
            session = async_get_clientsession(self.hass)
            async with session.get(weather_url(latitude, longitude, model), timeout=aiohttp.ClientTimeout(total=30)) as resp:
                resp.raise_for_status()
                hourly = (await resp.json())["hourly"]
            if not isinstance(hourly, dict):
                raise ValueError("no hourly block")
        except (aiohttp.ClientError, TimeoutError, KeyError, TypeError, ValueError) as err:
            if isinstance(err, aiohttp.ClientResponseError) and err.status == 400:  # not an outage: a model it lacks
                self._say("bad_model", f"Solar view: Open-Meteo does not know the weather model {model!r}, "
                          "pick another in the options")
            last = self._saved.get("weather")
            if last and last.get("where") not in (None, [latitude, longitude, model]):
                last = None  # another place or model: its weather does not fit
            fetched = datetime.fromisoformat(last["fetched"]) if last else None
            if fetched and now - fetched < timedelta(hours=STALE_AFTER_HOURS):
                _LOGGER.debug("Open-Meteo failed (%s), reusing the weather from %s", err, fetched)
                return last["hourly"]
            if not last:
                raise UpdateFailed(f"No weather from Open-Meteo: {err}") from err
            ir.async_create_issue(
                self.hass, DOMAIN, ISSUE_WEATHER, is_fixable=False, severity=ir.IssueSeverity.WARNING,
                translation_key=ISSUE_WEATHER,
                translation_placeholders={"since": dt_util.as_local(fetched).strftime("%H:%M")})
            _LOGGER.debug("Open-Meteo failed (%s), the weather from %s is too old to use", err, fetched)
            return None
        self._saved["weather"] = {"fetched": now.isoformat(), "where": [latitude, longitude, model], "hourly": hourly}
        self._said.discard("bad_model")
        ir.async_delete_issue(self.hass, DOMAIN, ISSUE_WEATHER)
        return hourly

    async def _rows(self, entry_config: Any, now: datetime) -> list[Row] | None:
        """The past FALLBACK_DAYS days' hours (see roof_profile): kWh made (all solar sources in the Energy settings), throttled or not.
        None without a solar source."""
        prefs = (await async_get_manager(self.hass)).data or {}
        sources = prefs.get("energy_sources", [])
        solar = [s["stat_energy_from"] for s in sources if s.get("type") == "solar" and s.get("stat_energy_from")]
        export = [x for s in sources if s.get("type") == "grid"
                  for x in [s.get("stat_energy_to"), *(f.get("stat_energy_to") for f in s.get("flow_to") or [])] if x]
        if not solar:
            ir.async_delete_issue(self.hass, DOMAIN, ISSUE_PICK)  # nothing to pick it for
            self._say("no_solar", "Solar view: no solar panels in the Energy settings, nothing to forecast")
            return None
        self._said.discard("no_solar")
        self._linked = forecast_linked(sources, self.config_entry.entry_id)
        if self._linked:
            ir.async_delete_issue(self.hass, DOMAIN, ISSUE_PICK)
        else:
            ir.async_create_issue(self.hass, DOMAIN, ISSUE_PICK, is_fixable=False,
                                  severity=ir.IssueSeverity.WARNING, translation_key=ISSUE_PICK)
        limit = entry_config.get(CONF_EXPORT_LIMIT)
        # The charge sensor set in the options, else every battery's in the Energy settings (as the page reads them).
        soc_ids = [entry_config[CONF_CHARGE_SENSOR]] if entry_config.get(CONF_CHARGE_SENSOR) else [
            s["stat_soc"] for s in sources if s.get("type") == "battery" and s.get("stat_soc")]
        # The YAML's export_max_kw wins over the options' (see settings.merge).
        from .panel import async_read_config
        from .settings import yaml_flat

        own = yaml_flat(await async_read_config(self.hass)).get("export_max_kw")
        if isinstance(own, (int, float)) and not isinstance(own, bool) and 0 <= own < math.inf:
            limit = own
        end = now.replace(minute=0, second=0, microsecond=0)
        ids = set(solar) | set(export) | set(soc_ids)
        stats = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, end - timedelta(days=FALLBACK_DAYS), end, ids, "hour",
            {"energy": "kWh"}, {"change", "max", "mean"})

        def summed(names: list[str]) -> dict[float, float]:
            out: dict[float, float] = defaultdict(float)
            for name in names:
                for r in stats.get(name, []):
                    if r.get("change") is not None:
                        out[r["start"]] += max(0.0, r["change"])
            return out

        made, exported = summed(solar), summed(export)
        # Full only when every battery was: the lowest of their highest charges in the hour.
        highest = [{r["start"]: r["max"] if r.get("max") is not None else r.get("mean") for r in stats.get(i, [])} for i in soc_ids]
        charge = {t: min(h.get(t) for h in highest) for t in set().union(*highest)
                  if all(h.get(t) is not None for h in highest)} if highest else {}
        return [Row(datetime.fromtimestamp(t, timezone.utc), kwh,
                    is_throttled(charge.get(t), exported.get(t) if export else None, limit))
                for t, kwh in made.items()]
