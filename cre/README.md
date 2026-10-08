# Chainlink CRE: the funding workflow

A Chainlink Runtime Environment workflow delivers Zeitgeist's attention targets to Monad and runs each
funding round. It replaces "one reporter key posts targets" with a DON-signed report.

```
cron (every 15 min)
 ├─ HTTP  targets.json            Zeitgeist indexer output: per-category targets + inputs hash
 ├─ HTTP  GDELT lastupdate.txt    GDELT's own published md5 for its newest GKG file
 │        each node checks the indexer's newest input fingerprint against GDELT's,
 │        then ABI-encodes the report; the DON must agree byte-for-byte (identical consensus)
 ├─ EVM read  oracle.latest().asOf, market epochs     anything new, or a round due?
 └─ writeReport → KeystoneForwarder → ZeitgeistReceiver.onReport
          posts targets → applyFunding (if epoch passed) → collectFees → Minter.updatePeriod (weekly)
```

**What the DON checks, honestly:** it cannot recount GDELT itself. One 15-minute GKG file is ~5 MB and
CRE caps HTTP bodies at 250 KB. It attests that the posted numbers are the indexer's published,
deterministic output, and that the indexer's newest input file is byte-identical to the one GDELT
published (or at most `maxLagMinutes` behind it). Anyone can still recompute the targets from GDELT
with `zg snapshot`; `inputsHash` commits to every file used.

Contract: [`contracts/src/ZeitgeistReceiver.sol`](../contracts/src/ZeitgeistReceiver.sol). It accepts
reports only from the configured forwarder and pins the workflow owner. Each follow-up step is in
try/catch, so "not due yet" never blocks a valid post; skips are emitted as `StepSkipped`.

## Files

| | |
|---|---|
| `funding/workflow.ts` | the workflow (trigger, HTTP + consensus, EVM reads, report, write) |
| `funding/core.ts` | pure parsing, GDELT check and report encoding (unit-tested) |
| `funding/harness.ts` | local harness: the same steps delivered by a local key on anvil (not the CRE engine) |
| `funding/gen-config.mjs` | writes `config.<target>.json` from `contracts/deployments/<chainId>.json` |

## Run

```bash
cd cre/funding && bun install && bun test          # 10 unit tests
node gen-config.mjs local 31337 http://localhost:3000/targets.json
bun harness.ts                                      # anvil end to end (local deploy uses account #0 as forwarder)
```

Official CRE simulation (needs the CRE CLI ≥ 1.30 and `cre login`):

```bash
cre workflow simulate funding -T local -R ..                  # dry run
cre workflow simulate funding -T testnet -R .. --broadcast    # real report on Monad testnet
```

For testnet, deploy with `CRE_FORWARDER` set to Chainlink's Monad testnet (Mock)KeystoneForwarder, then
`node gen-config.mjs testnet 10143 https://<deployed-app>/targets.json`.

Measured on anvil: one report for all three categories (post + funding + fees) uses ~710k gas.
