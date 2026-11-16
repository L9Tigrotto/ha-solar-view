"""Solar view: the sun forecast from the roof's own last 14 days and Open-Meteo, for the Solar view page and
the Energy dashboard."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, issue_registry as ir
from homeassistant.helpers.storage import Store

from .const import DOMAIN, ISSUE_PICK, ISSUE_WEATHER
from .coordinator import SolarViewCoordinator
from .panel import async_serve_files, async_setup_panel, remove_panel

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type SolarViewConfigEntry = ConfigEntry[SolarViewCoordinator]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await async_serve_files(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> bool:
    # The panel first: the page works without the forecast, so it stays in the sidebar while Open-Meteo is down
    # and the first refresh fails (setup retries, and replaces it).
    await async_setup_panel(hass)
    coordinator = SolarViewCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    # A coordinator without listeners stops polling: keep it running when the sensor is disabled, since the
    # Energy forecast and the stored day-ahead values come from the same runs.
    entry.async_on_unload(coordinator.async_add_listener(lambda: None))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    # Here and not through entry.async_on_unload, whose callbacks also run when setup fails and retries.
    if unloaded:
        remove_panel(hass)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> None:
    """Removed: its panel, its repair issues and its stored weather and day-ahead values go too. The sun_forecast
    statistic stays, as every removed integration's statistics do (Developer tools > Statistics deletes it)."""
    remove_panel(hass)  # an entry deleted while its setup retries is never unloaded
    for issue in (ISSUE_WEATHER, ISSUE_PICK):
        ir.async_delete_issue(hass, DOMAIN, issue)
    await Store(hass, 1, DOMAIN).async_remove()


async def _reload(hass: HomeAssistant, entry: SolarViewConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
