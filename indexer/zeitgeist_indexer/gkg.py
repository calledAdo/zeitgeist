"""Fetch and parse GDELT 2.1 GKG 15-minute files."""

from __future__ import annotations

import csv
import hashlib
import html
import io
import re
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

BASE = "https://data.gdeltproject.org/gdeltv2"
LASTUPDATE = f"{BASE}/lastupdate.txt"
UA = "zeitgeist-indexer/0.1 (attention oracle; hackathon)"

csv.field_size_limit(1 << 30)
_TITLE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
_NONWORD = re.compile(r"[^a-z0-9]+")

# GKG 2.1 column indexes
C_DOMAIN, C_URL, C_V2PERSONS, C_ALLNAMES, C_EXTRAS = 3, 4, 12, 23, 26


@dataclass(frozen=True)
class Article:
    domain: str
    title: str                         # normalized: lowercase, punctuation collapsed to spaces
    persons: tuple[tuple[str, int], ...]   # V2Persons (name, char offset)
    allnames: tuple[tuple[str, int], ...]  # AllNames (name, char offset)


@dataclass(frozen=True)
class Batch:
    ts: str              # YYYYMMDDHHMMSS (UTC), the GDELT file stamp
    md5: str             # md5 of the zip bytes we consumed
    articles: tuple[Article, ...]


def ts_to_dt(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def dt_to_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")


def floor_batch(dt: datetime) -> datetime:
    dt = dt.astimezone(timezone.utc).replace(second=0, microsecond=0)
    return dt - timedelta(minutes=dt.minute % 15)


def batch_range(start: datetime, end: datetime, every: int = 1) -> list[str]:
    """Batch stamps from start to end inclusive, taking every Nth 15-minute file."""
    step = timedelta(minutes=15 * every)
    t = floor_batch(start)
    # align the sampling grid to the clock (e.g. every=4 → on the hour) so reruns hit the same files
    day0 = t.replace(hour=0, minute=0)
    t = day0 + ((t - day0) // step) * step
    out = []
    while t <= end:
        out.append(dt_to_ts(t))
        t += step
    return out


def latest_ts() -> str:
    body = _get(LASTUPDATE).decode()
    m = re.search(r"/(\d{14})\.gkg\.csv\.zip", body)
    if not m:
        raise RuntimeError(f"unexpected lastupdate.txt: {body[:200]!r}")
    return m.group(1)


def _get(url: str, tries: int = 4) -> bytes:
    err: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise FileNotFoundError(url) from e
            err = e
        except Exception as e:  # network blips
            err = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"fetch failed: {url}: {err}")


def fold(t: str) -> str:
    """Lowercase and strip accents (ğ→g, á→a) so 'Erdoğan' and 'Erdogan' match the same alias."""
    t = unicodedata.normalize("NFKD", t.lower())
    return "".join(ch for ch in t if not unicodedata.combining(ch))


def normalize_title(t: str) -> str:
    return _NONWORD.sub(" ", fold(html.unescape(t))).strip()


def _names(field: str) -> tuple[tuple[str, int], ...]:
    out = []
    for item in field.split(";"):
        if not item:
            continue
        name, _, off = item.rpartition(",")
        if not name:
            name, off = item, "-1"
        try:
            o = int(off)
        except ValueError:
            o = -1
        out.append((fold(name), o))
    return tuple(out)


def parse(data: bytes) -> tuple[Article, ...]:
    z = zipfile.ZipFile(io.BytesIO(data))
    text = z.read(z.namelist()[0]).decode("utf-8", "ignore")
    arts = []
    for r in csv.reader(io.StringIO(text), delimiter="\t"):
        if len(r) <= C_EXTRAS:
            continue
        m = _TITLE.search(r[C_EXTRAS])
        title = normalize_title(m.group(1)) if m else ""
        if not title:
            # fall back to the URL slug so the article still dedups consistently
            title = normalize_title(r[C_URL].rsplit("/", 1)[-1] or r[C_URL])
        arts.append(Article(r[C_DOMAIN].lower(), title, _names(r[C_V2PERSONS]), _names(r[C_ALLNAMES])))
    return tuple(arts)


def fetch(ts: str) -> Batch:
    data = _get(f"{BASE}/{ts}.gkg.csv.zip")
    return Batch(ts=ts, md5=hashlib.md5(data).hexdigest(), articles=parse(data))
