"""SQLite store of per-batch counts. Everything the oracle publishes is derived from these rows."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS headlines (   -- display only: not an oracle input, not in inputs_hash
  ts TEXT NOT NULL, category TEXT NOT NULL, entity TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, domain TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS headlines_ent ON headlines(category, entity, ts);
CREATE TABLE IF NOT EXISTS batches (
  ts        TEXT PRIMARY KEY,      -- GDELT file stamp YYYYMMDDHHMMSS
  md5       TEXT NOT NULL,         -- md5 of the zip consumed (input commitment)
  corpus    INTEGER NOT NULL,      -- unique titles in the batch (PR wires excluded)
  articles  INTEGER NOT NULL,
  registry  TEXT NOT NULL,         -- registry version used to count
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counts (
  ts       TEXT NOT NULL,
  category TEXT NOT NULL,
  entity   TEXT NOT NULL,
  n        INTEGER NOT NULL,       -- unique titles about the entity
  domains  INTEGER NOT NULL,
  PRIMARY KEY (ts, category, entity)
);
CREATE TABLE IF NOT EXISTS missing (
  ts TEXT PRIMARY KEY,             -- GDELT returned 404: never interpolate (SPEC_V2 §8.1)
  noted_at TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path | str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        self.db.executescript(SCHEMA)

    def have(self) -> set[str]:
        rows = self.db.execute("SELECT ts FROM batches UNION SELECT ts FROM missing").fetchall()
        return {r[0] for r in rows}

    def put(self, ts: str, md5: str, corpus: int, articles: int, registry: str, counts: dict, domains: dict) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO batches VALUES (?,?,?,?,?,?)", (ts, md5, corpus, articles, registry, now))
            self.db.execute("DELETE FROM counts WHERE ts=?", (ts,))
            self.db.executemany(
                "INSERT INTO counts VALUES (?,?,?,?,?)",
                [(ts, c, e, n, domains.get((c, e), 0)) for (c, e), n in counts.items()],
            )

    def put_headlines(self, ts: str, samples: dict) -> None:
        with self.db:
            self.db.execute("DELETE FROM headlines WHERE ts=?", (ts,))
            self.db.executemany("INSERT INTO headlines VALUES (?,?,?,?,?,?)",
                                [(ts, c, e, t, u, d) for (c, e), rows in samples.items() for t, u, d in rows])

    def headlines(self, category: str, entity: str, since_ts: str, limit: int = 12) -> list[tuple[str, str, str, str]]:
        return self.db.execute(
            "SELECT ts, title, url, domain FROM headlines WHERE category=? AND entity=? AND ts > ? ORDER BY ts DESC LIMIT ?",
            (category, entity, since_ts, limit)).fetchall()

    def put_missing(self, ts: str) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO missing VALUES (?,?)", (ts, now))

    def batches(self, start_ts: str, end_ts: str) -> list[tuple[str, str, int]]:
        return self.db.execute(
            "SELECT ts, md5, corpus FROM batches WHERE ts > ? AND ts <= ? ORDER BY ts", (start_ts, end_ts)
        ).fetchall()

    def counts(self, start_ts: str, end_ts: str) -> dict[tuple[str, str], dict[str, int]]:
        out: dict[tuple[str, str], dict[str, int]] = {}
        for ts, c, e, n in self.db.execute(
            "SELECT ts, category, entity, n FROM counts WHERE ts > ? AND ts <= ?", (start_ts, end_ts)
        ):
            out.setdefault((c, e), {})[ts] = n
        return out

    def last_ts(self) -> str | None:
        r = self.db.execute("SELECT MAX(ts) FROM batches").fetchone()
        return r[0]
