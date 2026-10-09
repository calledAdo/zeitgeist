"""Oracle math: EWMA attention, character cards, heat, targets, TWAP.

All functions are pure over (batch stamps, corpus, counts), so any party holding the same
GDELT files and registry reproduces the same snapshot byte for byte.
"""

from __future__ import annotations

import hashlib
import math
import statistics as st
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

from . import params as P
from .gkg import dt_to_ts, ts_to_dt
from .registry import Registry
from .store import Store

EWMA_LOOKBACK = timedelta(days=7)      # 2^-14 residual weight from the start: negligible


def character_anchor(at: datetime) -> datetime:
    """Most recent Thursday 00:00 UTC at or before `at` (the weekly vote flip)."""
    d = at.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return d - timedelta(days=(d.weekday() - 3) % 7)


@dataclass
class Character:
    ready: bool
    days: int
    mu: float          # mean ln(daily share)
    sigma: float       # std ln(daily share), floored
    per_day: float     # normal unique stories/day (full-day equivalent)
    plus1: float       # coverage multiple needed for +1 heat = e^sigma


def character(day_n: dict[str, int], day_c: dict[str, int], day_b: dict[str, int], days: list[str]) -> Character:
    logs, per_day = [], []
    for d in days:
        if day_b.get(d, 0) < 4 or not day_c.get(d):
            continue  # too few batches that day to trust
        share = (day_n.get(d, 0) + 0.5) / day_c[d]
        logs.append(math.log(share))
        per_day.append(day_n.get(d, 0) * 96 / day_b[d])
    if len(logs) < 2:
        return Character(False, len(logs), 0.0, P.SIGMA_FLOOR, 0.0, math.exp(P.SIGMA_FLOOR))
    mu = st.mean(logs)
    sigma = max(st.pstdev(logs), P.SIGMA_FLOOR)
    return Character(len(logs) >= P.CHARACTER_MIN_DAYS, len(logs), mu, sigma, st.mean(per_day), math.exp(sigma))


def ewma_path(stamps: list[str], corpus: list[int], n: dict[str, int]) -> list[float]:
    """Attention share I at each batch: EWMA(n) / EWMA(C) with time-based decay."""
    out, A, K, prev = [], None, None, None
    for ts, c in zip(stamps, corpus):
        x = n.get(ts, 0)
        t = ts_to_dt(ts)
        if A is None:
            A, K = float(x), float(c)
        else:
            dh = (t - prev).total_seconds() / 3600
            lam = 0.5 ** (dh / P.EWMA_HALF_LIFE_H)
            A = lam * A + (1 - lam) * x
            K = lam * K + (1 - lam) * c
        prev = t
        out.append((A + P.EPS_STORIES) / K if K else 0.0)
    return out


def heat(I: float, ch: Character) -> float:
    if I <= 0:
        return -P.HEAT_CLAMP
    h = (math.log(I) - ch.mu) / ch.sigma
    return max(-P.HEAT_CLAMP, min(P.HEAT_CLAMP, h))


def targets(heats: dict[str, float]) -> dict[str, float]:
    z = {k: math.exp(P.LAMBDA * h) for k, h in heats.items()}
    s = sum(z.values())
    return {k: v / s for k, v in z.items()} if s else {}


def to_wad(shares: dict[str, float], keys: list[str]) -> list[int]:
    """1e18-scaled shares that sum to exactly 1e18 (rounding residue goes to the largest)."""
    if not shares:
        return [0] * len(keys)
    w = [int(shares.get(k, 0.0) * 10**18) for k in keys]
    if any(w):
        i = max(range(len(w)), key=lambda j: w[j])
        w[i] += 10**18 - sum(w)
    return w


def snapshot(store: Store, reg: Registry, at: datetime | None = None) -> dict:
    last = store.last_ts()
    if last is None:
        raise RuntimeError("store is empty; run `zg ingest` first")
    at_dt = ts_to_dt(last) if at is None else at
    at_ts = dt_to_ts(at_dt)
    anchor = character_anchor(at_dt)
    char_start = anchor - timedelta(days=P.CHARACTER_DAYS)
    win_start = min(char_start, at_dt - EWMA_LOOKBACK)

    rows = store.batches(dt_to_ts(win_start), at_ts)
    if not rows:
        raise RuntimeError("no batches in window")
    stamps = [r[0] for r in rows]
    corpus = [r[2] for r in rows]
    cnt = store.counts(dt_to_ts(win_start), at_ts)

    # daily aggregates for character (completed days strictly before the anchor)
    char_days = [(char_start + timedelta(days=i)).strftime("%Y%m%d") for i in range(P.CHARACTER_DAYS)]
    day_c: dict[str, int] = {}
    day_b: dict[str, int] = {}
    for ts, c in zip(stamps, corpus):
        d = ts[:8]
        day_c[d] = day_c.get(d, 0) + c
        day_b[d] = day_b.get(d, 0) + 1

    ewma_idx = [i for i, ts in enumerate(stamps) if ts_to_dt(ts) > at_dt - EWMA_LOOKBACK]
    e_stamps = [stamps[i] for i in ewma_idx]
    e_corpus = [corpus[i] for i in ewma_idx]
    twap_from = at_dt - timedelta(hours=P.TWAP_HOURS)
    twap_idx = [j for j, ts in enumerate(e_stamps) if ts_to_dt(ts) > twap_from]

    # inputs commitment: every batch that influenced this snapshot
    h = hashlib.sha256()
    h.update(f"{P.PARAMS_VERSION}|{reg.digest}\n".encode())
    for ts, md5, _ in rows:
        h.update(f"{ts}:{md5}\n".encode())

    cats_out = {}
    for ckey, ents in reg.categories.items():
        per = {}
        for e in ents:
            n = cnt.get((ckey, e.key), {})
            day_n: dict[str, int] = {}
            for ts, x in n.items():
                day_n[ts[:8]] = day_n.get(ts[:8], 0) + x
            ch = character(day_n, day_c, day_b, char_days)
            path = ewma_path(e_stamps, e_corpus, n)
            per[e.key] = (e, ch, path)

        passes = {k for k, (e, ch, _) in per.items() if ch.ready and ch.per_day >= P.MIN_STORIES_PER_DAY}
        eligible = [k for k, (e, ch, _) in per.items() if k in passes and e.index is not None and not e.delisted]
        # target at every batch inside the TWAP window, then average (spot = last batch)
        tw_sum = {k: 0.0 for k in eligible}
        spot: dict[str, float] = {}
        for j in twap_idx:
            hs = {k: heat(per[k][2][j], per[k][1]) for k in eligible}
            tg = targets(hs)
            for k in eligible:
                tw_sum[k] += tg[k]
            spot = tg
        twap = {k: v / len(twap_idx) for k, v in tw_sum.items()} if twap_idx else {}
        s = sum(twap.values())
        twap = {k: v / s for k, v in twap.items()} if s else {}

        ents_out = []
        for k, (e, ch, path) in per.items():
            I = path[-1] if path else 0.0
            last_n = cnt.get((ckey, k), {}).get(stamps[-1], 0)
            hc = heat(I, ch) if ch.days >= 2 else None
            ents_out.append({
                "key": k,
                "name": e.name,
                "listed": e.index is not None and not e.delisted,
                "index": e.index,
                "eligible": k in eligible,
                "reason": None if k in eligible else ("delisted" if e.delisted else (
                    "candidate" if k in passes else ("history" if not ch.ready else "volume"))),
                "stories_last_batch": last_n,
                "attention": I,
                "heat": hc,
                "target": spot.get(k),
                "target_twap": twap.get(k),
                "character": {k2: (round(v, 6) if isinstance(v, float) else v) for k2, v in asdict(ch).items()},
            })
        ents_out.sort(key=lambda x: -(x["target_twap"] or -1))
        keys = [x["key"] for x in ents_out if x["eligible"]]
        cats_out[ckey] = {
            "label": reg.labels[ckey],
            "entities": ents_out,
            "funding": {"keys": keys, "targets_wad": [str(v) for v in to_wad(twap, keys)]},
        }

    return {
        "as_of": at_ts,
        "params_version": P.PARAMS_VERSION,
        "params": {k: getattr(P, k) for k in dir(P) if k.isupper()},
        "registry_version": reg.version,
        "registry_digest": reg.digest,
        "character_anchor": dt_to_ts(anchor),
        "batches_used": len(rows),
        "inputs_hash": h.hexdigest(),
        "categories": cats_out,
    }
