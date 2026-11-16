"""Setup and options: where the panels are, the battery's charge sensor, the export limit; options add the
weather model."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector, EntitySelectorConfig, NumberSelector, NumberSelectorConfig, NumberSelectorMode, TextSelector,
)

from .const import CONF_EXPORT_LIMIT, CONF_MODEL, CONF_SOC, DOMAIN
from .forecast import AIFS


def _schema(d: dict[str, Any], options: bool) -> vol.Schema:
    def coord(lo: float, hi: float) -> NumberSelector:
        return NumberSelector(NumberSelectorConfig(min=lo, max=hi, step="any", mode=NumberSelectorMode.BOX))

    fields: dict[Any, Any] = {
        vol.Required(CONF_LATITUDE, default=d.get(CONF_LATITUDE)): coord(-90, 90),
        vol.Required(CONF_LONGITUDE, default=d.get(CONF_LONGITUDE)): coord(-180, 180),
        vol.Optional(CONF_SOC, description={"suggested_value": d.get(CONF_SOC)}):
            EntitySelector(EntitySelectorConfig(domain="sensor")),
        vol.Optional(CONF_EXPORT_LIMIT, description={"suggested_value": d.get(CONF_EXPORT_LIMIT)}):
            NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, unit_of_measurement="kW",
                                                mode=NumberSelectorMode.BOX)),
    }
    if options:
        fields[vol.Required(CONF_MODEL, default=d.get(CONF_MODEL) or AIFS)] = TextSelector()
    return vol.Schema(fields)


class SolarViewConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Solar view", data=user_input)
        home = {CONF_LATITUDE: self.hass.config.latitude, CONF_LONGITUDE: self.hass.config.longitude}
        return self.async_show_form(step_id="user", data_schema=_schema(home, options=False))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SolarViewOptionsFlow()


class SolarViewOptionsFlow(OptionsFlow):
    """Every field again: the options replace the setup's answers whole, so a field cleared here stays cleared."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        now = self.config_entry.options or self.config_entry.data
        return self.async_show_form(step_id="init", data_schema=_schema(dict(now), options=True))
