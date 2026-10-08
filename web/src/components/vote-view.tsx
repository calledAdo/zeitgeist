"use client";
import { useEffect, useState } from "react";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { CATEGORIES, abis, addr, categoryId, deployed } from "@/lib/contracts";
import { publicClient, useWallet } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { Card, Fig } from "@/components/ui/bits";
import { cn, duration, pct, usd } from "@/lib/utils";

const WEEK = 7 * 24 * 3600;
const r = (address: Address, abi: (typeof abis)[keyof typeof abis], functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<unknown>;

type VoteState = {
  zeit: bigint; locked: bigint; lockEnd: number; power: bigint; zeitAllowance: bigint;
  epoch: number; chainTime: number;
  votes: bigint[]; total: bigint; mine: bigint[];
  claim: bigint[]; usdBalance: bigint; usdAllowanceVoter: bigint;
};

export function VoteView() {
  const { account, connect, send, pending, tick } = useWallet();
  const [s, setS] = useState<VoteState | null>(null);
  const [lockAmt, setLockAmt] = useState("");
  const [weeks, setWeeks] = useState(52);
  const [weights, setWeights] = useState<number[]>([1, 1, 1]);
  const [bribeCat, setBribeCat] = useState(0);
  const [bribeAmt, setBribeAmt] = useState("");

  useEffect(() => {
    if (!deployed) return;
    let live = true;
    (async () => {
      const block = await publicClient.getBlock();
      const t = Number(block.timestamp);
      const epoch = Math.floor(t / WEEK);
      const cats = CATEGORIES.map((c) => categoryId(c.key));
      const votes = (await Promise.all(cats.map((c) => r(addr.voter, abis.CategoryVoter, "votes", [BigInt(epoch), c])))) as bigint[];
      const total = (await r(addr.voter, abis.CategoryVoter, "totalVotes", [BigInt(epoch)])) as bigint;
      let rest: Partial<VoteState> = { zeit: 0n, locked: 0n, lockEnd: 0, power: 0n, zeitAllowance: 0n, mine: [0n, 0n, 0n], claim: [0n, 0n, 0n], usdBalance: 0n, usdAllowanceVoter: 0n };
      if (account) {
        const [zeit, lock, power, zeitAllowance, usdBalance, usdAllowanceVoter] = await Promise.all([
          r(addr.zeit, abis.Zeit, "balanceOf", [account]), r(addr.ve, abis.VotingEscrow, "locks", [account]),
          r(addr.ve, abis.VotingEscrow, "votingPower", [account]), r(addr.zeit, abis.Zeit, "allowance", [account, addr.ve]),
          r(addr.usd, abis.TestUSDC, "balanceOf", [account]), r(addr.usd, abis.TestUSDC, "allowance", [account, addr.voter]),
        ]);
        const mine = (await Promise.all(cats.map((c) => r(addr.voter, abis.CategoryVoter, "userVotes", [BigInt(epoch), account, c])))) as bigint[];
        const claim = (await Promise.all(cats.map((c) => r(addr.voter, abis.CategoryVoter, "claimable", [BigInt(epoch - 1), c, addr.usd, account])))) as bigint[];
        const [amt, end] = lock as [bigint, bigint];
        rest = { zeit: zeit as bigint, locked: amt, lockEnd: Number(end), power: power as bigint, zeitAllowance: zeitAllowance as bigint, mine, claim, usdBalance: usdBalance as bigint, usdAllowanceVoter: usdAllowanceVoter as bigint };
      }
      if (live) setS({ epoch, chainTime: t, votes, total, ...(rest as Omit<VoteState, "epoch" | "chainTime" | "votes" | "total">) });
    })().catch(console.error);
    return () => { live = false; };
  }, [account, tick]);

  const parse = (v: string, d: number) => { try { return v ? parseUnits(v, d) : 0n; } catch { return 0n; } };
  const lockRaw = parse(lockAmt, 18);
  const bribeRaw = parse(bribeAmt, 6);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const flipIn = s ? (s.epoch + 1) * WEEK - s.chainTime : 0;
  const hasLock = s ? s.locked > 0n && s.lockEnd > s.chainTime : false;
  const expired = s ? s.locked > 0n && s.lockEnd <= s.chainTime : false;
  const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold sm:text-5xl">Vote for a category</h1>
        <p className="mt-3 text-lg leading-relaxed text-foreground/60">
          Lock ZEIT to get voting power. Voters earn the trading fees and bribes of the categories they back, and decide how next week's ZEIT is split between them.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <Stat label="Week ends in" value={s ? duration(flipIn) : "—"} sub="votes close 1 hour before" />
        <Stat label="Your ZEIT" value={s ? fmt(s.zeit) : "—"} />
        <Stat label="Locked" value={s ? fmt(s.locked) : "—"} sub={hasLock && s ? `until ${new Date(s.lockEnd * 1000).toUTCString().slice(5, 16)}` : undefined} />
        <Stat label="Voting power" value={s ? fmt(s.power) : "—"} sub="fades to zero at unlock" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xl font-semibold">{hasLock ? "Add to your lock" : "Lock ZEIT"}</h2>
          <p className="mt-1 text-sm text-foreground/60">Longer locks give more power. Power falls in a straight line until the lock ends.</p>
          {!account ? (
            <Button className="mt-6" onClick={connect}>Sign in</Button>
          ) : expired ? (
            <Button className="mt-6" disabled={pending} onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.ve, abi: abis.VotingEscrow, functionName: "withdraw" }))}>
              Withdraw {fmt(s!.locked)} ZEIT
            </Button>
          ) : (
            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-1.5 flex justify-between text-sm font-medium">Amount <button className="text-xs font-normal text-foreground/60 underline underline-offset-2" onClick={() => s && setLockAmt(formatUnits(s.zeit, 18))}>Max</button></span>
                <input inputMode="decimal" value={lockAmt} onChange={(e) => setLockAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="1000"
                  className="h-12 w-full rounded-lg border border-foreground/10 bg-field px-4 tabular-nums outline-none focus:border-foreground focus:ring-1 focus:ring-foreground" />
              </label>
              {!hasLock && (
                <label className="block">
                  <span className="mb-1.5 flex justify-between text-sm font-medium">Lock for <span className="tabular-nums text-foreground/60">{weeks} weeks</span></span>
                  <input type="range" min={1} max={52} value={weeks} onChange={(e) => setWeeks(+e.target.value)} className="w-full accent-foreground" />
                  <span className="mt-1 block text-xs text-foreground/50">Starting power about {lockRaw ? fmt((lockRaw * BigInt(weeks)) / 52n) : "0"}</span>
                </label>
              )}
              {s && lockRaw > s.zeitAllowance ? (
                <Button disabled={pending || lockRaw === 0n} onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.zeit, abi: abis.Zeit, functionName: "approve", args: [addr.ve, maxUint256] }))}>Allow locking</Button>
              ) : (
                <Button disabled={pending || lockRaw === 0n || (s ? lockRaw > s.zeit : true)}
                  onClick={() => send((w, a) => hasLock
                    ? w.writeContract({ account: a, chain: w.chain, address: addr.ve, abi: abis.VotingEscrow, functionName: "increaseAmount", args: [lockRaw] })
                    : w.writeContract({ account: a, chain: w.chain, address: addr.ve, abi: abis.VotingEscrow, functionName: "createLock", args: [lockRaw, BigInt(weeks * WEEK)] }), { sensitive: true }).then(() => setLockAmt(""))}>
                  {hasLock ? "Add to lock" : `Lock for ${weeks} weeks`}
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold">Split your vote</h2>
          <p className="mt-1 text-sm text-foreground/60">Voting again this week replaces your earlier vote.</p>
          <ul className="mt-6 space-y-5">
            {CATEGORIES.map((c, i) => {
              const share = s && s.total > 0n ? Number(s.votes[i]) / Number(s.total) : 0;
              return (
                <li key={c.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.label}</span>
                    <span className="tabular-nums text-foreground/60">{wsum ? pct(weights[i] / wsum, 0) : "0%"} of yours · {pct(share, 0)} of all votes</span>
                  </div>
                  <input aria-label={`${c.label} weight`} type="range" min={0} max={10} value={weights[i]} onChange={(e) => setWeights((w) => w.map((x, j) => (j === i ? +e.target.value : x)))} className="mt-2 w-full accent-foreground" />
                  {s && s.mine[i] > 0n && <div className="text-xs text-foreground/50">Your current vote: {fmt(s.mine[i])}</div>}
                </li>
              );
            })}
          </ul>
          <Button className="mt-6" disabled={!account || pending || !s || s.power === 0n || wsum === 0}
            onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.voter, abi: abis.CategoryVoter, functionName: "vote", args: [CATEGORIES.map((c) => categoryId(c.key)), weights.map(BigInt)] }), { sensitive: true })}>
            {s && s.power === 0n && account ? "Lock ZEIT to vote" : "Cast vote"}
          </Button>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold">Fees from last week</h2>
          <p className="mt-1 text-sm text-foreground/60">Paid in test USD to the categories you voted for last week.</p>
          <ul className="mt-6 divide-y border-y">
            {CATEGORIES.map((c, i) => (
              <li key={c.key} className="flex items-center justify-between py-3 text-sm">
                <span>{c.label}</span>
                <span className="flex items-center gap-3">
                  <Fig>{usd(s?.claim[i] ?? 0n)}</Fig>
                  <Button size="sm" variant="outline" disabled={!s || s.claim[i] === 0n || pending}
                    onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.voter, abi: abis.CategoryVoter, functionName: "claim", args: [BigInt(s!.epoch - 1), categoryId(c.key), addr.usd] }))}>
                    Claim
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-dashed p-6 shadow-none">
          <h2 className="text-xl font-semibold">Post a bribe</h2>
          <p className="mt-1 text-sm text-foreground/60">Pay this week's voters of a category to steer more ZEIT to its holders next week.</p>
          <div className="mt-6 inline-flex rounded-xl border border-foreground/10 bg-foreground/[0.02] p-1">
            {CATEGORIES.map((c, i) => (
              <button key={c.key} onClick={() => setBribeCat(i)} className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors duration-300", bribeCat === i ? "bg-background font-medium shadow-sm" : "text-foreground/60 hover:text-foreground")}>{c.label}</button>
            ))}
          </div>
          <input inputMode="decimal" value={bribeAmt} onChange={(e) => setBribeAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount in test USD"
            className="mt-4 h-12 w-full rounded-lg border border-foreground/10 bg-field px-4 tabular-nums outline-none focus:border-foreground focus:ring-1 focus:ring-foreground" />
          {s && bribeRaw > s.usdAllowanceVoter ? (
            <Button className="mt-4" disabled={!account || pending || bribeRaw === 0n} onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.usd, abi: abis.TestUSDC, functionName: "approve", args: [addr.voter, maxUint256] }))}>Allow bribing with test USD</Button>
          ) : (
            <Button className="mt-4" disabled={!account || pending || bribeRaw === 0n || (s ? bribeRaw > s.usdBalance : true)}
              onClick={() => send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.voter, abi: abis.CategoryVoter, functionName: "notifyReward", args: [categoryId(CATEGORIES[bribeCat].key), addr.usd, bribeRaw] }), { sensitive: true }).then(() => setBribeAmt(""))}>
              Post bribe to {CATEGORIES[bribeCat].label} voters
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-background px-5 py-4">
      <div className="text-xs text-foreground/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-foreground/50">{sub}</div>}
    </div>
  );
}
