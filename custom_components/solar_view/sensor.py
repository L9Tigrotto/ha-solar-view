"""sensor.solar_view_forecast: the page's forecast (see sensorOf in frontend/lib/forecast.js). Its state is the time
it was written. sensor.solar_view_bills: the months priced at their bills' figures; its state is the latest one.
Neither's attributes are recorded."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import SolarViewConfigEntry
from .bills import Bills
from .const import DOMAIN
from .coordinator import SolarViewCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: SolarViewConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_add_entities([ForecastSensor(entry.runtime_data, entry.entry_id),
                        BillsSensor(entry.runtime_data.bills, entry.entry_id)])


def _device(entry_id: str) -> DeviceInfo:
    return DeviceInfo(identifiers={(DOMAIN, entry_id)}, name="Solar view", entry_type=DeviceEntryType.SERVICE)


class ForecastSensor(CoordinatorEntity[SolarViewCoordinator], SensorEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "forecast"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _unrecorded_attributes = frozenset({"hours", "left", "days"})

    def __init__(self, coordinator: SolarViewCoordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self.entity_id = "sensor.solar_view_forecast"  # the page's fixed id, whatever language names it
        self._attr_unique_id = f"{entry_id}_forecast"
        self._attr_device_info = _device(entry_id)

    @property
    def native_value(self) -> datetime | None:
        return self.coordinator.data["written"] if self.coordinator.data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self.coordinator.data["attributes"] if self.coordinator.data else None


class BillsSensor(SensorEntity):
    """Written by Bills after each pricing, not by the coordinator: billed months stay while the forecast has none."""
    _attr_has_entity_name = True
    _attr_translation_key = "bills"
    _attr_should_poll = False
    _unrecorded_attributes = frozenset({"months"})

    def __init__(self, bills: Bills, entry_id: str) -> None:
        self._bills = bills
        self.entity_id = "sensor.solar_view_bills"  # the page's fixed id, whatever language names it
        self._attr_unique_id = f"{entry_id}_bills"
        self._attr_device_info = _device(entry_id)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._bills.async_add_listener(self.async_write_ha_state))

    @property
    def native_value(self) -> str | None:
        return max(self._bills.months, default=None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"months": self._bills.months}
