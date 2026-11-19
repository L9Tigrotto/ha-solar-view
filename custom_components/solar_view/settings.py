"""The page's scalar settings held in the integration's options, merged into the config the panel gets.
Plain functions, no Home Assistant import: tests/ import this file. The ranges and formats are those of
readConfig in frontend/lib/config.js, so a value the dialog accepts is one the page reads."""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

_LOGGER = logging.getLogger(__name__)

# The groups a solar_view.yaml may put its keys in (CONFIG_GROUPS in config.js; `sensors` is apart).
GROUPS = ("plant", "battery", "grid", "payback", "predictions", "machines", "prices", "display")
MACHINES = ("washer", "dryer", "dishwasher")
SENSORS = ("load_power", "load_energy", "battery_health")
LEVELS = ("none", "usual_days", "weather", "usual_days_weather")
EXPORT_LIMIT = "export_limit_kw"   # the options' name for the page's export_max_kw
INF = float("inf")
# key: (min, max, whole numbers only)
NUMBERS: dict[str, tuple[float, float, bool]] = {
    "battery_kwh": (0.1, INF, False), "battery_floor": (0, 100, False),
    "battery_max_charge_kw": (0, INF, False), "battery_max_discharge_kw": (0, INF, False),
    "standby_w": (0, INF, False), "grid_max_kw": (0, INF, False),
    "system_cost": (0, INF, False), "saved_before": (0, INF, False),
    "usual_days": (3, 60, True), "battery_margin": (0, 100, False), "bill_fixed": (0, INF, False),
    EXPORT_LIMIT: (0, INF, False),
}
MACHINE_NUMBERS = {"kwh": (0, INF, False), "hours": (0, 24, False), "peak_kw": (0, INF, False)}
DATES = ("battery_install_date", "install_date")
PAGE_KEYS = (*(k for k in NUMBERS if k != EXPORT_LIMIT), *DATES, "level", "quiet_hours")  # EXPORT_LIMIT is renamed in merge

_HOURS = re.compile(r"^(\d{1,2})(?::([0-5]\d))?\s*-\s*(\d{1,2})(?::([0-5]\d))?$")
_ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def _number_ok(value: Any, lo: float, hi: float, whole: bool) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return -INF < value < INF and lo <= value <= hi and (not whole or float(value).is_integer())


def check(key: str, value: Any) -> str | None:
    """The error key (a string in translations' options.error) for a bad value of a page setting, else None."""
    if key in NUMBERS:
        return None if _number_ok(value, *NUMBERS[key]) else "bad_number"
    if key in DATES:
        try:
            ok = isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and date.fromisoformat(value)
        except ValueError:
            ok = False
        return None if ok else "bad_date"
    if key == "level":
        return None if value in LEVELS else "bad_level"
    if key == "quiet_hours":
        m = _HOURS.match(value.strip()) if isinstance(value, str) else None
        # Same as quietHours in config.js: each end is at most 24 hours.
        ok = m and all(float(m[a]) + float(m[b] or 0) / 60 <= 24 for a, b in ((1, 2), (3, 4)))
        return None if ok else "bad_hours"
    if key in SENSORS:
        return None if isinstance(value, str) and _ENTITY.match(value) else "bad_entity"
    return None


def check_machine(values: dict[str, Any]) -> dict[str, str]:
    """{field: error key} for a machine's figures; empty when all are fine."""
    errors = {}
    for field, value in values.items():
        if field == "sensor":
            if not (isinstance(value, str) and _ENTITY.match(value)):
                errors[field] = "bad_entity"
        elif field in MACHINE_NUMBERS and not _number_ok(value, *MACHINE_NUMBERS[field]):
            errors[field] = "bad_number"
    return errors


def yaml_flat(yaml: Any) -> dict[str, Any]:
    """The YAML's keys as the page reads them: top-level keys, then each group's, a later group winning."""
    top = yaml if isinstance(yaml, dict) else {}
    flat = {k: v for k, v in top.items() if k not in GROUPS and k != "sensors" and not str(k).startswith("_")}
    for g in GROUPS:
        if isinstance(top.get(g), dict):
            flat.update(top[g])
    return flat


def merge(entry_config: dict[str, Any], yaml: Any) -> dict[str, Any]:
    """The config the panel gets: the YAML as it is, plus each option the YAML does not give. A key the YAML gives
    (at the top or in any group, even empty) wins; sensor names are compared one by one."""
    top = dict(yaml) if isinstance(yaml, dict) else {}
    flat = yaml_flat(top)
    out = dict(top)
    for key in (*PAGE_KEYS, *MACHINES):
        value = entry_config.get(key)
        if value is not None and key not in flat:
            out[key] = value
    limit = entry_config.get(EXPORT_LIMIT)
    if limit is not None:
        if "export_max_kw" not in flat:
            out["export_max_kw"] = limit
        elif flat["export_max_kw"] != limit:
            _LOGGER.warning("Solar view: export_max_kw is %s in solar_view.yaml but %s in the options: the YAML's is used",
                            flat["export_max_kw"], limit)
    given_sensors = top.get("sensors")
    names = {n for n in (flat.get("entities") if isinstance(flat.get("entities"), dict) else {})}
    if given_sensors is not None and not isinstance(given_sensors, dict):
        return out  # the page warns about it; the options' sensors are not added to a broken map
    names |= set(given_sensors or {})
    sensors = {n: entry_config[n] for n in SENSORS if entry_config.get(n) and n not in names}
    if sensors:
        out["sensors"] = {**sensors, **(given_sensors or {})}
    return out
