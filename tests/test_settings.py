"""settings.py: options merged into the panel's config, YAML override, validation. Run: python -m pytest tests -q"""
import logging
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "custom_components" / "solar_view"))
import settings  # noqa: E402


def test_options_fill_an_empty_yaml():
    out = settings.merge({"battery_kwh": 10.0, "level": "none", "washer": {"kwh": 1}, "latitude": 45}, {})
    assert out == {"battery_kwh": 10.0, "level": "none", "washer": {"kwh": 1}}  # setup keys never reach the page


def test_unset_option_adds_nothing():
    assert settings.merge({"battery_kwh": None, "soc_entity": "sensor.x"}, None) == {}


def test_yaml_key_wins_at_top_or_in_group():
    yaml = {"battery_kwh": 5, "plant": {"standby_w": 40}, "tariff": {"type": "single"}}
    out = settings.merge({"battery_kwh": 10, "standby_w": 60, "system_cost": 900}, yaml)
    assert out == {**yaml, "system_cost": 900}


def test_yaml_machine_false_wins():
    assert settings.merge({"washer": {"kwh": 1}, "dryer": {}}, {"machines": {"washer": False}}) == \
        {"machines": {"washer": False}, "dryer": {}}


def test_export_limit_is_the_page_export_max():
    assert settings.merge({"export_limit_kw": 0}, {}) == {"export_max_kw": 0}


def test_export_yaml_overrides_and_warns_only_when_differs(caplog):
    with caplog.at_level(logging.WARNING):
        assert settings.merge({"export_limit_kw": 3}, {"plant": {"export_max_kw": 0}}) == {"plant": {"export_max_kw": 0}}
    assert "export_max_kw" in caplog.text
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        settings.merge({"export_limit_kw": 0}, {"export_max_kw": 0})
    assert caplog.text == ""


def test_sensors_merge_name_by_name():
    opts = {"load_power": "sensor.a", "load_energy": "sensor.b", "battery_health": "sensor.c"}
    out = settings.merge(opts, {"sensors": {"load_power": "sensor.yaml"}, "entities": {"battery_health": "sensor.e"}})
    assert out["sensors"] == {"load_energy": "sensor.b", "load_power": "sensor.yaml"}
    assert "entities" in out


def test_broken_yaml_sensors_left_alone():
    assert settings.merge({"load_power": "sensor.a"}, {"sensors": 3}) == {"sensors": 3}


def test_input_not_changed():
    yaml = {"plant": {"battery_kwh": 5}}
    settings.merge({"standby_w": 1}, yaml)
    assert yaml == {"plant": {"battery_kwh": 5}}


@pytest.mark.parametrize("key,value,error", [
    ("battery_kwh", 0.1, None), ("battery_kwh", 0, "bad_number"), ("battery_floor", 101, "bad_number"),
    ("battery_floor", 100, None), ("usual_days", 2, "bad_number"), ("usual_days", 60, None),
    ("usual_days", 61, "bad_number"), ("usual_days", 14.5, "bad_number"), ("standby_w", -1, "bad_number"),
    ("system_cost", "9", "bad_number"), ("battery_margin", 100.1, "bad_number"),
    ("install_date", "2025-03-15", None), ("install_date", "2026-02-30", "bad_date"),
    ("battery_install_date", "15/03/2025", "bad_date"), ("level", "weather", None), ("level", "auto", "bad_level"),
    ("quiet_hours", "0-7", None), ("quiet_hours", "23:30-6:30", None), ("quiet_hours", " 22 - 7 ", None),
    ("quiet_hours", "25-7", "bad_hours"), ("quiet_hours", "24:30-7", "bad_hours"), ("quiet_hours", "night", "bad_hours"),
    ("load_power", "sensor.load", None), ("load_power", "Load", "bad_entity"),
])
def test_check(key, value, error):
    assert settings.check(key, value) == error


def test_check_machine():
    assert settings.check_machine({"kwh": 1.2, "hours": 3, "peak_kw": 2, "sensor": "sensor.w"}) == {}
    assert settings.check_machine({"kwh": -1, "hours": 25, "peak_kw": 0, "sensor": "x"}) == \
        {"kwh": "bad_number", "hours": "bad_number", "sensor": "bad_entity"}
