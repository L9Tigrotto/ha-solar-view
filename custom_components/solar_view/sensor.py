"""sensor.solar_view_forecast: the page's forecast (see sensorOf in dist/lib/forecast.js). Its state is the time
it was written; its attributes are not recorded."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import SolarViewConfigEntry
from .const import DOMAIN
from .coordinator import SolarViewCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: SolarViewConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_add_entities([ForecastSensor(entry.runtime_data, entry.entry_id)])


class ForecastSensor(CoordinatorEntity[SolarViewCoordinator], SensorEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "forecast"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _unrecorded_attributes = frozenset({"hours", "left", "days"})

    def __init__(self, coordinator: SolarViewCoordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self.entity_id = "sensor.solar_view_forecast"  # the page's fixed id, whatever language names it
        self._attr_unique_id = f"{entry_id}_forecast"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, entry_id)}, name="Solar view",
                                            entry_type=DeviceEntryType.SERVICE)

    @property
    def native_value(self) -> datetime | None:
        return self.coordinator.data["written"] if self.coordinator.data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self.coordinator.data["attributes"] if self.coordinator.data else None
