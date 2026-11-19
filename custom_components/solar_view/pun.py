"""The PUN Index GME: GME's monthly ZIP of hourly prices, and their means by band.
Plain functions with no Home Assistant import, so tests/test_pun.py can run them anywhere."""
from __future__ import annotations

import io
import math
import zipfile
import zlib
from datetime import date
from xml.etree import ElementTree

try:  # inside the integration package
    from .bills import band_of
except ImportError:  # tests put this folder on sys.path
    from bills import band_of

# GME's own download (undocumented; pun_sensor uses the same).
URL = "https://gme.mercatoelettrico.org/DesktopModules/GmeDownload/API/ExcelDownload/downloadzipfile"
HEADERS = {"moduleid": "12103", "tabid": "1749", "userid": "-1",
           "referer": "https://gme.mercatoelettrico.org/it-it/Home/Esiti/Elettricita/MGP/Download"}


def url_for(first: date, last: date) -> str:
    """The download of every day from `first` to `last`."""
    a, b = first.strftime("%Y%m%d"), last.strftime("%Y%m%d")
    return f"{URL}?DataInizio={a}&DataFine={b}&Date={a}&Mercato=MGP&Settore=Prezzi&FiltroDate=InizioFine"


def parse_zip(data: bytes) -> dict[tuple[date, int], float]:
    """Each hour's PUN in EUR/kWh by (day, Ora - 1), from every MGPPrezzi.xml in the ZIP; a 25-hour day keeps
    hours 0 to 24. ValueError when `data` is not a ZIP or holds no such file."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as err:
        raise ValueError("not a ZIP") from err
    with z:
        names = [n for n in z.namelist() if n.endswith("MGPPrezzi.xml")]
        if not names:
            raise ValueError("no MGPPrezzi.xml in the ZIP")
        prices = {}
        try:
            for name in names:
                for row in ElementTree.fromstring(z.read(name)).iter("Prezzi"):
                    d = row.findtext("Data")
                    day = date(int(d[:4]), int(d[4:6]), int(d[6:]))
                    price = float(row.findtext("PUN").replace(",", ".")) / 1000
                    if not math.isfinite(price):
                        raise ValueError("a price that is no number")
                    prices[(day, int(row.findtext("Ora")) - 1)] = price
        # Bad XML or CRC, a missing tag, a broken or locked member.
        except (ElementTree.ParseError, AttributeError, TypeError, zipfile.BadZipFile, zlib.error, EOFError,
                RuntimeError, NotImplementedError) as err:
            raise ValueError(f"bad {name}") from err
    return prices


def band_means(prices: dict[tuple[date, int], float], kind: str) -> dict[str, float] | None:
    """The mean price of each band of `kind` ("three", "two", "single") over the hours given, EUR/kWh to 6 places;
    f23 is F2 and F3 hours together, single all hours. None when a band has no hour."""
    sums: dict[str, list[float]] = {}
    for (day, hour), price in prices.items():
        sums.setdefault(band_of(day, min(hour, 23), kind), []).append(price)
    want = {"three": ("f1", "f2", "f3"), "two": ("f1", "f23"), "single": ("f1",)}[kind]
    if any(b not in sums for b in want):
        return None
    return {b: round(sum(sums[b]) / len(sums[b]), 6) for b in want}
