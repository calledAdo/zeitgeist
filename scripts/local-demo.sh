#!/usr/bin/env bash
# Local end-to-end demo: fresh Anvil chain, full deploy, real GDELT targets, some trading, one funding round.
# Uses Anvil's well-known test accounts only. Never point this at a real network.
set -euo pipefail
export PATH="$PATH:$HOME/.foundry/bin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=http://127.0.0.1:8545
MNEMONIC="test test test test test test test test test test test junk"
K0=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 0)
K1=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)
A1=$(cast wallet address "$K1")
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935

pkill anvil 2>/dev/null || true; sleep 1
(anvil --silent --port 8545 --gas-limit 300000000 --block-time 1 >/tmp/anvil.log 2>&1 &); sleep 2

cd "$ROOT/contracts"
PRIVATE_KEY=$K0 EPOCH_SECONDS=${EPOCH_SECONDS:-600} forge script script/Deploy.s.sol --rpc-url $RPC --broadcast >/tmp/deploy.log 2>&1
dep() { python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/31337.json'))['$1'])"; }
echo "deployed: $(dep geopolitics) (geopolitics)"

cd "$ROOT/indexer"
uv run zg ingest --latest --workers 8 >/dev/null
uv run zg snapshot >/dev/null
PRIVATE_KEY=$K0 uv run zg post --rpc $RPC

# a trader buys a few names in each category
USD=$(dep usd)
cast send "$USD" "mint(address,uint256)" "$A1" 20000000000 --private-key "$K1" --rpc-url $RPC >/dev/null
for cat in geopolitics tech_companies tech_personalities; do
  M=$(dep $cat)
  cast send "$USD" "approve(address,uint256)" "$M" $MAX --private-key "$K1" --rpc-url $RPC >/dev/null
  for i in 0 1 2; do cast send "$M" "buy(uint256,uint256,uint256,address)" $i $((200 + i * 150))000000 0 "$A1" --private-key "$K1" --rpc-url $RPC >/dev/null; done
done
echo "trader $A1 bought 3 names per category"

# jump past the epoch boundary and run funding everywhere
cast rpc evm_increaseTime "${EPOCH_SECONDS:-600}" --rpc-url $RPC >/dev/null; cast rpc evm_mine --rpc-url $RPC >/dev/null
PRIVATE_KEY=$K0 uv run python -c "
from zeitgeist_indexer import chain
d = chain.load_deployment('$ROOT/contracts/deployments/31337.json')
for c in ('geopolitics', 'tech_companies', 'tech_personalities'):
    print(c, 'funded' if chain.try_fund('$RPC', d, c) else 'not due')"
cd "$ROOT/web" && npm run sync --silent
echo "done. To trade in the browser, import Anvil test account #1 ($A1) from the standard test mnemonic into your wallet and add network http://127.0.0.1:8545 (chain 31337)."
