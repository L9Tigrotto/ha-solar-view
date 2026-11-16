"""The page in the sidebar: frontend/ served by the integration, its panel registered with solar_view.yaml as config.
Home Assistant is imported only inside the functions that call it, so tests/ can import the plain ones."""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

_LOGGER = logging.getLogger(__name__)


def files_hash(folder: Path) -> str:
    """8 hex characters over every file under `folder`, by relative path and content: the panel URL's ?v=."""
    h = hashlib.sha256()
    for f in sorted(p for p in folder.rglob("*") if p.is_file()):
        h.update(f.relative_to(folder).as_posix().encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()[:8]


def read_config(path: Path, loader: Callable[[Path], Any]) -> dict:
    """The panel's config from `path`: {} when there is no file (every key is optional), {} and one warning when it
    does not load or is not a map. A config file never stops setup, so every error of the loader is caught."""
    if not path.is_file():
        return {}
    try:
        loaded = loader(path)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Solar view: %s did not load, the page runs without it: %s", path, err)
        return {}
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        _LOGGER.warning("Solar view: %s is not a map of options, the page runs without it", path)
        return {}
    return loaded


FRONTEND = Path(__file__).parent / "frontend"


async def async_serve_files(hass: Any) -> None:
    """frontend/ at FILES_URL, once per Home Assistant run (from async_setup: a static path cannot be removed)."""
    from homeassistant.components.http import StaticPathConfig

    from .const import FILES_URL

    await hass.http.async_register_static_paths([StaticPathConfig(FILES_URL, str(FRONTEND), True)])


async def async_read_config(hass: Any) -> dict:
    """solar_view.yaml as read_config reads it (!secret lines included), in the executor."""
    from homeassistant.util.yaml import Secrets, load_yaml_dict

    from .const import CONFIG_FILE

    secrets = Secrets(Path(hass.config.config_dir))
    return await hass.async_add_executor_job(
        read_config, Path(hass.config.path(CONFIG_FILE)), lambda p: load_yaml_dict(p, secrets))


async def async_setup_panel(hass: Any) -> None:
    """The sidebar panel, solar_view.yaml as its config and the files' hash as its version. Any panel from an
    earlier setup (a reload, a retry after a failed first refresh) is replaced."""
    from homeassistant.components import panel_custom

    from .const import ELEMENT, FILES_URL, PANEL_URL

    version = await hass.async_add_executor_job(files_hash, FRONTEND)
    config = await async_read_config(hass)
    remove_panel(hass)
    await panel_custom.async_register_panel(
        hass, frontend_url_path=PANEL_URL, webcomponent_name=ELEMENT, sidebar_title="Solar view",
        sidebar_icon="mdi:solar-power-variant", module_url=f"{FILES_URL}/solar-view.js?v={version}&name={ELEMENT}",
        config=config, require_admin=False)


def remove_panel(hass: Any) -> None:
    """The panel out of the sidebar; no warning when it is not there."""
    from homeassistant.components import frontend

    from .const import PANEL_URL

    frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
