import { anvil, monadTestnet } from "viem/chains";
import type { Abi, Address } from "viem";
import abisJson from "@/generated/abis.json";
import deployment from "@/generated/deployment.json";

export const abis = abisJson as unknown as Record<
  "CategoryMarket" | "EntityToken" | "EntityGauge" | "CategoryVoter" | "VotingEscrow" | "Zeit" | "TestUSDC" | "Minter" | "SealedCalls",
  Abi
>;

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const chain = chainId === monadTestnet.id ? monadTestnet : anvil;

type Dep = Record<string, string | number>;
const dep = deployment as Dep;

export const CATEGORIES = [
  { key: "geopolitics", label: "Geopolitics", blurb: "Heads of state and government with global reach." },
  { key: "tech_companies", label: "Tech companies", blurb: "The companies the tech press can't stop writing about." },
  { key: "tech_personalities", label: "Tech personalities", blurb: "The founders and CEOs who make the news themselves." },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const addr = {
  usd: dep.usd as Address,
  zeit: dep.zeit as Address,
  ve: dep.ve as Address,
  voter: dep.voter as Address,
  minter: dep.minter as Address,
  calls: dep.calls as Address,
  market: (c: CategoryKey) => dep[c] as Address,
  gauge: (c: CategoryKey) => dep[`${c}_gauge`] as Address,
};

export const deployed = Boolean(dep.usd);
export const epochSeconds = Number(dep.epochSeconds ?? 28800);

/** bytes32(bytes(key)) as the contracts store category ids */
export function categoryId(key: string): `0x${string}` {
  const hex = Array.from(new TextEncoder().encode(key), (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex.padEnd(64, "0")}`;
}
