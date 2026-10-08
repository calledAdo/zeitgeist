"""zg — Zeitgeist indexer CLI.

  zg ingest --days 33 --every 4     backfill (every 4th file = hourly sampling)
  zg ingest --latest                fetch any new 15-minute files since the last one stored
  zg snapshot [--out out/latest.json]
  zg report                         human-readable table of the latest snapshot
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import chain, explain, gkg, match, oracle, params, registry
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "zeitgeist.sqlite"


def _process(reg, ts):
    try:
        b = gkg.fetch(ts)
    except FileNotFoundError:
        return ts, None
    except RuntimeError as e:  # network failure: skip, a later run retries it
        print(f"  skip {ts}: {e}", flush=True)
        return ts, "retry"
    samples: dict = {}
    corpus, counts, domains = match.count_batch(reg, b.articles, params.PERSON_OFFSET_MAX, samples)
    return ts, (b.md5, corpus, len(b.articles), counts, domains, samples)


def ingest(args) -> None:
    reg = registry.load()
    st = Store(args.db)
    newest = gkg.ts_to_dt(gkg.latest_ts())
    if args.latest:
        last = st.last_ts()
        start = gkg.ts_to_dt(last) + timedelta(minutes=15) if last else newest - timedelta(hours=args.hours or 24)
        stamps = gkg.batch_range(start, newest, 1)
    else:
        start = newest - timedelta(days=args.days)
        stamps = gkg.batch_range(start, newest, args.every)
    have = st.have()
    if args.recount:
        stale = {r[0] for r in st.db.execute("SELECT ts FROM batches WHERE registry != ?", (reg.version,))}
        todo = sorted(stale)
    else:
        todo = [t for t in stamps if t not in have]
    print(f"{len(todo)} batches to fetch ({len(stamps) - len(todo)} already stored)", flush=True)
    done = 0
    with ThreadPoolExecutor(args.workers) as ex:
        for ts, res in ex.map(lambda t: _process(reg, t), todo):
            if res == "retry":
                pass
            elif res is None:
                st.put_missing(ts)
            else:
                md5, corpus, n_art, counts, domains, samples = res
                st.put(ts, md5, corpus, n_art, reg.version, counts, domains)
                st.put_headlines(ts, samples)
            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)}  {ts}", flush=True)


def snapshot(args) -> None:
    reg = registry.load()
    st = Store(args.db)
    at = gkg.ts_to_dt(args.at) if args.at else None
    snap = oracle.snapshot(st, reg, at)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=1))
    tgt = out.with_name("targets.json")
    tgt.write_text(json.dumps(targets_doc(snap, reg, st), indent=1))
    print(f"wrote {out} and {tgt.name}  as_of={snap['as_of']}  inputs_hash={snap['inputs_hash'][:16]}…")


def targets_doc(snap: dict, reg, st: Store) -> dict:
    """Compact on-chain payload for the Chainlink CRE workflow (well under its 250 KB HTTP limit):
    full-length target vectors in market index order, plus the newest input file's GDELT fingerprint."""
    last = st.db.execute("SELECT ts, md5 FROM batches WHERE ts = ?", (snap["as_of"],)).fetchone()
    return {
        "as_of": snap["as_of"],
        "as_of_unix": int(gkg.ts_to_dt(snap["as_of"]).timestamp()),
        "inputs_hash": "0x" + snap["inputs_hash"],
        "params_version": snap["params_version"],
        "registry_digest": snap["registry_digest"],
        "latest_batch": {"ts": last[0], "md5": last[1]},
        "categories": [{"key": k, "targets": [str(x) for x in v]}
                       for k, v in targets_for_chain(snap, reg).items() if sum(v) == 10**18],
    }


def report(args) -> None:
    reg = registry.load()
    snap = oracle.snapshot(Store(args.db), reg, gkg.ts_to_dt(args.at) if args.at else None)
    print(f"as of {snap['as_of']} UTC · character anchor {snap['character_anchor']} · {snap['batches_used']} batches · inputs {snap['inputs_hash'][:12]}")
    for c in snap["categories"].values():
        print(f"\n{c['label']}")
        print(f"  {'entity':22s} {'stories/day':>11s} {'+1 heat':>8s} {'heat':>6s} {'target':>7s} {'8h twap':>8s}")
        for e in c["entities"]:
            ch = e["character"]
            h = "" if e["heat"] is None else f"{e['heat']:+.2f}"
            tg = "" if e["target"] is None else f"{e['target'] * 100:.1f}%"
            tw = f"{e['target_twap'] * 100:.1f}%" if e["eligible"] else f"({e['reason']})"
            tw = tw if e["listed"] or e["reason"] == "candidate" else f"(watch: {e['reason']})"
            print(f"  {e['name']:22s} {ch['per_day']:11.0f} {'x' + format(ch['plus1'], '.2f'):>8s} {h:>6s} {tg:>7s} {tw:>8s}")


def manifest(args) -> None:
    """Write the on-chain listing manifest: categories and entities in registry order (= market index)."""
    reg = registry.load()
    doc = {"registryVersion": reg.version, "registryDigest": reg.digest, "categories": []}
    for ckey in reg.categories:
        ents = reg.listed(ckey)
        doc["categories"].append({
            "key": ckey,
            "label": reg.labels[ckey],
            "names": [e.name for e in ents],
            "symbols": [("ZG-" + e.key.upper())[:11] for e in ents],
            "keys": [e.key for e in ents],
        })
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1))
    print(f"wrote {out}")


def targets_for_chain(snap: dict, reg) -> dict[str, list[int]]:
    """Full-length target vectors in market index order; ineligible entities get 0. Each sums to 1e18."""
    out = {}
    for ckey in reg.categories:
        ents = reg.listed(ckey)
        cat = snap["categories"][ckey]
        wad = dict(zip(cat["funding"]["keys"], (int(x) for x in cat["funding"]["targets_wad"])))
        out[ckey] = [wad.get(e.key, 0) for e in ents]
    return out


def post(args) -> None:
    """Snapshot, post every category's targets, then trigger funding where an epoch has passed."""
    reg = registry.load()
    dep = chain.load_deployment(args.deployment)
    snap = oracle.snapshot(Store(args.db), reg)
    vecs = targets_for_chain(snap, reg)
    as_of_unix = int(gkg.ts_to_dt(snap["as_of"]).timestamp())
    for ckey, t in vecs.items():
        if ckey not in dep:
            continue
        onchain = chain.entity_count(args.rpc, dep, ckey)
        if onchain != len(t):
            print(f"{ckey}: registry lists {len(t)} entities but the market has {onchain}; run script/AddEntity.s.sol first; skipped")
            continue
        if sum(t) != 10**18:
            print(f"{ckey}: no eligible entities yet (needs {params.CHARACTER_MIN_DAYS} days of history); skipped")
            continue
        if chain.last_posted(args.rpc, dep, ckey) >= as_of_unix:
            print(f"{ckey}: already posted as_of {snap['as_of']}")
        else:
            chain.post_targets(args.rpc, dep, ckey, snap["as_of"], snap["inputs_hash"], t)
            print(f"{ckey}: posted {sum(1 for x in t if x)} targets as_of {snap['as_of']}")
        if chain.try_fund(args.rpc, dep, ckey):
            print(f"{ckey}: funding applied")


def explain_cmd(args) -> None:
    """Why-is-it-moving notes for the biggest movers (Kimi when MOONSHOT_API_KEY is set; headlines otherwise)."""
    st = Store(args.db)
    doc = explain.build(oracle.snapshot(st, registry.load()), st)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    n = sum(1 for c in doc["categories"].values() for e in c["entities"].values() if e["why"])
    print(f"wrote {out}: {sum(len(c['entities']) for c in doc['categories'].values())} movers, {n} with notes ({doc['model'] or 'no model key'})")


def candidates(args) -> None:
    """Watchlist entities that pass the gate and could be listed, plus listed ones that currently fail it."""
    reg = registry.load()
    snap = oracle.snapshot(Store(args.db), reg)
    for ckey, c in snap["categories"].items():
        ready = [e for e in c["entities"] if e["reason"] == "candidate"]
        weak = [e for e in c["entities"] if e["listed"] and not e["eligible"]]
        print(f"{c['label']}: {sum(e['listed'] for e in c['entities'])} listed")
        for e in ready:
            print(f"  + ready to list: {e['name']} ({e['character']['per_day']:.0f} stories/day)")
        for e in weak:
            print(f"  - listed but below gate ({e['reason']}): {e['name']} ({e['character']['per_day']:.0f}/day) — gets no target until it recovers")


EXPLAIN_EVERY_S = 3600


def keeper(args) -> None:
    """Loop: ingest new files, post, fund. Runs forever."""
    import time
    while True:
        try:
            ingest(argparse.Namespace(db=args.db, latest=True, hours=None, days=0, every=1, workers=4, recount=False))
            snapshot(argparse.Namespace(db=args.db, at=None, out=str(ROOT / "out" / "latest.json")))
            exp = ROOT / "out" / "explain.json"
            if not exp.exists() or time.time() - exp.stat().st_mtime > EXPLAIN_EVERY_S:  # paid API: not every loop
                explain_cmd(argparse.Namespace(db=args.db, out=str(exp)))
            post(args)
        except Exception as e:  # keep the keeper alive through network blips
            print(f"keeper error: {e}", flush=True)
        time.sleep(args.interval)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="zg")
    ap.add_argument("--db", default=str(DB))
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ingest")
    a.add_argument("--days", type=float, default=33)
    a.add_argument("--every", type=int, default=4, help="take every Nth 15-min file (backfill sampling)")
    a.add_argument("--latest", action="store_true", help="fetch all new files since the last stored one")
    a.add_argument("--hours", type=float, default=None)
    a.add_argument("--recount", action="store_true", help="refetch batches counted under an older registry version")
    a.add_argument("--workers", type=int, default=6)
    a.set_defaults(fn=ingest)
    s = sub.add_parser("snapshot")
    s.add_argument("--at", default=None, help="YYYYMMDDHHMMSS (default: latest batch)")
    s.add_argument("--out", default=str(ROOT / "out" / "latest.json"))
    s.set_defaults(fn=snapshot)
    r = sub.add_parser("report")
    r.add_argument("--at", default=None)
    r.set_defaults(fn=report)
    ex = sub.add_parser("explain")
    ex.add_argument("--out", default=str(ROOT / "out" / "explain.json"))
    ex.set_defaults(fn=explain_cmd)
    cd = sub.add_parser("candidates")
    cd.set_defaults(fn=candidates)
    mf = sub.add_parser("manifest")
    mf.add_argument("--out", default=str(ROOT.parent / "contracts" / "script" / "entities.json"))
    mf.set_defaults(fn=manifest)
    for name, fn in (("post", post), ("keeper", keeper)):
        q = sub.add_parser(name)
        q.add_argument("--rpc", default="http://127.0.0.1:8545")
        q.add_argument("--deployment", default=str(ROOT.parent / "contracts" / "deployments" / "31337.json"))
        q.add_argument("--interval", type=int, default=300)
        q.set_defaults(fn=fn)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
