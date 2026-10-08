import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters } from 'viem'
import { checkGdelt, encodeReport, parseLastUpdate, parseTargets } from '../core'

const fixture = await Bun.file(new URL('./targets.fixture.json', import.meta.url)).text()
const LAST = `75747 70e09c408913332267b11499ac2c81c3 http://data.gdeltproject.org/gdeltv2/20261008213000.export.CSV.zip
120992 1dfc28f75048fa6ac3f066b68d5a2a54 http://data.gdeltproject.org/gdeltv2/20261008213000.mentions.CSV.zip
5288113 5e81d6582dbaaa81ec698fc063c7d1ce http://data.gdeltproject.org/gdeltv2/20261008213000.gkg.csv.zip`

describe('targets', () => {
  test('parses the indexer payload and every category sums to 1e18', () => {
    const t = parseTargets(fixture)
    expect(t.categories.map((c) => c.key)).toEqual(['geopolitics', 'tech_companies', 'tech_personalities'])
    expect(t.inputsHash).toMatch(/^0x[0-9a-f]{64}$/)
  })
  test('rejects targets that do not sum to 1e18', () => {
    const d = JSON.parse(fixture)
    d.categories[0].targets[0] = '1'
    expect(() => parseTargets(JSON.stringify(d))).toThrow()
  })
  test('report decodes to the receiver struct', () => {
    const t = parseTargets(fixture)
    const [reps] = decodeAbiParameters(
      [{ type: 'tuple[]', components: [{ name: 'category', type: 'bytes32' }, { name: 'asOf', type: 'uint64' }, { name: 'inputsHash', type: 'bytes32' }, { name: 'targets', type: 'uint256[]' }] }],
      encodeReport(t),
    )
    expect(reps.length).toBe(3)
    expect(reps[0].category.startsWith('0x67656f706f6c6974696373')).toBe(true) // "geopolitics", right-padded
    expect(reps[0].asOf).toBe(BigInt(t.asOfUnix))
    expect(reps[1].targets.length).toBe(14)
  })
  test('encoding is deterministic (identical consensus across nodes)', () => {
    expect(encodeReport(parseTargets(fixture))).toBe(encodeReport(parseTargets(fixture)))
  })
})

describe('GDELT check', () => {
  const t = (ts: string, md5: string) => ({ ...parseTargets(fixture), latestBatch: { ts, md5 } })
  const g = parseLastUpdate(LAST)
  test('reads the GKG line', () => expect(g).toEqual({ ts: '20261008213000', md5: '5e81d6582dbaaa81ec698fc063c7d1ce' }))
  test('same file, same md5: ok', () => expect(checkGdelt(t(g.ts, g.md5), g, 45).ok).toBe(true))
  test('same file, different md5: rejected', () => expect(checkGdelt(t(g.ts, 'deadbeef'), g, 45).ok).toBe(false))
  test('one file behind: ok', () => expect(checkGdelt(t('20261008211500', 'x'), g, 45).ok).toBe(true))
  test('stale: rejected', () => expect(checkGdelt(t('20261008194500', 'x'), g, 45).ok).toBe(false))
  test('a file from the future: rejected', () => expect(checkGdelt(t('20261008220000', 'x'), g, 45).ok).toBe(false))
})
