"""Setup (where the panels are, the battery's charge sensor, the export limit) and the Options dialog: a menu of
sections holding the page's settings (see settings.py), the weather model and the PUN estimate."""
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
    SelectSelector, SelectSelectorConfig, SelectSelectorMode, TextSelector,
)

from .const import CONF_EXPORT_LIMIT, CONF_MODEL, CONF_PUN, CONF_CHARGE_SENSOR, DOMAIN
from .forecast import AIFS, weather_url
from .settings import LEVELS, MACHINES, SENSORS, check, check_machine


def _schema(d: dict[str, Any], options: bool) -> vol.Schema:
    def coord(lo: float, hi: float) -> NumberSelector:
        return NumberSelector(NumberSelectorConfig(min=lo, max=hi, step="any", mode=NumberSelectorMode.BOX))

    fields: dict[Any, Any] = {
        vol.Required(CONF_LATITUDE, default=d.get(CONF_LATITUDE)): coord(-90, 90),
        vol.Required(CONF_LONGITUDE, default=d.get(CONF_LONGITUDE)): coord(-180, 180),
        vol.Optional(CONF_CHARGE_SENSOR, description={"suggested_value": d.get(CONF_CHARGE_SENSOR)}):
            EntitySelector(EntitySelectorConfig(domain="sensor")),
    }
    if not options:  # in the options the export limit is under Plant
        fields[vol.Optional(CONF_EXPORT_LIMIT, description={"suggested_value": d.get(CONF_EXPORT_LIMIT)})] = \
            NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, unit_of_measurement="kW",
                                                mode=NumberSelectorMode.BOX))
    if options:
        fields[vol.Required(CONF_MODEL, default=d.get(CONF_MODEL) or AIFS)] = TextSelector()
        fields[vol.Required(CONF_PUN, default=bool(d.get(CONF_PUN)))] = BooleanSelector()
    return vol.Schema(fields)


async def _model_known(hass: HomeAssistant, d: dict[str, Any]) -> bool:
    """False only when Open-Meteo answers 400, its answer to a model it lacks; an outage cannot tell, so it passes."""
    if "," in d[CONF_MODEL]:  # Open-Meteo takes a list and answers 200, but only one model's values are read
        return False
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


def _num(unit: str | None = None, lo: float | None = None, hi: float | None = None, step: Any = "any"):
    given = {"min": lo, "max": hi, "unit_of_measurement": unit}  # a key left out, never None
    return NumberSelector(NumberSelectorConfig(step=step, mode=NumberSelectorMode.BOX,
                                               **{k: v for k, v in given.items() if v is not None}))


_SENSOR = EntitySelector(EntitySelectorConfig(domain="sensor"))
# Each section of the dialog: its fields in order, as {key: selector}; an empty field is a key not set.
SECTIONS: dict[str, dict[str, Any]] = {
    "plant": {
        "battery_kwh": _num("kWh", 0.1), "battery_floor": _num("%", 0, 100),
        "battery_max_charge_kw": _num("kW", 0), "battery_max_discharge_kw": _num("kW", 0),
        "battery_install_date": TextSelector(), "standby_w": _num("W", 0), "grid_max_kw": _num("kW", 0),
        CONF_EXPORT_LIMIT: _num("kW", 0),
        "system_cost": _num(None, 0), "install_date": TextSelector(), "saved_before": _num(None, 0),
    },
    "predictions": {
        "level": SelectSelector(SelectSelectorConfig(options=list(LEVELS), translation_key="level",
                                                     mode=SelectSelectorMode.DROPDOWN)),
        "usual_days": _num("days", 3, 60, 1),
    },
    "machines": {
        "battery_margin": _num("%", 0, 100), "quiet_hours": TextSelector(),
        "machines": SelectSelector(SelectSelectorConfig(options=list(MACHINES), multiple=True,
                                                        translation_key="machines", mode=SelectSelectorMode.LIST)),
    },
    "prices": {"bill_fixed": _num(None, 0)},
    "sensors": {k: _SENSOR for k in SENSORS},
}
_MACHINE = {"kwh": _num("kWh", 0), "hours": _num("h", 0, 24), "peak_kw": _num("kW", 0), "sensor": _SENSOR}
_MACHINE_KEYS = ["battery_margin", "quiet_hours", *MACHINES]  # what the machines step replaces


def _form(fields: dict[str, Any], now: dict[str, Any]) -> vol.Schema:
    return vol.Schema({vol.Optional(k, description={"suggested_value": now.get(k)}): s for k, s in fields.items()})


def _filled(user_input: dict[str, Any]) -> dict[str, Any]:
    """The fields given a value, text trimmed; a whole number from a number box as an int."""
    out = {}
    for k, v in user_input.items():
        v = v.strip() if isinstance(v, str) else v
        if v in (None, "", []):
            continue
        out[k] = int(v) if isinstance(v, float) and v.is_integer() and k == "usual_days" else v
    return out


class SolarViewOptionsFlow(OptionsFlow):
    """A menu of sections. A section replaces its own keys whole (an empty field is a key not set) and saves at
    once, leaving every other key of the options as it was."""

    def __init__(self) -> None:
        self._queue: list[str] = []          # machines still to ask
        self._new: dict[str, Any] = {}       # the machines step's answers, kept until the last machine

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(step_id="init", menu_options=["plant", "predictions", "machines", "prices",
                                                                  "sensors", "weather"])

    def _save(self, drop: list[str], new: dict[str, Any]) -> ConfigFlowResult:
        options = {k: v for k, v in self.config_entry.options.items() if k not in drop}
        return self.async_create_entry(data={**options, **new})

    async def _section(self, name: str, user_input: dict[str, Any] | None) -> ConfigFlowResult:
        fields = SECTIONS[name]
        errors: dict[str, str] = {}
        now: dict[str, Any] = {**self.config_entry.data, **self.config_entry.options}  # the setup's answers too
        if name == "machines":
            now["machines"] = [m for m in MACHINES if m in now]
        if user_input is not None:
            new = _filled(user_input)
            errors = {k: e for k, v in new.items() if (e := check(k, v))}
            if not errors:
                if name == "plant":
                    new.setdefault(CONF_EXPORT_LIMIT, None)  # cleared: saved as None, so the setup's answer does not come back
                if name != "machines":
                    return self._save(list(fields), new)
                self._queue = list(new.pop("machines", []))
                kept = {m: self.config_entry.options.get(m, {}) for m in self._queue}
                self._new = {**new, **kept}
                return await self._machine(None) if self._queue else self._save(_MACHINE_KEYS, self._new)
            now = user_input
        return self.async_show_form(step_id=name, data_schema=_form(fields, now), errors=errors)

    async def _machine(self, user_input: dict[str, Any] | None) -> ConfigFlowResult:
        """The figures of the next machine of the list; empty is allowed (the page then assumes a usual run)."""
        kind = self._queue[0]
        errors: dict[str, str] = {}
        if user_input is not None:
            got = _filled(user_input)
            errors = check_machine(got)
            if not errors:
                self._new[kind] = got
                self._queue.pop(0)
                return await self._machine(None) if self._queue else self._save(_MACHINE_KEYS, self._new)
        now = user_input or self._new.get(kind) or {}
        return self.async_show_form(step_id=f"machine_{kind}", data_schema=_form(_MACHINE, now), errors=errors)

    async def async_step_machine_washer(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._machine(user_input)

    async def async_step_machine_dryer(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._machine(user_input)

    async def async_step_machine_dishwasher(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._machine(user_input)

    async def async_step_plant(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._section("plant", user_input)

    async def async_step_predictions(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._section("predictions", user_input)

    async def async_step_machines(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._section("machines", user_input)

    async def async_step_prices(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._section("prices", user_input)

    async def async_step_sensors(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._section("sensors", user_input)

    async def async_step_weather(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """The setup's fields again, plus the weather model and the PUN estimate (the export limit is under Plant). A cleared
        charge sensor is saved as None, so the setup's answer does not come back."""
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_MODEL] = user_input[CONF_MODEL].strip() or AIFS
            if await _model_known(self.hass, user_input):
                user_input.setdefault(CONF_CHARGE_SENSOR, None)
                return self._save(list(user_input), user_input)
            errors[CONF_MODEL] = "bad_model"
        now = user_input or {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="weather", data_schema=_schema(dict(now), options=True), errors=errors)
