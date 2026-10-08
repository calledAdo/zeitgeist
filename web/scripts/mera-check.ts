// Checks the Mera account path without a passkey: a fixed 32-byte PRF output stands in for the ceremony.
// Same bytes -> same address (stateless test), and the session-backed viem account can sign real txs.
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import dep from "../../contracts/deployments/31337.json";

const derive = (prf: Uint8Array) => {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(prf, wordlist))).derive("m/44'/60'/0'/0/0").privateKey!;
  const s = createSecp256k1SigningSession({ privateKey: key });
  return { account: toViemAccount(s), s };
};
const prf = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 255);
const a = derive(prf.slice()), b = derive(prf.slice());
console.log("deterministic:", a.account.address === b.account.address, a.account.address);
// the exported mnemonic imports into any wallet at the standard path
console.log("matches standard wallet import:", mnemonicToAccount(entropyToMnemonic(prf, wordlist)).address === a.account.address);

const pub = createPublicClient({ chain: foundry, transport: http() });
const funder = createWalletClient({ chain: foundry, transport: http(), account: mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 }) });
await pub.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: a.account.address, value: parseEther("0.2") }) });
const w = createWalletClient({ chain: foundry, transport: http(), account: a.account });
const usd = dep.usd as `0x${string}`, m = dep.geopolitics as `0x${string}`;
const abi = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function buy(uint256,uint256,uint256,address) returns (uint256)"]);
for (const [address, functionName, args] of [[usd, "mint", [a.account.address, 1_000_000_000n]], [usd, "approve", [m, 2n ** 255n]], [m, "buy", [1n, 100_000_000n, 0n, a.account.address]]] as const) {
  const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args } as never) });
  console.log(functionName, r.status);
}
a.s.end();
try { await w.sendTransaction({ to: a.account.address, value: 0n }); console.log("ended session still signs: BAD"); }
catch (e) { console.log("ended session refuses to sign:", (e as Error).message.split("\n")[0].slice(0, 60)); }
