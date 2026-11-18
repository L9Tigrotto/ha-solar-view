"""Solar view: the sun forecast from the roof's own last 14 days and Open-Meteo, for the Solar view page and
the Energy dashboard."""
from __future__ import annotations

import os

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, issue_registry as ir
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .bills import Bills, kind_of
from .const import (BILLS_DIR, BILLS_STORE, CONF_PUN, DOMAIN, FILES_STORE, ISSUE_PICK, ISSUE_WEATHER, PUN_STORE,
                    SERVICE_PRICES)
from .coordinator import SolarViewCoordinator
from .panel import async_serve_files, async_setup_panel, remove_panel

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type SolarViewConfigEntry = ConfigEntry[SolarViewCoordinator]

BANDS = ("f1", "f2", "f3", "f23")
PRICES_SCHEMA = vol.Schema({
    vol.Required("month"): vol.All(cv.string, vol.Match(r"^(19|20)\d{2}-(0[1-9]|1[0-2])$")),
    # Bounded so nan and inf never reach the sensor's attributes.
    **{vol.Optional(b): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)) for b in BANDS},
    # Below 0 too: a bonus can outweigh the fixed part.
    vol.Optional("fixed"): vol.All(vol.Coerce(float), vol.Range(min=-100000, max=100000)),
})


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await async_serve_files(hass)

    async def set_prices(call: ServiceCall) -> None:
        """A finished month's bill figures stored and priced; the month alone removes it."""
        entry = next((e for e in hass.config_entries.async_entries(DOMAIN)
                      if e.state is ConfigEntryState.LOADED), None)
        if entry is None:
            raise ServiceValidationError("Solar view is not loaded")
        month = call.data["month"]
        if month >= dt_util.now().strftime("%Y-%m"):
            raise ServiceValidationError(f"{month} is not over yet: only finished months take a bill's prices")
        bands = {b: call.data[b] for b in BANDS if b in call.data}
        if not bands and "fixed" in call.data:
            raise ServiceValidationError("A month needs its band prices beside the fixed part")
        if bands and kind_of(bands) is None:
            raise ServiceValidationError("Give f1, f2 and f3; or f1 and f23; or f1 alone")
        figures = {**bands, **({"fixed": call.data["fixed"]} if "fixed" in call.data else {})} if bands else None
        await entry.runtime_data.bills.async_set(month, figures)

    hass.services.async_register(DOMAIN, SERVICE_PRICES, set_prices, schema=PRICES_SCHEMA)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> bool:
    # The panel first: the page works without the forecast, so it stays in the sidebar while Open-Meteo is down
    # and the first refresh fails (setup retries, and replaces it).
    await async_setup_panel(hass, {**entry.data, **entry.options})
    coordinator = SolarViewCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    coordinator.bills = bills = Bills(hass, pun=bool((entry.options or {}).get(CONF_PUN)))
    await coordinator.bills.async_load()
    entry.runtime_data = coordinator
    # A coordinator without listeners stops polling: keep it running when the sensor is disabled, since the
    # Energy forecast and the stored day-ahead values come from the same runs.
    entry.async_on_unload(coordinator.async_add_listener(lambda: None))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    async def _read_and_price(always: bool) -> None:
        if not await bills.async_read_folder() and always:  # a bill read has priced already
            await bills.async_price()

    # In the background: a year of billed months reads a year of hourly statistics, the new bills are parsed
    # first, and startup need not wait.
    entry.async_create_background_task(hass, _read_and_price(True), "solar_view bills")
    # This month's estimate grows with its statistics: priced again at a quarter past each hour, once Home
    # Assistant has written the last hour's (the page asks for them then too). The bills folder is read then too.
    if bills.pun or await hass.async_add_executor_job(os.path.isdir, hass.config.path(BILLS_DIR)):
        async def _hourly(_now) -> None:
            await _read_and_price(bills.pun)

        entry.async_on_unload(async_track_time_change(hass, _hourly, minute=15, second=0))
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    # Here and not through entry.async_on_unload, whose callbacks also run when setup fails and retries.
    if unloaded:
        remove_panel(hass)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> None:
    """Removed: its panel, its repair issues, its stored weather and day-ahead values, its bills, read files and PUN
    means go too. The sun_forecast statistic stays, as every removed integration's statistics do (Developer tools >
    Statistics deletes it)."""
    remove_panel(hass)  # an entry deleted while its setup retries is never unloaded
    for issue in (ISSUE_WEATHER, ISSUE_PICK):
        ir.async_delete_issue(hass, DOMAIN, issue)
    await Store(hass, 1, DOMAIN).async_remove()
    await Store(hass, 1, BILLS_STORE).async_remove()
    await Store(hass, 1, PUN_STORE).async_remove()
    await Store(hass, 1, FILES_STORE).async_remove()


async def _reload(hass: HomeAssistant, entry: SolarViewConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
