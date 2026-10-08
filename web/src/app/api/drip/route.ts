// Gas drip for new passkey accounts: sends a little native MON so the first trade needs no faucet.
// Not custody: it only ever sends, and only to accounts below the threshold.
//   local anvil : uses Anvil's public test account #9 (derived from the standard test mnemonic)
//   testnet     : requires DRIP_PRIVATE_KEY in the server environment; never committed
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { chain } from "@/lib/contracts";

const AMOUNT = parseEther(process.env.DRIP_AMOUNT ?? "0.2");
const THRESHOLD = parseEther("0.05");
const recent = new Map<string, number>(); // address -> last drip (ms); per server instance

function dripAccount() {
  const k = process.env.DRIP_PRIVATE_KEY;
  if (k) return privateKeyToAccount(k as Hex);
  if (chain.id === 31337) return mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 });
  return null;
}

export async function POST(req: Request) {
  const { address } = await req.json().catch(() => ({}));
  if (!isAddress(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  const from = dripAccount();
  if (!from) return NextResponse.json({ error: "drip not configured" }, { status: 503 });
  const last = recent.get(address.toLowerCase()) ?? 0;
  if (Date.now() - last < 6 * 3600_000) return NextResponse.json({ skipped: "recently dripped" });
  const pub = createPublicClient({ chain, transport: http() });
  if ((await pub.getBalance({ address })) >= THRESHOLD) return NextResponse.json({ skipped: "has gas" });
  recent.set(address.toLowerCase(), Date.now());
  const hash = await createWalletClient({ account: from, chain, transport: http() }).sendTransaction({ to: address, value: AMOUNT });
  await pub.waitForTransactionReceipt({ hash });
  return NextResponse.json({ hash });
}
