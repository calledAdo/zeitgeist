"use client";
// Account layer: Mera passkey accounts only. No extension, no seed phrase, no custody backend.
//
// Session design
//   prompt-free : buys, sells, approvals, staking, claims, test-USD mints, up to SESSION_CAP of buys
//   re-prompt   : veZEIT locks, votes, bribes (marked `sensitive`), or buys past the cap (resets it)
//   expiry      : the signing session is zeroed after SESSION_IDLE_MS without activity, or on sign-out
// Stateless: only an optional credential hint lives in localStorage. Clearing it (or a fresh device)
// still recovers the same account from the passkey via the discoverable-credential prompt.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hash, type LocalAccount, type WalletClient } from "viem";
import { chain } from "./contracts";
import { confirmWithPasskey, createAccount, meraMessage, signIn, type MeraSession } from "./mera";
import { unlockCallsRoot } from "./calls-crypto";

export const publicClient = createPublicClient({ chain, transport: http() });

export const SESSION_CAP = 1_000_000_000n; // $1,000 of buys (6dp) before the passkey is asked again
export const SESSION_IDLE_MS = 30 * 60_000;
const HINT = "zeitgeist.passkey";

type SendOpts = { sensitive?: boolean; usd?: bigint };

type Ctx = {
  account: Address | null;
  /** opens the passkey sheet (create or sign in) */
  connect: () => void;
  signOut: () => void;
  wallet: WalletClient | null;
  /** sign with the session, wait for the receipt, bump `tick` so views refetch */
  send: (fn: (w: WalletClient, a: LocalAccount) => Promise<Hash>, opts?: SendOpts) => Promise<void>;
  tick: number;
  refresh: () => void;
  pending: boolean;
  error: string | null;
  clearError: () => void;
  session: { spent: bigint; cap: bigint; expiresAt: number } | null;
  /** root of the sealed-call keys: one passkey prompt per session, held in memory only */
  unlockCalls: () => Promise<Uint8Array | null>;
  callsUnlocked: boolean;
};

const WalletCtx = createContext<Ctx | null>(null);

const readHint = () => {
  try { return JSON.parse(localStorage.getItem(HINT) ?? "null"); } catch { return null; }
};
const writeHint = (v: unknown) => {
  try { localStorage.setItem(HINT, JSON.stringify(v)); } catch { /* storage blocked: fine, the passkey is enough */ }
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [mera, setMera] = useState<MeraSession | null>(null);
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [spent, setSpent] = useState(0n);
  const [expiresAt, setExpiresAt] = useState(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callsRoot = useRef<Uint8Array | null>(null);
  const [callsUnlocked, setCallsUnlocked] = useState(false);

  const signOut = useCallback(() => {
    setMera((m) => { m?.end(); return null; });
    callsRoot.current?.fill(0);
    callsRoot.current = null;
    setCallsUnlocked(false);
    setWallet(null);
    setSpent(0n);
  }, []);

  const touch = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    setExpiresAt(Date.now() + SESSION_IDLE_MS);
    idle.current = setTimeout(signOut, SESSION_IDLE_MS);
  }, [signOut]);

  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);

  const start = useCallback(async (s: MeraSession) => {
    setMera(s);
    setWallet(createWalletClient({ account: s.account, chain, transport: http() }));
    setSpent(0n);
    writeHint(s.credential);
    touch();
    setSheet(false);
    // first visit: top up gas so the first trade needs no faucet detour
    const bal = await publicClient.getBalance({ address: s.account.address }).catch(() => 0n);
    if (bal < parseEther("0.05")) {
      await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: s.account.address }) }).catch(() => undefined);
      setTick((t) => t + 1);
    }
  }, [touch]);

  const begin = useCallback(async (mode: "create" | "signin") => {
    setError(null);
    try {
      await start(mode === "create" ? await createAccount() : await signIn(readHint() ?? undefined));
    } catch (e) {
      setError(meraMessage(e));
    }
  }, [start]);

  const send = useCallback<Ctx["send"]>(async (fn, opts = {}) => {
    if (!wallet || !mera) { setSheet(true); return; }
    setPending(true);
    setError(null);
    try {
      const over = opts.usd !== undefined && spent + opts.usd > SESSION_CAP;
      if (opts.sensitive || over) {
        if (!(await confirmWithPasskey(mera))) throw new Error("That passkey belongs to a different account.");
        if (over) setSpent(0n);
      }
      const hash = await fn(wallet, mera.account);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The transaction reverted.");
      if (opts.usd) setSpent((s) => (over ? 0n : s) + opts.usd!);
      touch();
      setTick((t) => t + 1);
    } catch (e) {
      const m = (e as { shortMessage?: string }).shortMessage ?? meraMessage(e);
      setError(m.replace(/\n.*/s, ""));
    } finally {
      setPending(false);
    }
  }, [wallet, mera, spent, touch]);

  const unlockCalls = useCallback(async () => {
    if (callsRoot.current) return callsRoot.current;
    if (!mera) { setSheet(true); return null; }
    try {
      callsRoot.current = await unlockCallsRoot(mera.credential);
      setCallsUnlocked(true);
      touch();
      return callsRoot.current;
    } catch (e) {
      setError(meraMessage(e));
      return null;
    }
  }, [mera, touch]);

  const value: Ctx = {
    account: mera?.account.address ?? null,
    connect: () => setSheet(true),
    signOut,
    wallet,
    send,
    tick,
    refresh: () => setTick((t) => t + 1),
    pending,
    error,
    clearError: () => setError(null),
    session: mera ? { spent, cap: SESSION_CAP, expiresAt } : null,
    unlockCalls,
    callsUnlocked,
  };
  return (
    <WalletCtx.Provider value={value}>
      {children}
      {sheet && <PasskeySheet onClose={() => setSheet(false)} onCreate={() => begin("create")} onSignIn={() => begin("signin")} error={error} />}
    </WalletCtx.Provider>
  );
}

function PasskeySheet({ onClose, onCreate, onSignIn, error }: { onClose: () => void; onCreate: () => void; onSignIn: () => void; error: string | null }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/20 px-4" onClick={onClose}>
      <div role="dialog" aria-label="Sign in with a passkey" className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Your account is a passkey</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/60">
          Face ID, Touch ID or your phone. No seed phrase, no extension. The same passkey opens the same account on any device.
        </p>
        <div className="mt-6 grid gap-2">
          <button className="h-11 rounded-lg bg-foreground text-sm font-medium text-background" onClick={onSignIn}>Sign in with passkey</button>
          <button className="h-11 rounded-lg border text-sm font-medium" onClick={onCreate}>Create a new account</button>
        </div>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export function useWallet() {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}
