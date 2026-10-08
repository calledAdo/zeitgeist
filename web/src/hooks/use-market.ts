"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { abis, addr, type CategoryKey } from "@/lib/contracts";
import { publicClient, useWallet } from "@/lib/wallet";

export type OnchainEntity = {
  index: number;
  token: Address;
  reserve: bigint;
  supply: bigint;
  price: bigint;        // 6-dec USD per 1e18 shares
  balance: bigint;      // connected account's shares
  staked: bigint;       // in the category gauge
  earned: bigint;       // ZEIT claimable
};

export type MarketState = {
  entities: OnchainEntity[];
  totalReserve: bigint;
  epochLength: number;
  currentEpoch: number;
  lastFundedEpoch: number;
  usdBalance: bigint;
  usdAllowance: bigint;
  chainTime: number;
  /** chain time minus wall-clock time when this state was read (dev chains can run ahead) */
  clockOffset: number;
};

// Largest chain-minus-wall offset seen. A local chain only mints blocks on transactions, so its latest
// block time goes stale; after a time jump (evm_increaseTime) later reads would otherwise rewind the clock.
let maxClockOffset = 0;

const read = (address: Address, abi: (typeof abis)[keyof typeof abis], functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<unknown>;

export function useMarket(category: CategoryKey) {
  const { account, tick } = useWallet();
  const [state, setState] = useState<MarketState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const m = addr.market(category);
    const g = addr.gauge(category);
    const M = abis.CategoryMarket;
    const load = async () => {
      try {
        const [n, reserves, epochLength, currentEpoch, lastFunded, block] = await Promise.all([
          read(m, M, "entityCount"), read(m, M, "reserves"), read(m, M, "epochLength"),
          read(m, M, "currentEpoch"), read(m, M, "lastFundedEpoch"), publicClient.getBlock(),
        ]);
        const count = Number(n as bigint);
        const rows = await Promise.all(
          Array.from({ length: count }, async (_, i) => {
            const [[token, reserve, supply], price] = (await Promise.all([read(m, M, "entity", [BigInt(i)]), read(m, M, "price", [BigInt(i)])])) as [[Address, bigint, bigint], bigint];
            const [balance, staked, earned] = account
              ? ((await Promise.all([
                  read(token, abis.EntityToken, "balanceOf", [account]),
                  read(g, abis.EntityGauge, "staked", [BigInt(i), account]),
                  read(g, abis.EntityGauge, "earned", [BigInt(i), account]),
                ])) as bigint[])
              : [0n, 0n, 0n];
            return { index: i, token, reserve, supply, price, balance, staked, earned };
          }),
        );
        const [usdBalance, usdAllowance] = account
          ? ((await Promise.all([read(addr.usd, abis.TestUSDC, "balanceOf", [account]), read(addr.usd, abis.TestUSDC, "allowance", [account, m])])) as bigint[])
          : [0n, 0n];
        if (!live) return;
        setState({
          entities: rows,
          totalReserve: (reserves as bigint[]).reduce((a, b) => a + b, 0n),
          epochLength: Number(epochLength as bigint),
          currentEpoch: Number(currentEpoch as bigint),
          lastFundedEpoch: Number(lastFunded as bigint),
          usdBalance,
          usdAllowance,
          chainTime: Number(block.timestamp),
          clockOffset: (maxClockOffset = Math.max(maxClockOffset, Number(block.timestamp) - Date.now() / 1000)),
        });
        setError(null);
      } catch (e) {
        if (live) setError("Can't reach the market contracts. Check that the chain is running and the deployment is synced.");
        console.error(e);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [category, account, tick]);

  return { state, error };
}
