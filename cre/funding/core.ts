// Pure helpers shared by the workflow and its tests (no CRE runtime imports).
import { encodeAbiParameters, type Hex } from 'viem'

export type Targets = {
  asOfUnix: number
  inputsHash: Hex
  latestBatch: { ts: string; md5: string }
  categories: { key: string; targets: bigint[] }[]
}
export type LastUpdate = { ts: string; md5: string }

const WAD = 10n ** 18n

export function parseTargets(body: string): Targets {
  const d = JSON.parse(body)
  const t: Targets = {
    asOfUnix: Number(d.as_of_unix),
    inputsHash: (d.inputs_hash.startsWith('0x') ? d.inputs_hash : `0x${d.inputs_hash}`) as Hex,
    latestBatch: { ts: String(d.latest_batch.ts), md5: String(d.latest_batch.md5).toLowerCase() },
    categories: d.categories.map((c: { key: string; targets: string[] }) => ({ key: c.key, targets: c.targets.map(BigInt) })),
  }
  if (!/^0x[0-9a-f]{64}$/.test(t.inputsHash)) throw new Error('bad inputs_hash')
  for (const c of t.categories) {
    const s = c.targets.reduce((a, b) => a + b, 0n)
    if (s !== WAD) throw new Error(`${c.key}: targets sum to ${s}, not 1e18`)
  }
  return t
}

/** GDELT lastupdate.txt: "<size> <md5> http://data.gdeltproject.org/gdeltv2/<ts>.gkg.csv.zip" per line. */
export function parseLastUpdate(body: string): LastUpdate {
  for (const line of body.trim().split('\n')) {
    const [, md5, url] = line.trim().split(/\s+/)
    const m = url?.match(/(\d{14})\.gkg\.csv\.zip$/)
    if (m) return { ts: m[1], md5: md5.toLowerCase() }
  }
  throw new Error('no GKG line in lastupdate.txt')
}

const tsToUnix = (ts: string) =>
  Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14)) / 1000

/** Same file → fingerprints must match. Older file → must be within maxLag of GDELT's newest. */
export function checkGdelt(t: Targets, g: LastUpdate, maxLagMinutes: number): { ok: boolean; why: string } {
  if (t.latestBatch.ts === g.ts) return t.latestBatch.md5 === g.md5 ? { ok: true, why: 'fingerprint match' } : { ok: false, why: 'md5 mismatch' }
  const lag = (tsToUnix(g.ts) - tsToUnix(t.latestBatch.ts)) / 60
  if (lag < 0) return { ok: false, why: 'indexer claims a file GDELT has not published' }
  return lag <= maxLagMinutes ? { ok: true, why: `${lag} min behind GDELT` } : { ok: false, why: `stale: ${lag} min behind GDELT` }
}

const catId = (key: string): Hex => {
  const b = new TextEncoder().encode(key)
  if (b.length > 32) throw new Error('category key too long')
  return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('').padEnd(64, '0')}` as Hex
}

/** abi.encode(CategoryReport[]) as ZeitgeistReceiver.onReport decodes it. */
export function encodeReport(t: Targets): Hex {
  return encodeAbiParameters(
    [{ type: 'tuple[]', components: [
      { name: 'category', type: 'bytes32' }, { name: 'asOf', type: 'uint64' },
      { name: 'inputsHash', type: 'bytes32' }, { name: 'targets', type: 'uint256[]' }] }],
    [t.categories.map((c) => ({ category: catId(c.key), asOf: BigInt(t.asOfUnix), inputsHash: t.inputsHash, targets: c.targets }))],
  )
}
