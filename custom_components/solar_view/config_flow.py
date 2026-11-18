"""Setup and options: where the panels are, the battery's charge sensor, the export limit; options add the
weather model and the PUN estimate."""
from __future__ import annotations

from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector, EntitySelector, EntitySelectorConfig, NumberSelector, NumberSelectorConfig, NumberSelectorMode,
    TextSelector,
)

from .const import CONF_EXPORT_LIMIT, CONF_MODEL, CONF_PUN, CONF_CHARGE_SENSOR, DOMAIN
from .forecast import AIFS, weather_url


def _schema(d: dict[str, Any], options: bool) -> vol.Schema:
    def coord(lo: float, hi: float) -> NumberSelector:
        return NumberSelector(NumberSelectorConfig(min=lo, max=hi, step="any", mode=NumberSelectorMode.BOX))

    fields: dict[Any, Any] = {
        vol.Required(CONF_LATITUDE, default=d.get(CONF_LATITUDE)): coord(-90, 90),
        vol.Required(CONF_LONGITUDE, default=d.get(CONF_LONGITUDE)): coord(-180, 180),
        vol.Optional(CONF_CHARGE_SENSOR, description={"suggested_value": d.get(CONF_CHARGE_SENSOR)}):
            EntitySelector(EntitySelectorConfig(domain="sensor")),
        vol.Optional(CONF_EXPORT_LIMIT, description={"suggested_value": d.get(CONF_EXPORT_LIMIT)}):
            NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, unit_of_measurement="kW",
                                                mode=NumberSelectorMode.BOX)),
    }
    if options:
        fields[vol.Required(CONF_MODEL, default=d.get(CONF_MODEL) or AIFS)] = TextSelector()
        fields[vol.Required(CONF_PUN, default=bool(d.get(CONF_PUN)))] = BooleanSelector()
    return vol.Schema(fields)


async def _model_known(hass: HomeAssistant, d: dict[str, Any]) -> bool:
    """False only when Open-Meteo answers 400, its answer to a model it lacks; an outage cannot tell, so it passes."""
    try:
        async with async_get_clientsession(hass).get(weather_url(d[CONF_LATITUDE], d[CONF_LONGITUDE], d[CONF_MODEL]),
                                                     timeout=aiohttp.ClientTimeout(total=15)) as resp:
            return resp.status != 400
    except (aiohttp.ClientError, TimeoutError):
        return True


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
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_MODEL] = user_input[CONF_MODEL].strip() or AIFS
            if await _model_known(self.hass, user_input):
                return self.async_create_entry(data=user_input)
            errors[CONF_MODEL] = "bad_model"
        now = user_input or self.config_entry.options or self.config_entry.data
        return self.async_show_form(step_id="init", data_schema=_schema(dict(now), options=True), errors=errors)
