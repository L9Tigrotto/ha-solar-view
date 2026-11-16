"""panel.py: the page files' hash and the solar_view.yaml reader. Run: python -m pytest tests -q"""
import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "custom_components" / "solar_view"))
import panel  # noqa: E402


def tree(root, files):
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text, encoding="utf-8")
    return root


PAGE = {"solar-view.js": "main", "lib/core.js": "core", "strings/en.js": "en"}


# ---- files_hash: the panel URL's version ----
def test_hash_is_stable(tmp_path):
    a, b = tree(tmp_path / "a", PAGE), tree(tmp_path / "b", PAGE)
    h = panel.files_hash(a)
    assert h == panel.files_hash(b)
    assert len(h) == 8 and all(c in "0123456789abcdef" for c in h)


def test_hash_changes_on_a_byte(tmp_path):
    a, b = tree(tmp_path / "a", PAGE), tree(tmp_path / "b", {**PAGE, "lib/core.js": "corE"})
    assert panel.files_hash(a) != panel.files_hash(b)


def test_hash_changes_on_rename(tmp_path):
    renamed = {"solar-view.js": "main", "lib/core2.js": "core", "strings/en.js": "en"}
    a, b = tree(tmp_path / "a", PAGE), tree(tmp_path / "b", renamed)
    assert panel.files_hash(a) != panel.files_hash(b)


def test_hash_changes_on_new_file(tmp_path):
    a, b = tree(tmp_path / "a", PAGE), tree(tmp_path / "b", {**PAGE, "lib/x.js": ""})
    assert panel.files_hash(a) != panel.files_hash(b)


# ---- read_config: solar_view.yaml as the panel's config ----
def never(path):
    raise AssertionError("the loader must not be called")


def test_config_missing(tmp_path, caplog):
    assert panel.read_config(tmp_path / "none.yaml", never) == {}
    assert not caplog.records


def test_config_map(tmp_path):
    (f := tmp_path / "solar_view.yaml").write_text("x")
    assert panel.read_config(f, lambda p: {"plant": {"battery_kwh": 10}}) == {"plant": {"battery_kwh": 10}}


def test_config_empty(tmp_path, caplog):
    (f := tmp_path / "solar_view.yaml").write_text("")
    assert panel.read_config(f, lambda p: None) == {}
    assert not caplog.records


def test_config_list(tmp_path, caplog):
    (f := tmp_path / "solar_view.yaml").write_text("x")
    with caplog.at_level(logging.WARNING):
        assert panel.read_config(f, lambda p: [1, 2]) == {}
    assert len(caplog.records) == 1 and "solar_view.yaml" in caplog.text


def test_config_raises(tmp_path, caplog):
    (f := tmp_path / "solar_view.yaml").write_text("x")

    def bad(path):
        raise ValueError("bad")

    with caplog.at_level(logging.WARNING):
        assert panel.read_config(f, bad) == {}
    assert len(caplog.records) == 1 and "bad" in caplog.text and "solar_view.yaml" in caplog.text
