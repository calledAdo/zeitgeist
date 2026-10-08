"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CATEGORIES } from "@/lib/contracts";
import { asOfDate, useSnapshot } from "@/lib/snapshot";
import { CharacterBand } from "@/components/character-band";
import { Card, Fig } from "@/components/ui/bits";
import { EntityImage } from "@/components/entity-image";
import { cn, signed } from "@/lib/utils";

export function HeroFigures() {
  const { snap } = useSnapshot();
  const listed = snap ? Object.values(snap.categories).flatMap((c) => c.entities.filter((e) => e.listed)).length : null;
  return (
    <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-foreground/60">
      <span><Fig className="text-foreground">{listed ?? "…"}</Fig> names</span>
      <span className="hidden h-4 w-px bg-foreground/15 sm:block" />
      <span><Fig className="text-foreground">3</Fig> categories</span>
      <span className="hidden h-4 w-px bg-foreground/15 sm:block" />
      <span>news read every <Fig className="text-foreground">15 min</Fig></span>
    </div>
  );
}

export function HotNow() {
  const { snap } = useSnapshot();
  return (
    <section className="mx-auto max-w-6xl px-6 pt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-3xl font-semibold sm:text-4xl">Running hot right now</h2>
        {snap && <span className="text-sm text-foreground/50">News counted to {asOfDate(snap.as_of).toUTCString().slice(5, 22)} UTC</span>}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {CATEGORIES.map((c) => {
          const top = (snap?.categories[c.key]?.entities ?? []).filter((e) => e.listed && e.heat !== null).sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 3);
          return (
            <Card key={c.key} className="flex flex-col p-6 transition-shadow duration-300 hover:shadow-lg">
              <div className="font-medium">{c.label}</div>
              <ul className="mt-5 flex-1 space-y-4">
                {!snap && <li className="text-sm text-foreground/50">Loading…</li>}
                {top.map((e) => (
                  <li key={e.key} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <EntityImage category={c.key} entityKey={e.key} name={e.name} hot={(e.heat ?? 0) >= 1} className="size-8 shrink-0" rounded="rounded-full" />
                      <span className="truncate text-sm">{e.name}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <CharacterBand heat={e.heat} className="w-20" />
                      <span className={cn("w-10 text-right text-sm tabular-nums", (e.heat ?? 0) >= 1 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/70")}>{signed(e.heat ?? 0, 1)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href={`/markets/${c.key}`} className="group mt-6 inline-flex items-center gap-1.5 text-sm font-medium">
                See all {snap?.categories[c.key]?.entities.filter((e) => e.listed).length ?? ""}
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function ProofPanel() {
  const { snap } = useSnapshot();
  return (
    <section className="mx-4 mb-16 sm:mx-6">
      <div className="grain mx-auto max-w-6xl overflow-hidden rounded-xl bg-[#0a0a0a] px-8 py-16 text-white sm:px-12">
        <h2 className="max-w-3xl bg-gradient-to-r from-white to-white/60 bg-clip-text text-4xl font-semibold text-transparent sm:text-5xl">
          Every price traces back to public news files.
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/60">
          Each funding round commits to a fingerprint of the exact GDELT news files and counting rules it used.
          Anyone can fetch the same public data, rerun the count and check the result.
        </p>
        {snap && (
          <dl className="mt-10 grid gap-6 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-white/50">News files in the latest count</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{snap.batches_used.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-white/50">Counting rules version</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{snap.registry_version}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-white/50">Input fingerprint</dt>
              <dd className="mt-1 truncate font-mono text-base text-white/80" title={snap.inputs_hash}>{snap.inputs_hash.slice(0, 20)}…</dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
