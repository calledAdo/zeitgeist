// Zeitgeist funding workflow (Chainlink CRE, TypeScript SDK).
//
//  cron (every 15 min; funding itself is gated on-chain to once per epoch)
//   -> HTTP (node mode)  targets.json from the Zeitgeist indexer: per-category targets + inputs hash
//   -> HTTP (node mode)  GDELT's own lastupdate.txt: the newest GKG file's published md5
//        every node checks the indexer's newest batch fingerprint against GDELT's, then encodes the report;
//        the DON must agree byte-for-byte (identical consensus) on what gets signed
//   -> EVM read          oracle.latest(category).asOf and market epochs: is anything new or due?
//   -> runtime.report -> evm.writeReport -> KeystoneForwarder -> ZeitgeistReceiver.onReport
//        which posts the targets, applies funding where an epoch has passed, collects fees,
//        and triggers the weekly ZEIT emission.
//
// The DON cannot recount GDELT itself (one 15-min GKG file is several MB; CRE caps HTTP bodies at
// 250 KB). It attests that the posted numbers are the indexer's published, deterministic output and
// that the indexer's newest input file is byte-identical to the one GDELT published.
import {
  bytesToHex,
  ConsensusAggregationByFields,
  CronCapability,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  handler,
  HTTPClient,
  type HTTPSendRequester,
  hexToBase64,
  identical,
  median,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, type Hex, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { checkGdelt, encodeReport, parseLastUpdate, parseTargets } from './core'

export const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  targetsUrl: z.string(),
  gdeltLastUpdateUrl: z.string(),
  receiver: z.string(),
  oracle: z.string(),
  markets: z.record(z.string(), z.string()), // category key -> market address
  maxLagMinutes: z.number(),
  gasLimit: z.string(),
})
export type Config = z.infer<typeof configSchema>

const ORACLE_ABI = [{
  type: 'function', name: 'latest', stateMutability: 'view',
  inputs: [{ name: 'category', type: 'bytes32' }],
  outputs: [{ type: 'tuple', components: [
    { name: 'asOf', type: 'uint64' }, { name: 'postedAt', type: 'uint64' },
    { name: 'inputsHash', type: 'bytes32' }, { name: 'targets', type: 'uint256[]' }] }],
}] as const
const MARKET_ABI = [
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastFundedEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

type Observed = { asOf: number; gdeltOk: number; report: string; categoryIds: string }

/** Runs on every node: fetch both sources, verify, encode. Identical consensus on the encoded report. */
const observe = (send: HTTPSendRequester, cfg: Config): Observed => {
  const get = (url: string) => {
    const r = send.sendRequest({ url, method: 'GET' as const }).result()
    if (r.statusCode !== 200) throw new Error(`${url} -> HTTP ${r.statusCode}`)
    return new TextDecoder().decode(r.body)
  }
  const t = parseTargets(get(cfg.targetsUrl))
  const g = parseLastUpdate(get(cfg.gdeltLastUpdateUrl))
  const check = checkGdelt(t, g, cfg.maxLagMinutes)
  return {
    asOf: t.asOfUnix,
    gdeltOk: check.ok ? 1 : 0,
    report: check.ok ? encodeReport(t) : `0x`,
    categoryIds: t.categories.map((c) => c.key).join(','),
  }
}

export const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config
  const net = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName })
  if (!net) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
  const evm = new EVMClient(net.chainSelector.selector)

  const obs = new HTTPClient().sendRequest(
    runtime,
    observe,
    ConsensusAggregationByFields<Observed>({ asOf: median, gdeltOk: median, report: identical, categoryIds: identical }),
  )(cfg).result()

  if (!obs.gdeltOk) {
    runtime.log(`indexer snapshot ${obs.asOf} failed the GDELT check (stale or fingerprint mismatch): nothing sent`)
    return JSON.stringify({ sent: false, reason: 'gdelt-check', asOf: obs.asOf })
  }

  const read = (to: string, data: Hex): Hex =>
    bytesToHex(evm.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }) }).result().data)

  // anything new to post, or any epoch due?
  const keys = obs.categoryIds.split(',')
  const first = keys[0]
  const latest = decodeFunctionResult({ abi: ORACLE_ABI, functionName: 'latest',
    data: read(cfg.oracle, encodeFunctionData({ abi: ORACLE_ABI, functionName: 'latest', args: [categoryId(first)] })) })
  const fresh = obs.asOf > Number(latest.asOf)
  const due = keys.filter((k) => {
    const m = cfg.markets[k]
    if (!m) return false
    const epoch = (fn: 'currentEpoch' | 'lastFundedEpoch') =>
      decodeFunctionResult({ abi: MARKET_ABI, functionName: fn, data: read(m, encodeFunctionData({ abi: MARKET_ABI, functionName: fn })) })
    return epoch('currentEpoch') > epoch('lastFundedEpoch')
  })
  if (!fresh && due.length === 0) {
    runtime.log(`snapshot ${obs.asOf} already posted and no epoch due`)
    return JSON.stringify({ sent: false, reason: 'nothing-due', asOf: obs.asOf })
  }

  const report = runtime.report({ encodedPayload: hexToBase64(obs.report), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' }).result()
  const wr = evm.writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } }).result()
  const ok = wr.txStatus === TxStatus.SUCCESS
  const tx = wr.txHash ? bytesToHex(wr.txHash) : null
  runtime.log(`report asOf=${obs.asOf} fresh=${fresh} due=[${due.join(',')}] -> ${ok ? 'sent' : `failed ${wr.errorMessage ?? ''}`} ${tx ?? ''}`)
  return JSON.stringify({ sent: ok, asOf: obs.asOf, fresh, due, tx })
}

export const categoryId = (key: string): Hex => {
  const b = new TextEncoder().encode(key)
  return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('').padEnd(64, '0')}` as Hex
}

export const initWorkflow = (cfg: Config) => [handler(new CronCapability().trigger({ schedule: cfg.schedule }), onCron)]
