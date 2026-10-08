// Seal a call on anvil, reveal its key, and confirm the Envio indexer opened it.
import { createPublicClient, createWalletClient, http, parseAbi, bytesToHex, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import dep from "../../contracts/deployments/31337.json";
import { callKey, newCallId, sealCall } from "../src/lib/calls-crypto";

const abi = parseAbi(["function seal(bytes16,uint64,bytes)", "function reveal(bytes16,bytes32)"]);
const account = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 1 });
const pub = createPublicClient({ chain: foundry, transport: http() });
const w = createWalletClient({ chain: foundry, transport: http(), account });
const root = crypto.getRandomValues(new Uint8Array(32));
const id = newCallId();
const key = await callKey(root, id);
const sealed = await sealCall(key, { v: 1, category: "geopolitics", key: "merz", dir: "up", note: "coalition deal this week" });
const tx = async (fn: "seal" | "reveal", args: readonly unknown[]) =>
  (await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: dep.calls as Hex, abi, functionName: fn, args } as never) })).status;
console.log("seal", await tx("seal", [id, 3600n, sealed]));
console.log("reveal", await tx("reveal", [id, bytesToHex(key)]));
await new Promise((r) => setTimeout(r, 4000));
const q = await fetch("http://localhost:8080/v1/graphql", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: `{ Call(where:{id:{_eq:"${id}"}}){ revealed opened category entityKey direction note } }` }) });
console.log(JSON.stringify((await q.json()).data));
