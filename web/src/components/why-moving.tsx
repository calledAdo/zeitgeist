"use client";
import { useExplain } from "@/lib/explain";

export function WhyMoving({ category, entityKey }: { category: string; entityKey: string }) {
  const d = useExplain();
  const e = d?.categories[category]?.entities[entityKey];
  if (!e || (!e.why && e.headlines.length === 0)) return null;
  return (
    <section className="space-y-3 border-b px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Why it&apos;s moving</span>
        {e.why && d?.model && <span className="text-xs text-foreground/40">written by Kimi from the headlines</span>}
      </div>
      {e.why && <p className="text-sm leading-relaxed text-foreground/80">{e.why}</p>}
      {e.headlines.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {e.headlines.slice(0, 4).map((h) => (
            <li key={h.url} className="leading-snug">
              <a href={h.url} target="_blank" rel="noreferrer noopener" className="text-foreground/70 underline decoration-foreground/20 underline-offset-4 hover:text-foreground">{h.title}</a>
              <span className="ml-1.5 text-xs text-foreground/40">{h.domain}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CategoryDigest({ category }: { category: string }) {
  const d = useExplain();
  const g = d?.categories[category]?.digest;
  if (!g) return null;
  return <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/60"><span className="font-medium text-foreground/80">This round: </span>{g} <span className="text-foreground/40">(Kimi)</span></p>;
}
