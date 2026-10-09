# Envio HyperIndex: Zeitgeist's on-chain history

Indexes every Zeitgeist contract on Monad and serves it over GraphQL to the app.

| Entity | Built from | Powers |
|---|---|---|
| `Listing` | `Listed`, `Bought`, `Sold`, `Funded` | live reserve, supply, price (2·R/S), holders, net funding per name |
| `PricePoint` | every reserve/supply change | price chart in the trade panel; funding rounds drawn as dots |
| `Position`, `Trader` | `Bought`, `Sold` | average-cost basis, unrealised and realised PnL on Portfolio; leaderboard |
| `FundingRound` | `Funded` | Activity: each round's reserve moved and the `inputsHash` of the GDELT files behind it |
| `TargetsPost` | `TargetsPosted` | every oracle post (from the reporter key or the Chainlink CRE receiver) |
| `Market` | all market events | pooled reserve, volume, fees accrued and routed to voters/treasury |
| `Vote`, `CategoryEpoch`, `Lock`, `Stake` | ve(3,3) events | weekly category vote share, locks, gauge stakes and rewards |

Reserve accounting mirrors `CategoryMarket` exactly (buy adds `assetIn − fee`; sell removes `assetOut + fee`;
funding adds each signed delta), so indexed prices match `price(i)` on-chain to the unit.

## Run

```bash
pnpm install
node gen-config.mjs 31337          # local anvil (or: node gen-config.mjs 10143 <startBlock> for Monad testnet)
pnpm envio codegen
pnpm envio dev                      # needs Docker; GraphQL at http://localhost:8080/v1/graphql
```

The web app reads `NEXT_PUBLIC_INDEXER_URL` (default `http://localhost:8080/v1/graphql`) and falls back to
chain reads when the indexer is down.
