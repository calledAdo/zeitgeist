"use client";
// Envio HyperIndex GraphQL. Everything here degrades to `null` when the indexer is unreachable,
// so the app still works from chain reads alone.
import { useEffect, useState } from "react";

const URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8080/v1/graphql";

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0]?.message);
    return j.data as T;
  } catch (e) {
    console.warn("indexer unavailable", e);
    return null;
  }
}

/** Poll a query; `data` stays at the last good value. */
export function useIndexer<T>(query: string | null, variables: Record<string, unknown> = {}, everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const key = JSON.stringify(variables);
  useEffect(() => {
    if (!query) return;
    let live = true;
    const run = async () => {
      const d = await gql<T>(query, JSON.parse(key));
      if (live && d) setData(d);
    };
    run();
    const t = setInterval(run, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [query, key, everyMs]);
  return data;
}

export type PricePoint = { kind: "list" | "buy" | "sell" | "funding"; price: string; timestamp: number };
export type Round = { id: string; category: string; epoch: string; inputsHash: string; moved: string; timestamp: number; txHash: string };
export type PositionRow = { shares: string; costBasis: string; realizedPnl: string; listing: { index: number; category: string; price: string } };

export const listingId = (market: string, index: number) => `${market.toLowerCase()}-${index}`;
