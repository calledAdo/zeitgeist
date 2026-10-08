"""Turn a batch of articles into unique-story counts per entity.

Counting rules (all published with the registry):
- PR-wire domains are excluded entirely (advertising, not attention; SPEC_V2 §2.7).
- A story is a normalized page title. Each title counts once per batch, however many
  domains syndicate it (title dedup; measured to collapse wire networks 14 → 1).
- The corpus C is the number of unique titles in the batch, so I = n / C is a share.
"""

from __future__ import annotations

from collections import defaultdict

from .gkg import Article
from .registry import Entity, Registry


def person_hit(e: Entity, a: Article, max_offset: int) -> bool:
    names = a.persons + (a.allnames if e.allnames else ())
    central = False
    anywhere = False
    for name, off in names:
        for full in e.full:
            if full == name or e.rx(full).search(name):
                anywhere = True
                if 0 <= off < max_offset:
                    central = True
                break
        if central:
            return True
    if anywhere and e.surname and e.rx(e.surname).search(a.title):
        return True
    return False


def company_hit(e: Entity, a: Article) -> bool:
    t = a.title
    if any(b in t for b in e.block):
        return False
    if e.tier == "B":
        if any(e.rx(c).search(t) for c in e.canonical):
            return True
        return any(e.rx(x).search(t) for x in e.title) and any(e.rx(s).search(t) for s in e.sector)
    return any(e.rx(x).search(t) for x in e.title)


def count_batch(reg: Registry, articles: tuple[Article, ...], max_offset: int) -> tuple[int, dict[tuple[str, str], int], dict[tuple[str, str], int]]:
    """Returns (corpus unique titles, {(cat, key): unique titles}, {(cat, key): distinct domains})."""
    corpus: set[str] = set()
    titles: dict[tuple[str, str], set[str]] = defaultdict(set)
    domains: dict[tuple[str, str], set[str]] = defaultdict(set)
    ents = list(reg.entities())
    for a in articles:
        if a.domain in reg.pr_wire or not a.title:
            continue
        corpus.add(a.title)
        for e in ents:
            hit = person_hit(e, a, e.offset_max) if e.kind == "person" else company_hit(e, a)
            if hit:
                k = (e.category, e.key)
                titles[k].add(a.title)
                domains[k].add(a.domain)
    return len(corpus), {k: len(v) for k, v in titles.items()}, {k: len(v) for k, v in domains.items()}
