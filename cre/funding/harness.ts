// Local harness: the workflow's exact fetch -> GDELT check -> encode steps, delivered to the receiver
// by a local key standing in for the KeystoneForwarder. Proves the contract path and gas on anvil.
// This is NOT the CRE engine; the official path is `cre workflow simulate` (see README).
//   bun harness.ts            (anvil defaults: account #0 is the forwarder in local deploys)
import { createPublicClient, createWalletClient, decodeEventLog, encodePacked, http, parseAbi, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { checkGdelt, encodeReport, parseLastUpdate, parseTargets } from './core'

const cfg = JSON.parse(await Bun.file(new URL('./config.local.json', import.meta.url)).text())
const rpc = process.env.RPC ?? 'http://127.0.0.1:8545'
const account = mnemonicToAccount('test test test test test test test test test test test junk')

const t = parseTargets(await (await fetch(cfg.targetsUrl)).text())
const g = parseLastUpdate(await (await fetch(cfg.gdeltLastUpdateUrl)).text())
const check = checkGdelt(t, g, cfg.maxLagMinutes)
console.log(`indexer as_of ${t.latestBatch.ts}, GDELT newest ${g.ts}: ${check.why}`)
if (!check.ok) process.exit(1)

const abi = parseAbi([
  'function onReport(bytes metadata, bytes report)',
  'event ReportApplied(bytes32 indexed workflowId, uint256 categories, uint256 funded)',
  'event StepSkipped(bytes32 indexed category, bytes4 step, bytes reason)',
])
const metadata = encodePacked(['bytes32', 'bytes10', 'address'], [`0x${'11'.repeat(32)}`, '0x7a656974676569737400', account.address])
const pub = createPublicClient({ chain: foundry, transport: http(rpc) })
const wallet = createWalletClient({ chain: foundry, transport: http(rpc), account })
const hash = await wallet.writeContract({ address: cfg.receiver, abi, functionName: 'onReport', args: [metadata, encodeReport(t) as Hex], gas: BigInt(cfg.gasLimit) })
const rc = await pub.waitForTransactionReceipt({ hash })
console.log(`onReport ${rc.status} gas=${rc.gasUsed} tx=${hash}`)
for (const log of rc.logs) {
  try {
    const ev = decodeEventLog({ abi, data: log.data, topics: log.topics })
    console.log(' ', ev.eventName, JSON.stringify(ev.args, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
  } catch {}
}
