"""The Energy settings' Solar Forecast: pick "Solar view" there and the Energy dashboard, and the Solar view
page at level usual_days_weather, read this forecast."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_get_solar_forecast(hass: HomeAssistant, config_entry_id: str) -> dict[str, dict[str, float]] | None:
    entry = hass.config_entries.async_get_entry(config_entry_id)
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        return None
    data = entry.runtime_data.data
    return {"wh_hours": data["wh_hours"]} if data else None
