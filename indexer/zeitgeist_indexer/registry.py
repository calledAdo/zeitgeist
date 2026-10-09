"""Entity registry: categories, entities and their published match rules."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "registry" / "entities.json"


def _wb(term: str) -> re.Pattern[str]:
    """Word-boundary regex for a lowercase term (handles multi-word terms)."""
    return re.compile(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])")


@dataclass(frozen=True)
class Entity:
    key: str
    category: str
    name: str
    kind: str  # "person" | "company"
    full: tuple[str, ...] = ()
    surname: str | None = None
    allnames: bool = True
    tier: str | None = None
    title: tuple[str, ...] = ()
    canonical: tuple[str, ...] = ()
    sector: tuple[str, ...] = ()
    block: tuple[str, ...] = ()
    index: int | None = None          # on-chain market slot; None = watchlist
    delisted: bool = False            # keeps its slot (append-only) but gets no target and is hidden
    offset_max: int = 500
    _re: dict = field(default_factory=dict, compare=False, hash=False, repr=False)

    def rx(self, term: str) -> re.Pattern[str]:
        r = self._re.get(term)
        if r is None:
            r = self._re[term] = _wb(term)
        return r


@dataclass(frozen=True)
class Registry:
    version: str
    digest: str
    categories: dict[str, list[Entity]]
    offset_max: int
    labels: dict[str, str]
    pr_wire: frozenset[str]

    def listed(self, cat: str) -> list[Entity]:
        """On-chain entities of a category, in market index order (must be 0..n-1, no gaps)."""
        ents = sorted((e for e in self.categories[cat] if e.index is not None), key=lambda e: e.index)
        if [e.index for e in ents] != list(range(len(ents))):
            raise ValueError(f"{cat}: listed indexes must be 0..n-1 without gaps")
        return ents

    def entities(self):
        for ents in self.categories.values():
            yield from ents


def load(path: Path | str = DEFAULT_PATH) -> Registry:
    raw = Path(path).read_bytes()
    doc = json.loads(raw)
    cats: dict[str, list[Entity]] = {}
    labels: dict[str, str] = {}
    for ckey, c in doc["categories"].items():
        labels[ckey] = c["label"]
        ents = []
        for ekey, e in c["entities"].items():
            ents.append(
                Entity(
                    key=ekey,
                    category=ckey,
                    name=e["name"],
                    kind=c["kind"],
                    full=tuple(x.lower() for x in e.get("full", [])),
                    surname=e.get("surname", "").lower() or None,
                    allnames=e.get("allnames", True),
                    tier=e.get("tier"),
                    title=tuple(x.lower() for x in e.get("title", [])),
                    canonical=tuple(x.lower() for x in e.get("canonical", [])),
                    sector=tuple(x.lower() for x in e.get("sector", [])),
                    block=tuple(x.lower() for x in e.get("block", [])),
                    index=e.get("index"),
                    delisted=bool(e.get("delisted")),
                    offset_max=c.get("person_offset_max", doc.get("person_offset_max", 500)),
                )
            )
        cats[ckey] = ents
    return Registry(
        version=doc["version"],
        digest=hashlib.sha256(raw).hexdigest(),
        categories=cats,
        offset_max=doc.get("person_offset_max", 500),
        labels=labels,
        pr_wire=frozenset(doc.get("pr_wire_domains", [])),
    )
