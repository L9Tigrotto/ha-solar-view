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
