"use client";
import Link from "next/link";
import { formatUnits } from "viem";
import { CATEGORIES, type CategoryKey } from "@/lib/contracts";
import { useMarket } from "@/hooks/use-market";
import { useSnapshot } from "@/lib/snapshot";
import { useWallet } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { Delta, Fig } from "@/components/ui/bits";
import { EntityImage } from "@/components/entity-image";
import { signed, usd } from "@/lib/utils";
import { useIndexer, type PositionRow } from "@/lib/indexer";
import { addr } from "@/lib/contracts";

const POS = `query($u: String!, $m: String!) { Position(where: {trader_id: {_eq: $u}, listing: {market_id: {_eq: $m}}}) { shares costBasis realizedPnl listing { index category price } } }`;

export function PortfolioView() {
  const { account, connect } = useWallet();
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <h1 className="text-4xl font-semibold sm:text-5xl">Your positions</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-foreground/60">Shares you hold or have staked, valued at the current price.</p>
      {!account ? (
        <div className="mt-10 rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-foreground/60">Sign in with your passkey to see your positions.</p>
          <Button className="mt-4" onClick={connect}>Sign in</Button>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {CATEGORIES.map((c) => <CategoryPositions key={c.key} category={c.key} label={c.label} />)}
        </div>
      )}
    </div>
  );
}

function CategoryPositions({ category, label }: { category: CategoryKey; label: string }) {
  const { state } = useMarket(category);
  const { snap } = useSnapshot();
  const { account } = useWallet();
  const idx = useIndexer<{ Position: PositionRow[] }>(account ? POS : null, { u: account?.toLowerCase(), m: addr.market(category).toLowerCase() });
  const pos = new Map((idx?.Position ?? []).map((p) => [p.listing.index, p]));
  const realized = (idx?.Position ?? []).reduce((a, p) => a + BigInt(p.realizedPnl), 0n);
  const names = new Map((snap?.categories[category]?.entities ?? []).filter((e) => e.index !== null).map((e) => [e.index!, e]));
  const held = (state?.entities ?? []).filter((e) => e.balance + e.staked > 0n);
  const total = held.reduce((a, e) => a + ((e.balance + e.staked) * e.price) / 10n ** 18n, 0n);
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold">{label}</h2>
        <div className="flex items-baseline gap-4">
          {idx && realized !== 0n && <span className="text-sm text-foreground/60">realised {realized > 0n ? "+" : "−"}{usd(realized < 0n ? -realized : realized)}</span>}
          <Fig className="text-foreground/80">{usd(total)}</Fig>
        </div>
      </div>
      {!held.length ? (
        <p className="mt-4 rounded-xl border border-dashed px-5 py-6 text-sm text-foreground/60">
          Nothing here yet. <Link className="font-medium text-foreground underline underline-offset-4 decoration-foreground/30" href={`/markets/${category}`}>Browse {label.toLowerCase()}</Link>
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-xl border">
          {held.map((e) => {
            const s = names.get(e.index);
            const shares = e.balance + e.staked;
            return (
              <li key={e.index} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-sm">
                <div className="flex items-center gap-3">
                {s && <EntityImage category={category} entityKey={s.key} name={s.name} hot={(s.heat ?? 0) >= 1} className="size-10 shrink-0" rounded="rounded-full" />}
                <div>
                  <div className="font-medium">{s?.name ?? `#${e.index}`}</div>
                  <div className="text-xs text-foreground/50">
                    {Number(formatUnits(shares, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares
                    {e.staked > 0n && ` · ${Number(formatUnits(e.staked, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} staked`}
                    {s?.heat != null && ` · heat ${signed(s.heat, 1)}`}
                  </div>
                </div>
                </div>
                <div className="flex items-center gap-3">
                  {e.earned > 0n && <span className="text-xs text-foreground/60">{Number(formatUnits(e.earned, 18)).toFixed(2)} ZEIT to claim</span>}
                  <Fig>{usd((shares * e.price) / 10n ** 18n)}</Fig>
                  <PnL value={(shares * e.price) / 10n ** 18n} p={pos.get(e.index)} fallback={Number(e.price - 1_000_000n) / 1_000_000} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Unrealised return against average cost (from the Envio index); falls back to change vs the $1 start price. */
function PnL({ value, p, fallback }: { value: bigint; p?: PositionRow; fallback: number }) {
  const cost = p ? BigInt(p.costBasis) : 0n;
  if (!p || cost === 0n) return <Delta v={fallback} />;
  const gain = value - cost;
  return (
    <span className="flex items-center gap-2" title={`cost ${usd(cost)}`}>
      <span className="text-xs text-foreground/50">{gain >= 0n ? "+" : "−"}{usd(gain < 0n ? -gain : gain)}</span>
      <Delta v={Number(gain) / Number(cost)} />
    </span>
  );
}
