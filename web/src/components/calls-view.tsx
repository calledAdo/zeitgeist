"use client";
// Sealed calls: predict who heats up, seal it on-chain under a passkey-derived key, reveal later.
import { useEffect, useMemo, useState } from "react";
import { bytesToHex, type Hex } from "viem";
import { abis, addr, CATEGORIES, type CategoryKey } from "@/lib/contracts";
import { callKey, newCallId, openCall, sealCall, type CallPlain } from "@/lib/calls-crypto";
import { gql, listingId, useIndexer } from "@/lib/indexer";
import { useSnapshot } from "@/lib/snapshot";
import { useWallet } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/bits";
import { cn } from "@/lib/utils";

type CallRow = {
  id: Hex; caller: string; sealedAt: number; horizonEnd: number; ciphertext: Hex; revealed: boolean;
  opened: boolean; category: string | null; entityKey: string | null; direction: string | null; note: string | null;
};

const HORIZONS = [{ h: 24, label: "24 hours" }, { h: 72, label: "3 days" }, { h: 168, label: "1 week" }];
const FIELDS = "id caller sealedAt horizonEnd ciphertext revealed opened category entityKey direction note";
const MINE = `query($u: String!) { Call(where: {caller: {_eq: $u}}, order_by: {sealedAt: desc}) { ${FIELDS} } }`;
const PUBLIC = `{ Call(where: {revealed: {_eq: true}, opened: {_eq: true}}, order_by: {sealedAt: desc}, limit: 50) { ${FIELDS} } }`;

const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function CallsView() {
  const { account } = useWallet();
  const mine = useIndexer<{ Call: CallRow[] }>(account ? MINE : null, { u: account?.toLowerCase() }, 5000);
  const pub = useIndexer<{ Call: CallRow[] }>(PUBLIC, {}, 10000);
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <h1 className="text-4xl font-semibold sm:text-5xl">Calls</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-foreground/60">
        Say who heats up before it happens. Your call is sealed on Monad, encrypted under a key only your passkey can
        re-create, then opened when you choose. The chain's timestamp is your receipt.
      </p>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <SealForm />
        <MyCalls rows={mine?.Call ?? []} />
      </div>
      <Receipts rows={pub?.Call ?? []} />
    </div>
  );
}

function SealForm() {
  const { account, connect, send, pending, unlockCalls } = useWallet();
  const { snap } = useSnapshot();
  const [cat, setCat] = useState<CategoryKey>("geopolitics");
  const ents = (snap?.categories[cat]?.entities ?? []).filter((e) => e.listed);
  const [key, setKey] = useState("");
  const [dir, setDir] = useState<"up" | "down">("up");
  const [h, setH] = useState(72);
  const [note, setNote] = useState("");
  const pick = key && ents.some((e) => e.key === key) ? key : ents[0]?.key ?? "";

  const seal = async () => {
    const root = await unlockCalls();
    if (!root) return;
    const id = newCallId();
    const plain: CallPlain = { v: 1, category: cat, key: pick, dir, ...(note.trim() ? { note: note.trim().slice(0, 280) } : {}) };
    const ct = await sealCall(await callKey(root, id), plain);
    await send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.calls, abi: abis.SealedCalls, functionName: "seal", args: [id, BigInt(h * 3600), ct] }));
    setNote("");
  };

  return (
    <Card className="p-6">
      <h2 className="text-2xl font-semibold">Make a call</h2>
      <div className="mt-5 space-y-4 text-sm">
        <Seg value={cat} onChange={(v) => setCat(v as CategoryKey)} options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
        <select value={pick} onChange={(e) => setKey(e.target.value)} className="h-11 w-full rounded-lg border border-foreground/10 bg-field px-3 outline-none focus:border-foreground">
          {ents.map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}
        </select>
        <Seg value={dir} onChange={(v) => setDir(v as "up" | "down")} options={[{ value: "up", label: "Heats up" }, { value: "down", label: "Cools down" }]} />
        <Seg value={String(h)} onChange={(v) => setH(Number(v))} options={HORIZONS.map((x) => ({ value: String(x.h), label: x.label }))} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Why (optional, sealed too)"
          className="h-11 w-full rounded-lg border border-foreground/10 bg-field px-3 outline-none focus:border-foreground" />
        {account ? (
          <Button className="w-full" size="lg" disabled={pending || !pick} onClick={seal}>Seal call</Button>
        ) : (
          <Button className="w-full" size="lg" onClick={connect}>Sign in</Button>
        )}
        <p className="text-xs leading-relaxed text-foreground/50">
          Scored by the share price at the end of the window, so funding decides it. Nobody can read a sealed call, including us.
        </p>
      </div>
    </Card>
  );
}

function MyCalls({ rows }: { rows: CallRow[] }) {
  const { account, send, pending, unlockCalls, callsUnlocked } = useWallet();
  const [plain, setPlain] = useState<Record<string, CallPlain | null>>({});
  const sealedIds = rows.filter((r) => !r.revealed).map((r) => r.id).join(",");

  // once unlocked, re-derive each call's key and decrypt locally (works on a fresh device: nothing is stored)
  useEffect(() => {
    if (!callsUnlocked || !sealedIds) return;
    let live = true;
    (async () => {
      const root = await unlockCalls();
      if (!root) return;
      const out: Record<string, CallPlain | null> = {};
      for (const r of rows.filter((x) => !x.revealed)) out[r.id] = await openCall(await callKey(root, r.id), r.ciphertext);
      if (live) setPlain(out);
    })();
    return () => { live = false; };
  }, [callsUnlocked, sealedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = async (r: CallRow) => {
    const root = await unlockCalls();
    if (!root) return;
    const k = bytesToHex(await callKey(root, r.id));
    await send((w, a) => w.writeContract({ account: a, chain: w.chain, address: addr.calls, abi: abis.SealedCalls, functionName: "reveal", args: [r.id, k] }));
  };

  if (!account) return <Card className="grid place-items-center p-10 text-sm text-foreground/60">Sign in to see your calls.</Card>;
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Your calls</h2>
        {!callsUnlocked && rows.some((r) => !r.revealed) && <Button variant="outline" size="sm" onClick={() => unlockCalls()}>Unlock with passkey</Button>}
      </div>
      <ul className="mt-4 divide-y rounded-xl border text-sm">
        {rows.length === 0 && <li className="px-5 py-6 text-foreground/60">No calls yet.</li>}
        {rows.map((r) => {
          const p = r.revealed ? (r.opened ? { category: r.category!, key: r.entityKey!, dir: r.direction as "up" | "down", note: r.note ?? undefined } : null) : plain[r.id];
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="font-medium">{p ? <CallText p={p} /> : r.revealed ? "Revealed, but the key didn't open it" : "Sealed"}</div>
                <div className="text-xs text-foreground/50">sealed {when(r.sealedAt)} · scored {when(r.horizonEnd)}{p?.note ? ` · “${p.note}”` : ""}</div>
              </div>
              {r.revealed ? <span className="text-xs text-foreground/60">public</span>
                : <Button size="sm" variant="outline" disabled={pending} onClick={() => reveal(r)}>Reveal</Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CallText({ p }: { p: { category: string; key: string; dir: "up" | "down" } }) {
  const { snap } = useSnapshot();
  const name = snap?.categories[p.category]?.entities.find((e) => e.key === p.key)?.name ?? p.key;
  return <>{name} {p.dir === "up" ? "heats up" : "cools down"}</>;
}

type Outcome = "right" | "wrong" | "pending";

/** Revealed calls, scored by the share price at seal time vs at the end of the window (Envio price history). */
function Receipts({ rows }: { rows: CallRow[] }) {
  const { snap } = useSnapshot();
  const [scores, setScores] = useState<Record<string, { outcome: Outcome; change: number }>>({});
  const ids = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (!snap || !rows.length) return;
    let live = true;
    (async () => {
      const out: typeof scores = {};
      for (const r of rows) {
        const e = snap.categories[r.category ?? ""]?.entities.find((x) => x.key === r.entityKey);
        if (!e || e.index === null) continue;
        const id = listingId(addr.market(r.category as CategoryKey), e.index);
        const end = Math.min(r.horizonEnd, Math.floor(Date.now() / 1000));
        const q = `query($id: String!, $a: Int!, $b: Int!) {
          a: PricePoint(where: {listing_id: {_eq: $id}, timestamp: {_lte: $a}}, order_by: [{timestamp: desc}, {id: desc}], limit: 1) { price }
          b: PricePoint(where: {listing_id: {_eq: $id}, timestamp: {_lte: $b}}, order_by: [{timestamp: desc}, {id: desc}], limit: 1) { price } }`;
        const d = await gql<{ a: { price: string }[]; b: { price: string }[] }>(q, { id, a: r.sealedAt, b: end });
        if (!d?.a[0] || !d.b[0]) continue;
        const change = Number(d.b[0].price) / Number(d.a[0].price) - 1;
        const done = Date.now() / 1000 >= r.horizonEnd;
        out[r.id] = { change, outcome: !done ? "pending" : (r.direction === "up" ? change > 0 : change < 0) ? "right" : "wrong" };
      }
      if (live) setScores(out);
    })();
    return () => { live = false; };
  }, [ids, snap]); // eslint-disable-line react-hooks/exhaustive-deps

  const board = useMemo(() => {
    const m = new Map<string, { right: number; total: number }>();
    for (const r of rows) {
      const s = scores[r.id];
      if (!s || s.outcome === "pending") continue;
      const v = m.get(r.caller) ?? { right: 0, total: 0 };
      m.set(r.caller, { right: v.right + (s.outcome === "right" ? 1 : 0), total: v.total + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].right - a[1].right || a[1].total - b[1].total).slice(0, 10);
  }, [rows, scores]);

  return (
    <div className="mt-14 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
      <section>
        <h2 className="text-2xl font-semibold">Revealed calls</h2>
        <ul className="mt-4 divide-y rounded-xl border text-sm">
          {rows.length === 0 && <li className="px-5 py-6 text-foreground/60">Nothing revealed yet.</li>}
          {rows.map((r) => {
            const s = scores[r.id];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="font-medium"><CallText p={{ category: r.category!, key: r.entityKey!, dir: r.direction as "up" | "down" }} /></div>
                  <div className="text-xs text-foreground/50">
                    <span className="font-mono">{r.caller.slice(0, 6)}…{r.caller.slice(-4)}</span> · sealed {when(r.sealedAt)}{r.note ? ` · “${r.note}”` : ""}
                  </div>
                </div>
                {s && (
                  <span className={cn("rounded-md px-2 py-1 text-xs font-medium", s.outcome === "right" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : s.outcome === "wrong" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-foreground/5 text-foreground/60")}>
                    {s.outcome === "pending" ? "open" : s.outcome} · {(s.change * 100).toFixed(1)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">Receipts</h2>
        <ol className="mt-4 divide-y rounded-xl border text-sm">
          {board.length === 0 && <li className="px-5 py-6 text-foreground/60">Scores appear when revealed calls reach the end of their window.</li>}
          {board.map(([who, v], i) => (
            <li key={who} className="flex items-center justify-between px-5 py-3">
              <span className="flex items-center gap-3"><span className="w-5 text-foreground/40">{i + 1}</span><span className="font-mono text-xs">{who.slice(0, 6)}…{who.slice(-4)}</span></span>
              <span className="tabular-nums">{v.right}/{v.total} right</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid rounded-lg border border-foreground/10 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("h-9 rounded-md px-2 text-sm transition-colors", value === o.value ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
