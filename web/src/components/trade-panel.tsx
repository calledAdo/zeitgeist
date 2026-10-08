"use client";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { abis, addr, type CategoryKey } from "@/lib/contracts";
import { publicClient, useWallet } from "@/lib/wallet";
import type { MarketState } from "@/hooks/use-market";
import type { Row } from "@/components/board";
import { CharacterBand } from "@/components/character-band";
import { Button } from "@/components/ui/button";
import { Fig } from "@/components/ui/bits";
import { EntityImage } from "@/components/entity-image";
import { PriceChart } from "@/components/price-chart";
import { WhyMoving } from "@/components/why-moving";
import { cn, pct, signed, usd } from "@/lib/utils";

type Side = "buy" | "sell";

export function TradePanel({ category, row, state, onClose }: { category: CategoryKey; row: Row | null; state: MarketState | null; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <AnimatePresence>
      {row && state && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-foreground/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label={`Trade ${row.snap.name}`}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l bg-background"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
          >
            <Body key={row.chain.index} category={category} row={row} state={state} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Body({ category, row, state, onClose }: { category: CategoryKey; row: Row; state: MarketState; onClose: () => void }) {
  const { account, connect, send, pending } = useWallet();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const market = addr.market(category);
  const gauge = addr.gauge(category);
  const i = BigInt(row.chain.index);
  const ch = row.snap.character;

  const raw = (() => {
    try {
      return amount ? parseUnits(amount, side === "buy" ? 6 : 18) : 0n;
    } catch {
      return 0n;
    }
  })();

  useEffect(() => {
    if (raw === 0n) return setQuote(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = (await publicClient.readContract({ address: market, abi: abis.CategoryMarket, functionName: side === "buy" ? "quoteBuy" : "quoteSell", args: [i, raw] })) as [bigint, bigint];
        if (live) setQuote(r[0]);
      } catch (e) {
        console.error("quote failed", e);
        if (live) setQuote(null);
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [raw, side, market, i]);

  const needsUsd = side === "buy" && raw > state.usdBalance;
  const needsApproval = side === "buy" && raw > state.usdAllowance;
  const overSell = side === "sell" && raw > row.chain.balance;
  const value = (row.chain.balance + row.chain.staked) * row.chain.price / 10n ** 18n;
  const minOut = quote ? (quote * 99n) / 100n : 0n; // 1% slippage guard

  const w = (fn: Parameters<typeof send>[0], opts?: Parameters<typeof send>[1]) => send(fn, opts).then(() => setAmount(""));

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
        <div className="flex items-center gap-4">
        <EntityImage category={category} entityKey={row.snap.key} name={row.snap.name} hot={(row.snap.heat ?? 0) >= 1} className="size-16 shrink-0" rounded="rounded-xl" />
        <div>
          <h2 className="text-2xl font-semibold">{row.snap.name}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-foreground/60">
            <Fig className="text-foreground">{usd(row.chain.price)}</Fig> a share
          </div>
        </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
      </div>

      <section className="space-y-2 border-b px-6 py-5">
        <div className="text-sm font-medium">Price history</div>
        <PriceChart market={market} index={row.chain.index} />
      </section>
      <WhyMoving category={category} entityKey={row.snap.key} />

      <section className="space-y-4 border-b px-6 py-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Against their normal</span>
          <span className={cn("text-sm tabular-nums", (row.snap.heat ?? 0) >= 1 ? "text-emerald-600" : (row.snap.heat ?? 0) <= -1 ? "text-red-600" : "text-foreground/70")}>
            heat {row.snap.heat === null ? "—" : signed(row.snap.heat, 2)}
          </span>
        </div>
        <CharacterBand heat={row.snap.heat} className="w-full" />
        <p className="text-sm leading-relaxed text-foreground/60">
          Normally {Math.round(ch.per_day).toLocaleString()} stories a day; one point of heat takes ×{ch.plus1.toFixed(2)} that.
          {" "}This category's funding target for them is {pct(row.target)} of the money; they hold {pct(row.share)}.
          {row.gapPts > 0.05 ? " The next funding round moves money in." : row.gapPts < -0.05 ? " The next funding round moves money out." : ""}
        </p>
      </section>

      <section className="border-b px-6 py-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <Mini label="Your shares" value={Number(formatUnits(row.chain.balance + row.chain.staked, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
          <Mini label="Worth about" value={usd(value)} />
          <Mini label="ZEIT earned" value={Number(formatUnits(row.chain.earned, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
        </div>
      </section>

      <section className="space-y-4 px-6 py-5">
        <div className="inline-flex rounded-xl border border-foreground/10 bg-foreground/[0.02] p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} onClick={() => { setSide(s); setAmount(""); }} className={cn("rounded-lg px-4 py-1.5 text-sm capitalize transition-colors duration-300", side === s ? "bg-background font-medium shadow-sm" : "text-foreground/60 hover:text-foreground")}>
              {s}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1.5 flex justify-between text-sm font-medium">
            {side === "buy" ? "Amount in test USD" : "Shares to sell"}
            {side === "sell" && row.chain.balance > 0n && (
              <button className="text-xs font-normal text-foreground/60 underline underline-offset-2 hover:text-foreground" onClick={() => setAmount(formatUnits(row.chain.balance, 18))}>Max</button>
            )}
            {side === "buy" && account && <span className="text-xs font-normal text-foreground/50">Balance {usd(state.usdBalance)}</span>}
          </span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={side === "buy" ? "100" : "0.0"}
            className="h-12 w-full rounded-lg border border-foreground/10 bg-field px-4 text-base tabular-nums outline-none transition-colors focus:border-foreground focus:ring-1 focus:ring-foreground"
          />
        </label>

        <div className="flex justify-between text-sm text-foreground/60">
          <span>{side === "buy" ? "You get about" : "You receive about"}</span>
          <span className="tabular-nums text-foreground">
            {quote === null ? "—" : side === "buy" ? `${Number(formatUnits(quote, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares` : usd(quote)}
          </span>
        </div>
        <p className="text-xs text-foreground/50">Includes the 0.5% fee. Orders fail if the price moves more than 1% before they confirm.</p>

        {!account ? (
          <Button className="w-full" size="lg" onClick={connect}>Sign in</Button>
        ) : needsUsd ? (
          <Button className="w-full" size="lg" variant="outline" disabled={pending}
            onClick={() => w((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: addr.usd, abi: abis.TestUSDC, functionName: "mint", args: [a.address, parseUnits("1000", 6)] }))}>
            Get 1,000 test USD
          </Button>
        ) : side === "buy" && needsApproval ? (
          <Button className="w-full" size="lg" disabled={pending}
            onClick={() => send((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: addr.usd, abi: abis.TestUSDC, functionName: "approve", args: [market, maxUint256] }))}>
            Allow trading with test USD
          </Button>
        ) : (
          <Button className="w-full" size="lg" variant={side === "buy" ? "default" : "outline"} disabled={pending || raw === 0n || quote === null || overSell}
            onClick={() => w((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: market, abi: abis.CategoryMarket, functionName: side, args: [i, raw, minOut, a.address] }), side === "buy" ? { usd: raw } : {})}>
            {overSell ? "You don't hold that many" : side === "buy" ? `Buy ${row.snap.name}` : `Sell ${row.snap.name}`}
          </Button>
        )}
      </section>

      {account && (row.chain.balance > 0n || row.chain.staked > 0n || row.chain.earned > 0n) && (
        <section className="mt-auto space-y-3 border-t bg-foreground/[0.02] px-6 py-5">
          <div className="text-sm font-medium">Earn ZEIT on these shares</div>
          <p className="text-xs leading-relaxed text-foreground/60">
            Staked shares earn this category's weekly ZEIT, at the same rate per dollar as every other name in it. Staking doesn't change your exposure.
          </p>
          <div className="flex flex-wrap gap-2">
            {row.chain.balance > 0n && (
              <Button size="sm" disabled={pending} onClick={async () => {
                await send((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: row.chain.token, abi: abis.EntityToken, functionName: "approve", args: [gauge, row.chain.balance] }));
                await send((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: gauge, abi: abis.EntityGauge, functionName: "stake", args: [i, row.chain.balance] }));
              }}>
                Stake {Number(formatUnits(row.chain.balance, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares
              </Button>
            )}
            {row.chain.staked > 0n && (
              <Button size="sm" variant="outline" disabled={pending}
                onClick={() => send((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: gauge, abi: abis.EntityGauge, functionName: "withdraw", args: [i, row.chain.staked] }))}>
                Unstake
              </Button>
            )}
            {row.chain.earned > 0n && (
              <Button size="sm" variant="outline" disabled={pending}
                onClick={() => send((wc, a) => wc.writeContract({ account: a, chain: wc.chain, address: gauge, abi: abis.EntityGauge, functionName: "getReward", args: [i] }))}>
                Claim ZEIT
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-foreground/60">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}
