# CRE simulation with broadcast — anvil fork of Monad testnet (2026-10-08)

Official engine: `cre workflow simulate funding -T fork --broadcast` (CRE CLI v1.38.0, logged in).
Fork of Monad testnet (chain 10143) at block ~69,369,704, so Chainlink's live MockKeystoneForwarder
`0xB9F79d863261869B234c481D1f9A7af84AeAd192` delivered the report. No MON spent.

```
[USER LOG] report asOf=1791497700 fresh=true due=[geopolitics,tech_companies,tech_personalities] -> sent 0x904a9dd2…98ea48
✓ Workflow Simulation Result: {"sent":true,"asOf":1791497700,"fresh":true,"due":["geopolitics","tech_companies","tech_personalities"],"tx":"0x904a9dd2a33c25812f77bae577c32bf209ea6d2959f2ea88873b8d876698ea48"}
```

Receipt logs (forwarder never reverts, so the receiver's events are the proof):

| emitter | event |
|---|---|
| AttentionOracle | `TargetsPosted` ×3 (geopolitics, tech_companies, tech_personalities) |
| CategoryMarket ×3 | `Funded` (one per category) |
| ZeitgeistReceiver | `StepSkipped` ×1 (Minter.updatePeriod: `TooEarly`, expected) |
| ZeitgeistReceiver | `ReportApplied(categories=3, funded=3)` |
| KeystoneForwarder | `ReportProcessed` |

Oracle after the report: `latest(geopolitics).asOf = 1791497700`, `inputsHash = 0xa1723ee410e8f0c6f6a9175313cbe46c865277b91ef8994641cff6e6ed86b758`.
A dry run (`-T local`, no broadcast) earlier passed the GDELT fingerprint check and found all three epochs due.
