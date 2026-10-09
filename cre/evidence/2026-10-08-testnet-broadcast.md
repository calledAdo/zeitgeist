# CRE simulation with broadcast — live Monad testnet (2026-10-08)

`cre workflow simulate funding -T testnet --broadcast` (CRE CLI v1.38.0, logged in). Report delivered by
Chainlink's MockKeystoneForwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192` to
ZeitgeistReceiver `0xc29BA4Aa390458e8aCf45345a8e7839d7FCDf444` on Monad testnet (chain 10143).

| tx | result |
|---|---|
| `0x7a5979003a0be8c38204cd563637248b94250965503218f7f70e4267647e4f75` | first attempt: gas limit 1.2M too low for the first-ever post (fresh storage); the forwarder doesn't revert, receiver applied nothing. Gas limit raised to 2M. |
| `0xa9f61947b62268040932cd60149736ff24cf1d7304ad4c10b64e911ec404804a` | targets posted for all three categories |

Oracle after the report (`AttentionOracle 0xa7C20382968C1dbC81B1Bf3A00691868941F0b01`):

```
latest(geopolitics|tech_companies|tech_personalities) = (asOf 1791499500, postedAt 1791499385,
  inputsHash 0x09e1760c4112d0d3d191007f572d464d8f350b5f0f7119410b25a6fbfafe692…)
```

Log: `report asOf=1791499500 fresh=true postDue=true due=[] -> sent 0xa9f6…804a`. No funding round was due yet
(epochs are 8h; the first boundary after deploy is 00:00 UTC).

Also changed after this run: the workflow now sends only when a round is due or the last post is older than
`minPostIntervalMinutes` (480), since every report costs gas on Monad (billed on the gas limit).

## First funding round on testnet, run by the GitHub Actions keeper (2026-10-09 00:00 UTC)

GitHub Actions run https://github.com/calledAdo/zeitgeist/actions/runs/37862484310 (harness path: same
decision logic and report, delivered through Chainlink's MockKeystoneForwarder; no CRE API key yet).

```
[HARNESS] indexer 20261009000000 vs GDELT 20261009000000: fingerprint match
[HARNESS] report asOf=1791504000 postDue=false due=[geopolitics,tech_companies,tech_personalities]
          tx 0x0762a077a41d59d5a1f74b93a1b94eb41528e7d8b7f27236278508c2f032cdac status=success applied=true
```

Receipt: `TargetsPosted` ×3, `Funded` ×3, `ReportApplied` ×1, `StepSkipped` ×1 (weekly emission not due).
All three markets: `lastFundedEpoch = 62205`. Tech personalities prices after the round (USD, 6dp):
Zuckerberg 1000621 · Musk 1079999 (+8%, capped) · Amodei 947926 · Altman 954974 · Gates 936477 ·
Cook 1000000 (below the 20 stories/day gate: no target) · Huang 1080000 (+8%, capped).
