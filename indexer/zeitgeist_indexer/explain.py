"""Plain-language "why is it moving" notes for the biggest movers, written by Kimi (Moonshot AI).

Display only: nothing here feeds heat, targets or the inputs hash. The model sees only headlines the
indexer matched for that entity in the last TWAP window plus the published heat, and is told not to
speculate beyond them. Without MOONSHOT_API_KEY the file still carries the headlines.
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import timedelta

from . import params as P
from .gkg import dt_to_ts, ts_to_dt

API = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1") + "/chat/completions"
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")
MOVER_HEAT = 0.5      # |heat| at or above this gets a note
MAX_MOVERS = 5        # per category

SYSTEM = (
    "You explain an attention market. Each name has a heat score: how far today's news coverage is above (+) "
    "or below (-) that name's own normal level, in units of its usual swings. Using ONLY the headlines given, "
    "write one or two short plain sentences per name saying what is driving coverage, or, for negative heat, "
    "that coverage is quieter than usual and what little is being covered. Never invent events, numbers or "
    "quotes not in the headlines; if the headlines don't explain it, say coverage is broad with no single story. "
    "No investment advice. Reply as JSON: {\"digest\": \"one sentence on the category\", \"names\": {\"<key>\": \"...\"}}."
)


def movers(cat: dict) -> list[dict]:
    ents = [e for e in cat["entities"] if e["eligible"] and e["heat"] is not None]
    hot = [e for e in ents if abs(e["heat"]) >= MOVER_HEAT]
    pick = hot or sorted(ents, key=lambda e: -abs(e["heat"]))[:3]
    return sorted(pick, key=lambda e: -abs(e["heat"]))[:MAX_MOVERS]


def kimi(label: str, items: list[dict], key: str) -> dict:
    user = {"category": label, "names": [{"key": i["key"], "name": i["name"], "heat": round(i["heat"], 2),
                                          "headlines": [h["title"] for h in i["headlines"]]} for i in items]}
    body = json.dumps({"model": MODEL, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(user)}]}).encode()
    req = urllib.request.Request(API, body, {"content-type": "application/json", "authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read())
    return json.loads(out["choices"][0]["message"]["content"])


def build(snap: dict, store) -> dict:
    since = dt_to_ts(ts_to_dt(snap["as_of"]) - timedelta(hours=P.TWAP_HOURS))
    key = os.environ.get("MOONSHOT_API_KEY")
    doc = {"as_of": snap["as_of"], "model": MODEL if key else None, "categories": {}}
    for ckey, cat in snap["categories"].items():
        items = []
        for e in movers(cat):
            seen, hs = set(), []
            for _, title, url, domain in store.headlines(ckey, e["key"], since, 40):
                if title.lower() not in seen:
                    seen.add(title.lower())
                    hs.append({"title": title, "url": url, "domain": domain})
            items.append({"key": e["key"], "name": e["name"], "heat": e["heat"], "headlines": hs[:8]})
        notes: dict = {}
        if key and items:
            try:
                notes = kimi(cat["label"], items, key)
            except Exception as ex:  # display feature: never block the snapshot on it
                print(f"kimi ({ckey}): {ex}")
        names = notes.get("names", {}) if isinstance(notes, dict) else {}
        doc["categories"][ckey] = {
            "digest": notes.get("digest") if isinstance(notes, dict) else None,
            "entities": {i["key"]: {"heat": i["heat"], "why": names.get(i["key"]), "headlines": i["headlines"]} for i in items},
        }
    return doc
