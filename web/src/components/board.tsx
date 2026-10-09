"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, abis, addr, deployed, type CategoryKey } from "@/lib/contracts";
import { asOfDate, useSnapshot, type SnapEntity } from "@/lib/snapshot";
import { useMarket, type OnchainEntity } from "@/hooks/use-market";
import { useWallet } from "@/lib/wallet";
import { CharacterBand, GapBar } from "@/components/character-band";
import { TradePanel } from "@/components/trade-panel";
import { Button } from "@/components/ui/button";
import { Delta, Fig } from "@/components/ui/bits";
import { CategoryDigest } from "@/components/why-moving";
import { EntityImage } from "@/components/entity-image";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn, duration, pct, signed, usd } from "@/lib/utils";

export type Row = { snap: SnapEntity; chain: OnchainEntity; share: number; target: number; gapPts: number };

const SEED_PRICE = 1_000_000n; // $1.00 at listing

export function Board({ category }: { category: CategoryKey }) {
  const meta = CATEGORIES.find((c) => c.key === category)!;
  const { snap, error: snapError } = useSnapshot();
  const { state, error } = useMarket(category);
  const { send } = useWallet();
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "table">("grid");
  useEffect(() => {
    try { const v = localStorage.getItem("zg-view"); if (v === "grid" || v === "table") setView(v); } catch {}
  }, []);
  const pickView = (v: "grid" | "table") => { setView(v); try { localStorage.setItem("zg-view", v); } catch {} };
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const id = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(id); }, []);

  const rows: Row[] = useMemo(() => {
    if (!snap || !state) return [];
    const ents = snap.categories[category]?.entities ?? [];
    const byIndex = new Map(ents.filter((e) => e.index !== null && e.listed).map((e) => [e.index!, e]));
    const total = Number(state.totalReserve) || 1;
    return state.entities
      .filter((c) => byIndex.has(c.index))
      .map((c) => {
        const s = byIndex.get(c.index)!;
        const share = Number(c.reserve) / total;
        const target = s.target_twap ?? 0;
        return { snap: s, chain: c, share, target, gapPts: (target - share) * 100 };
      })
      .sort((a, b) => b.target - a.target);
  }, [snap, state, category]);

  // chain time can run ahead of wall time on a local dev chain; count down on chain time
  const chainNow = now + (state?.clockOffset ?? 0);
  const nextFunding = state ? (state.lastFundedEpoch + 1) * state.epochLength : 0;
  const fundable = state ? Math.floor(chainNow / state.epochLength) > state.lastFundedEpoch : false;
  const selected = rows.find((r) => r.chain.index === open) ?? null;

  if (!deployed) return <Empty title="Markets aren't deployed on this network yet" body="Run the deploy script, then `npm run sync` to load the addresses." />;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">{meta.label}</h1>
          <p className="mt-3 text-lg leading-relaxed text-foreground/60">
            {meta.blurb} Every 8 hours, money moves toward whoever is running hotter than their own normal.
          </p>
          <CategoryDigest category={category} />
        </div>
        <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:none] md:mx-0 md:px-0">
        <div className="inline-flex whitespace-nowrap rounded-xl border border-foreground/10 bg-foreground/[0.02] p-1">
          {CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={`/markets/${c.key}`}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors duration-300",
                c.key === category ? "bg-background font-medium text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground",
              )}
            >
              {c.label}
            </Link>
          ))}
        </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <Stat label="Money in this category" value={state ? usd(state.totalReserve, 0) : "—"} />
        <Stat label="Next funding" value={state ? (fundable ? "Ready" : duration(nextFunding - chainNow)) : "—"}>
          {fundable && (
            <Button size="sm" className="mt-3" onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.market(category), abi: abis.CategoryMarket, functionName: "applyFunding" }))}>
              Run funding
            </Button>
          )}
        </Stat>
        <Stat label="News counted up to" value={snap ? asOfDate(snap.as_of).toUTCString().slice(17, 22) + " UTC" : "—"} sub={snap ? asOfDate(snap.as_of).toUTCString().slice(5, 16) : undefined} />
        <Stat label="Listed" value={rows.length ? `${rows.length}` : "—"} sub="above 20 stories a day" />
      </div>

      {(error || snapError) && <p className="mt-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">{error ?? `Couldn't load the news snapshot: ${snapError}`}</p>}

      <div className="mt-10 flex items-center justify-between gap-4">
        <p className="text-sm text-foreground/60">Sorted by funding target. Photos and logos turn to colour when a name runs hot.</p>
        <div className="inline-flex rounded-lg border border-foreground/10 p-0.5" role="group" aria-label="Board layout">
          {([["grid", LayoutGrid, "Grid"], ["table", Rows3, "Table"]] as const).map(([v, Icon, label]) => (
            <button key={v} onClick={() => pickView(v)} aria-pressed={view === v} aria-label={label}
              className={cn("rounded-md p-1.5 transition-colors duration-300", view === v ? "bg-foreground text-background" : "text-foreground/50 hover:text-foreground")}>
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {view === "grid" && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {!rows.length && Array.from({ length: 8 }, (_, i) => <li key={i} className="aspect-[4/5] animate-pulse rounded-xl border bg-foreground/[0.02]" />)}
          {rows.map((r) => <Tile key={r.chain.index} category={category} row={r} active={open === r.chain.index} onOpen={() => setOpen(r.chain.index)} />)}
        </ul>
      )}

      {view === "table" && (
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-foreground/50">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Against their normal</th>
              <th className="px-3 py-3 text-right font-medium">Heat</th>
              <th className="px-3 py-3 text-right font-medium">Normal stories/day</th>
              <th className="px-3 py-3 font-medium">Money vs target</th>
              <th className="px-5 py-3 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr><td colSpan={6} className="px-5 py-16 text-center text-foreground/50">Loading the board…</td></tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.chain.index}
                onClick={() => setOpen(r.chain.index)}
                className={cn("cursor-pointer border-b transition-colors duration-200 last:border-0 hover:bg-foreground/[0.03]", open === r.chain.index && "bg-foreground/[0.04]")}
              >
                <td className="px-5 py-4">
                  <span className="group flex items-center gap-3">
                  <EntityImage category={category} entityKey={r.snap.key} name={r.snap.name} hot={(r.snap.heat ?? 0) >= 1} className="size-9 shrink-0" rounded="rounded-full" />
                  <button className="text-left font-medium tracking-tight focus-visible:outline-2" onClick={(e) => { e.stopPropagation(); setOpen(r.chain.index); }}>
                    {r.snap.name}
                  </button>
                  </span>
                  {r.chain.balance + r.chain.staked > 0n && <span className="ml-2 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">held</span>}
                  {!r.snap.eligible && <span className="mt-0.5 block text-xs text-foreground/50">Below the volume bar this week, so no funding</span>}
                </td>
                <td className="px-3 py-4"><CharacterBand heat={r.snap.heat} /></td>
                <td className={cn("px-3 py-4 text-right tabular-nums", (r.snap.heat ?? 0) >= 1 ? "text-emerald-600 dark:text-emerald-400" : (r.snap.heat ?? 0) <= -1 ? "text-red-600 dark:text-red-400" : "text-foreground/70")}>
                  {r.snap.heat === null ? "—" : signed(r.snap.heat, 1)}
                </td>
                <td className="px-3 py-4 text-right tabular-nums text-foreground/70">{Math.round(r.snap.character.per_day).toLocaleString()}</td>
                <td className="px-3 py-4">
                  <div className="flex items-center gap-3">
                    <GapBar share={r.share} target={r.target} />
                    <span className={cn("w-24 text-xs tabular-nums", r.gapPts > 0.05 ? "text-emerald-600 dark:text-emerald-400" : r.gapPts < -0.05 ? "text-red-600 dark:text-red-400" : "text-foreground/50")}>
                      {r.gapPts > 0.05 ? `${r.gapPts.toFixed(1)} pts under` : r.gapPts < -0.05 ? `${(-r.gapPts).toFixed(1)} pts over` : "on target"}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Fig>{usd(r.chain.price)}</Fig>
                    <Delta v={Number(r.chain.price - SEED_PRICE) / Number(SEED_PRICE)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-foreground/50">
        <span className="flex items-center gap-2"><CharacterBand heat={0} className="w-16" /> shaded = one normal swing either way</span>
        <span className="flex items-center gap-2"><span className="h-3 w-0.5 rounded-full bg-chart" /> funding target from the news</span>
        <span>Price change is since listing at $1.00</span>
      </div>

      <TradePanel category={category} row={selected} state={state} onClose={() => setOpen(null)} />
    </div>
  );
}

function Tile({ category, row: r, active, onOpen }: { category: CategoryKey; row: Row; active: boolean; onOpen: () => void }) {
  const heat = r.snap.heat ?? 0;
  const hot = heat >= 1;
  const cold = heat <= -1;
  const held = r.chain.balance + r.chain.staked > 0n;
  return (
    <li>
      <button
        onClick={onOpen}
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left ring-1 ring-transparent transition-shadow duration-300 hover:shadow-lg",
          hot && "border-emerald-500/30 ring-emerald-500/20",
          active && "ring-foreground",
        )}
      >
        <div className="relative">
          <EntityImage category={category} entityKey={r.snap.key} name={r.snap.name} hot={hot} rounded="rounded-none" className="aspect-[4/3] w-full" />
          <span className={cn(
            "absolute left-2.5 top-2.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums backdrop-blur-sm",
            hot ? "bg-emerald-500 text-white" : cold ? "bg-red-500/90 text-white" : "bg-background/80 text-foreground/80",
          )}>
            heat {r.snap.heat === null ? "—" : signed(heat, 1)}
          </span>
          {held && <span className="absolute right-2.5 top-2.5 rounded-md bg-foreground px-1.5 py-0.5 text-xs font-medium text-background">held</span>}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium leading-tight tracking-tight">{r.snap.name}</span>
          </div>
          <CharacterBand heat={r.snap.heat} className="w-full" />
          <div className="mt-auto flex items-end justify-between gap-2">
            <div>
              <Fig className="text-base">{usd(r.chain.price)}</Fig>
              <div className="mt-1"><Delta v={Number(r.chain.price - SEED_PRICE) / Number(SEED_PRICE)} /></div>
            </div>
            <span className={cn("text-right text-xs tabular-nums", r.gapPts > 0.05 ? "text-emerald-600 dark:text-emerald-400" : r.gapPts < -0.05 ? "text-red-600 dark:text-red-400" : "text-foreground/50")}>
              {r.gapPts > 0.05 ? `${r.gapPts.toFixed(1)} pts under target` : r.gapPts < -0.05 ? `${(-r.gapPts).toFixed(1)} pts over target` : "on target"}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function Stat({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-background px-5 py-4">
      <div className="text-xs text-foreground/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-foreground/50">{sub}</div>}
      {children}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-32 text-center">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-foreground/60">{body}</p>
    </div>
  );
}
