"use client";
// Funding rounds and the trader leaderboard, both from the Envio index.
import { CATEGORIES } from "@/lib/contracts";
import { useIndexer, type Round } from "@/lib/indexer";
import { Fig } from "@/components/ui/bits";
import { usd } from "@/lib/utils";

const Q = `{
  FundingRound(order_by: {timestamp: desc}, limit: 30) { id category epoch inputsHash moved timestamp txHash }
  Trader(order_by: {realizedPnl: desc}, limit: 10) { id trades volume realizedPnl }
  Market { category volume feesAccrued totalReserve }
}`;

type Data = {
  FundingRound: Round[];
  Trader: { id: string; trades: number; volume: string; realizedPnl: string }[];
  Market: { category: string; volume: string; feesAccrued: string; totalReserve: string }[];
};

const label = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const signedUsd = (v: bigint) => `${v >= 0n ? "+" : "−"}${usd(v < 0n ? -v : v)}`;

export function ActivityView() {
  const d = useIndexer<Data>(Q, {}, 8000);
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <h1 className="text-4xl font-semibold sm:text-5xl">Activity</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-foreground/60">
        Every funding round with the fingerprint of the news files behind it, and who has read the attention best. Indexed by Envio.
      </p>
      {!d ? (
        <p className="mt-10 rounded-xl border border-dashed px-5 py-6 text-sm text-foreground/60">Waiting for the indexer…</p>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <section>
            <h2 className="text-2xl font-semibold">Funding rounds</h2>
            <ul className="mt-4 divide-y rounded-xl border text-sm">
              {d.FundingRound.length === 0 && <li className="px-5 py-6 text-foreground/60">No rounds yet.</li>}
              {d.FundingRound.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3">
                  <div>
                    <div className="font-medium">{label(r.category)}</div>
                    <div className="text-xs text-foreground/50">{when(r.timestamp)} · inputs <span className="font-mono">{r.inputsHash.slice(0, 10)}…</span></div>
                  </div>
                  <span className="text-foreground/70"><Fig>{usd(BigInt(r.moved))}</Fig> moved to hotter names</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="space-y-10">
            <section>
              <h2 className="text-2xl font-semibold">Leaderboard</h2>
              <ol className="mt-4 divide-y rounded-xl border text-sm">
                {d.Trader.length === 0 && <li className="px-5 py-6 text-foreground/60">No trades yet.</li>}
                {d.Trader.map((t, i) => (
                  <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <span className="flex items-center gap-3">
                      <span className="w-5 text-foreground/40 tabular-nums">{i + 1}</span>
                      <span className="font-mono text-xs">{t.id.slice(0, 6)}…{t.id.slice(-4)}</span>
                    </span>
                    <span className="text-right">
                      <Fig>{signedUsd(BigInt(t.realizedPnl))}</Fig>
                      <span className="block text-xs text-foreground/50">{t.trades} trades · {usd(BigInt(t.volume), 0)} volume</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2 className="text-2xl font-semibold">Markets</h2>
              <ul className="mt-4 divide-y rounded-xl border text-sm">
                {d.Market.map((m) => (
                  <li key={m.category} className="flex items-center justify-between gap-4 px-5 py-3">
                    <span className="font-medium">{label(m.category)}</span>
                    <span className="text-right text-xs text-foreground/60">
                      {usd(BigInt(m.totalReserve), 0)} pooled · {usd(BigInt(m.volume), 0)} traded · {usd(BigInt(m.feesAccrued))} fees
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
