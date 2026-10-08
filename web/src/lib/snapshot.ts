"use client";
import { useEffect, useState } from "react";

export type Character = { ready: boolean; days: number; mu: number; sigma: number; per_day: number; plus1: number };
export type SnapEntity = {
  key: string;
  name: string;
  listed: boolean;
  index: number | null;
  eligible: boolean;
  reason: string | null;
  stories_last_batch: number;
  attention: number;
  heat: number | null;          // news heat against the entity's own character; drives the price
  target: number | null;
  target_twap: number | null;
  character: Character;
};
export type Snapshot = {
  as_of: string;
  inputs_hash: string;
  registry_version: string;
  batches_used: number;
  character_anchor: string;
  categories: Record<string, { label: string; entities: SnapEntity[] }>;
};

export function asOfDate(ts: string) {
  return new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12)));
}

/** Polls /snapshot.json (written by the indexer) once a minute. */
export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${process.env.NEXT_PUBLIC_DATA_URL ?? ""}/snapshot.json`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`snapshot ${r.status}`))))
        .then((s) => live && (setSnap(s), setError(null)))
        .catch((e) => live && setError(String(e.message ?? e)));
    load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);
  return { snap, error };
}
