"use client";
// "Why is it moving": Kimi-written notes and the matched headlines. Display only, never in the price.
import { useEffect, useState } from "react";

export type Headline = { title: string; url: string; domain: string };
export type Explain = {
  as_of: string;
  model: string | null;
  categories: Record<string, { digest: string | null; entities: Record<string, { heat: number; why: string | null; headlines: Headline[] }> }>;
};

export function useExplain() {
  const [d, setD] = useState<Explain | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(`${process.env.NEXT_PUBLIC_DATA_URL ?? ""}/explain.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => live && j && setD(j)).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return d;
}
