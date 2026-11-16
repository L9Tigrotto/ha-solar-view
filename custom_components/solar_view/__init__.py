"""Solar view: the sun forecast from the roof's own last 14 days and Open-Meteo, for the Solar view page and
the Energy dashboard."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .coordinator import SolarViewCoordinator

PLATFORMS = [Platform.SENSOR]

type SolarViewConfigEntry = ConfigEntry[SolarViewCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: SolarViewConfigEntry) -> bool:
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
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _reload(hass: HomeAssistant, entry: SolarViewConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
