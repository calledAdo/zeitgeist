# Zeitgeist

**A market for attention, on Monad.** Buy shares in the people and companies the world is talking about.
Every 8 hours, money moves from names running cooler than their own normal to names running hotter —
measured from global news, delivered on-chain by Chainlink, zero-sum.

Built for **Monad Metropolis** · Track: **Social, Attention & Culture**.

## How it works

1. **Pick a name.** Three categories: Geopolitics (13 leaders), Tech Companies (14), Tech Personalities (7).
   Each name has its own bonding curve (reserve = c·supply², price = 2·reserve/supply). Buy or sell any time;
   0.5% fee each way.
2. **Attention is measured every 15 minutes.** The indexer reads every GDELT GKG file (the world's news, in
   100+ languages), counts unique headlines per name (syndicated copies once, press-release wires excluded),
   and turns that into a share of all news, smoothed with a 12-hour half-life.
3. **Heat is relative to each name's own character.** Each name's normal level and usual swings come from its
   previous 28 days. Heat = how many usual swings above or below normal it is now (capped at ±3). Trump on a
   normal day is 0; a minister having a huge week can be +3. In backtests Trump went from winning 21 of 21 days
   on raw share to 3 of 21.
4. **Targets → funding.** Each category's pool is split by softmax(0.35·heat), averaged over 8 hours. Every 8
   hours each name's reserve moves 15% of the way to its target (capped at ±8%, exactly zero-sum). Supply is
   untouched, so the share price moves by the same percentage. Gaps close with a ~34h half-life.
5. **ve(3,3).** ZEIT is emitted weekly (1.5M, −1%/week). Lock it as veZEIT (up to 52 weeks) to vote on which
   category gets next week's emissions; voters earn 70% of that category's trading fees plus bribes. Holders
   stake shares in gauges to earn ZEIT.
6. **Sealed calls.** Say who heats up before it happens: the call is encrypted under a key only your passkey
   can re-create, sealed on Monad with a timestamp, and opened when you choose. Revealed calls are scored
   against the price history.

## Architecture

```
GDELT GKG (15 min) ──► indexer (Python) ──► snapshot.json · targets.json · explain.json
                                              │
                         Chainlink CRE workflow (cron, HTTP + consensus, GDELT md5 check)
                                              │  signed report
                                              ▼
Monad:  KeystoneForwarder → ZeitgeistReceiver → AttentionOracle → CategoryMarket ×3 (funding, fees)
        Zeit · VotingEscrow · CategoryVoter · Minter · EntityGauge ×3 · SealedCalls
                                              │  events
                                              ▼
                                   Envio HyperIndex (GraphQL)
                                              │
                Next.js app (Mera passkey accounts) ◄── matched headlines for the biggest movers
```

| Folder | What |
|---|---|
| [`contracts/`](contracts) | Solidity (Foundry). Markets, oracle, ve layer, CRE receiver, sealed calls. 26 tests incl. invariants. |
| [`indexer/`](indexer) | GDELT attention oracle: counting, character, heat, targets, inputs hash; keeper; headline explainer (optional LLM notes). |
| [`cre/`](cre) | Chainlink CRE funding workflow, tests, local harness, simulation evidence. |
| [`envio/`](envio) | Envio HyperIndex: listings, price history, positions/PnL, funding rounds, votes, sealed calls. |
| [`web/`](web) | Next.js app: markets, trade panel, activity, calls, vote, portfolio. |

## Sponsor integrations

| Sponsor | How it's used |
|---|---|
| **Chainlink CRE** | The funding workflow is the orchestration layer: cron → fetch targets + GDELT's published md5 (identical consensus) → read epochs on Monad → signed report → receiver posts targets, funds, collects fees, triggers emissions. Simulated and broadcast through Chainlink's forwarder on a Monad testnet fork ([evidence](cre/evidence/2026-10-08-fork-broadcast.md)). |
| **Envio** | HyperIndex indexes every contract; powers price charts with funding steps, PnL, leaderboard, funding-round history with input fingerprints, and decrypts revealed sealed calls. |
| **Mera** (Monad Foundation) | The entire account layer: one passkey prompt → PRF → account; scoped prompt-free signing session (re-prompt for locks, votes, bribes, or buys past $1,000); identity rebuilt from the passkey on a fresh device. **One Passkey, Many Keys:** a separate PRF namespace derives per-call AES keys for sealed calls. |

## Why Monad

Dozens of independent curves, funding rounds that touch every market at once, per-second gauge streaming,
and cheap ~100-byte sealed calls only make sense with fast, cheap blocks. A full three-category funding
report costs ~710k gas.

## Run it locally

Requirements: Foundry, Node 22+, Bun, uv (Python), Docker (for Envio).

```bash
git clone --recurse-submodules https://github.com/calledAdo/zeitgeist && cd zeitgeist
cd web && npm install && cd ..
bash scripts/local-demo.sh            # anvil + deploy + real GDELT targets + trades + one funding round
cd web && npm run dev                 # http://localhost:3000
```

Then, optionally:

```bash
cd envio && pnpm install && node gen-config.mjs 31337 && pnpm envio dev     # indexer at :8080
cd cre/funding && bun install && bun test && node gen-config.mjs local 31337 http://localhost:3000/targets.json
cre workflow simulate funding -T local -R ..                                 # needs `cre login`
cd indexer && uv run zg explain && cd ../web && npm run sync     # headlines; MOONSHOT_API_KEY adds Kimi notes
```

Indexer commands: `uv run zg ingest --latest`, `zg snapshot`, `zg report`, `zg candidates`, `zg keeper`.

## Built during Metropolis

All code in this repository was written during the hackathon window (Sep 1 – Oct 13, 2026). Third-party
libraries are pinned submodules (solady, forge-std) or package dependencies.

**AI tools disclosure:** this project was built with substantial help from Claude Code (Anthropic), used for
research, design discussion, writing code, tests and documentation, under the author's direction and review.

## Image credits

Portraits come from official government sites, company leadership pages, the person's own verified X
account, or openly licensed press photos (Putin: Kremlin press office, CC BY 4.0; Musk: U.S. Air Force, public
domain; Starmer-era UK portraits: UK Parliament, CC BY 3.0). Company logos come from each company's own site and
are trademarks of their owners, shown only to identify them. Every image's source and credit is listed in
[`web/src/generated/people.json`](web/src/generated/people.json) and [`logos.json`](web/src/generated/logos.json).

## License

MIT — see [LICENSE](LICENSE).
