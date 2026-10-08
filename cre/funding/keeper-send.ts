// CI fallback for the funding workflow when the CRE CLI can't authenticate (API keys need CRE Early Access).
// Same steps as workflow.ts: fetch targets + GDELT lastupdate.txt, fingerprint check, read the oracle and
// epochs, decide (round due, or last post older than minPostIntervalMinutes), encode the same report.
// Delivery: Chainlink's MockKeystoneForwarder.report(receiver, header || report, "0x", []) on Monad
// testnet, which is exactly the call `cre workflow simulate --broadcast` makes. This is NOT the CRE engine
// (no DON consensus); runs are labelled HARNESS in the logs.
//   KEEPER_PRIVATE_KEY=0x... bun keeper-send.ts [config.testnet.json]
import { concat, createPublicClient, createWalletClient, http, parseAbi, sha256, stringToBytes, stringToHex, toHex, keccak256, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { checkGdelt, encodeReport, parseLastUpdate, parseTargets } from './core'

const cfg = JSON.parse(await Bun.file(new URL(`./${process.argv[2] ?? 'config.testnet.json'}`, import.meta.url)).text())
const FORWARDER = (process.env.CRE_FORWARDER ?? '0xB9F79d863261869B234c481D1f9A7af84AeAd192') as Address
const rpc = process.env.MONAD_RPC ?? 'https://testnet-rpc.monad.xyz'
const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) })

const t = parseTargets(await (await fetch(cfg.targetsUrl, { cache: 'no-store' })).text())
const g = parseLastUpdate(await (await fetch(cfg.gdeltLastUpdateUrl)).text())
const check = checkGdelt(t, g, cfg.maxLagMinutes)
console.log(`[HARNESS] indexer ${t.latestBatch.ts} vs GDELT ${g.ts}: ${check.why}`)
if (!check.ok) process.exit(0)

const oracleAbi = parseAbi(['function latest(bytes32) view returns ((uint64 asOf, uint64 postedAt, bytes32 inputsHash, uint256[] targets))'])
const marketAbi = parseAbi(['function currentEpoch() view returns (uint256)', 'function lastFundedEpoch() view returns (uint256)'])
const cat0 = stringToHex(t.categories[0].key, { size: 32 })
const latest = await pub.readContract({ address: cfg.oracle, abi: oracleAbi, functionName: 'latest', args: [cat0] })
const now = Math.floor(Date.now() / 1000)
const fresh = t.asOfUnix > Number(latest.asOf)
const postDue = fresh && now - Number(latest.postedAt) >= cfg.minPostIntervalMinutes * 60
const due: string[] = []
for (const c of t.categories) {
  const m = cfg.markets[c.key] as Address | undefined
  if (!m) continue
  const [cur, last] = await Promise.all([
    pub.readContract({ address: m, abi: marketAbi, functionName: 'currentEpoch' }),
    pub.readContract({ address: m, abi: marketAbi, functionName: 'lastFundedEpoch' }),
  ])
  if (cur > last) due.push(c.key)
}
if (due.length === 0 && !postDue) {
  console.log(`[HARNESS] no round due; last post ${Math.round((now - Number(latest.postedAt)) / 60)} min ago: nothing sent`)
  process.exit(0)
}

// the 109-byte metadata header the CRE simulator prepends (version, execution id, ts, don, config, workflow id/name/owner, report id)
const header = concat([
  '0x01', keccak256(stringToBytes(`zeitgeist-harness-${t.asOfUnix}-${now}`)), toHex(now, { size: 4 }), toHex(1, { size: 4 }), toHex(1, { size: 4 }),
  `0x${'11'.repeat(32)}`, stringToHex(sha256(stringToBytes('zeitgeist-funding')).slice(2, 12), { size: 10 }), `0x${'aa'.repeat(20)}`, '0x0001',
])
const key = process.env.KEEPER_PRIVATE_KEY
if (!key) throw new Error('KEEPER_PRIVATE_KEY missing')
const wallet = createWalletClient({ chain: monadTestnet, transport: http(rpc), account: privateKeyToAccount(key as Hex) })
const hash = await wallet.writeContract({
  address: FORWARDER, abi: parseAbi(['function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)']),
  functionName: 'report', args: [cfg.receiver, concat([header, encodeReport(t)]), '0x', []], gas: BigInt(cfg.gasLimit), maxPriorityFeePerGas: 0n,
})
const r = await pub.waitForTransactionReceipt({ hash })
const applied = r.logs.some((l) => l.address.toLowerCase() === cfg.receiver.toLowerCase() && l.topics[0] === keccak256(stringToBytes('ReportApplied(bytes32,uint256,uint256)')))
console.log(`[HARNESS] report asOf=${t.asOfUnix} postDue=${postDue} due=[${due.join(',')}] tx ${hash} status=${r.status} gasUsed=${r.gasUsed} applied=${applied}`)
if (!applied) process.exit(1)
