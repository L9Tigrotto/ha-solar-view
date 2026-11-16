"""pun.py: GME's PUN Index ZIP to band means. Run: python -m pytest tests -q"""
import io
import pathlib
import sys
import zipfile
from datetime import date

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "custom_components" / "solar_view"))
import pun  # noqa: E402


def gme_xml(day: str, hours: int, value) -> str:
    """One day's MGPPrezzi.xml as GME writes it; value(ora) gives the PUN text in EUR/MWh."""
    rows = "".join(f"<Prezzi><Data>{day}</Data><Mercato>MGP</Mercato><Ora>{o}</Ora><PUN>{value(o)}</PUN>"
                   f"<NAT>1,0</NAT></Prezzi>" for o in range(1, hours + 1))
    return f'<?xml version="1.0" encoding="utf-8"?><NewDataSet><xs:schema xmlns:xs="x"/>{rows}</NewDataSet>'


def zip_of(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


def test_url_for():
    url = pun.url_for(date(2026, 10, 1), date(2026, 10, 31))
    assert "DataInizio=20261001&DataFine=20261031&Date=20261001" in url and url.startswith(pun.URL)
    assert pun.HEADERS["moduleid"] == "12103"


def test_parse_zip_normal_and_25_hour_day():
    data = zip_of({
        "20261002MGPPrezzi.xml": gme_xml("20261002", 24, lambda o: "203,322430" if o == 1 else "100,0"),
        "20261025MGPPrezzi.xml": gme_xml("20261025", 25, lambda o: f"{o},5"),   # Sunday, clocks back
        "20261002MGPQuantita.xml": gme_xml("20261002", 24, lambda o: "999,0"),  # ignored
    })
    got = pun.parse_zip(data)
    assert len(got) == 49
    assert got[(date(2026, 10, 2), 0)] == pytest.approx(0.20332243)
    assert got[(date(2026, 10, 2), 23)] == pytest.approx(0.1)
    assert got[(date(2026, 10, 25), 24)] == pytest.approx(0.0255)


def test_parse_zip_rejects_bad_data():
    with pytest.raises(ValueError):
        pun.parse_zip(b"<html>error</html>")
    with pytest.raises(ValueError):
        pun.parse_zip(zip_of({"20261002MGPQuantita.xml": gme_xml("20261002", 24, lambda o: "1,0")}))
    with pytest.raises(ValueError):
        pun.parse_zip(zip_of({}))
    with pytest.raises(ValueError):
        pun.parse_zip(zip_of({"20261002MGPPrezzi.xml": "<NewDataSet><Prezzi><Data>2026"}))


# Monday 2026-11-16 (F1 8-19, F2 7-8 and 19-23, F3 rest) and Sunday 2026-11-15 (all F3).
# Prices by band: F1 0.3, F2 0.2, F3 0.1.
MON, SUN = date(2026, 11, 16), date(2026, 11, 15)
WEEK = {(MON, h): (.3 if 8 <= h < 19 else .2 if h == 7 or 19 <= h < 23 else .1) for h in range(24)}
WEEK |= {(SUN, h): .1 for h in range(25)}   # a 25th hour, banded as 23


def test_band_means_three():
    assert pun.band_means(WEEK, "three") == {"f1": .3, "f2": .2, "f3": .1}


def test_band_means_two_joins_f2_and_f3():
    # F2 5 hours at 0.2, F3 8 Monday + 25 Sunday hours at 0.1 -> 4.3 / 38
    assert pun.band_means(WEEK, "two") == {"f1": .3, "f23": round(4.3 / 38, 6)}


def test_band_means_single_all_hours():
    assert pun.band_means(WEEK, "single") == {"f1": round((3.3 + 4.3) / 49, 6)}


def test_band_means_none_without_a_band():
    assert pun.band_means({(SUN, h): .1 for h in range(24)}, "three") is None
