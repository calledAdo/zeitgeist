// CategoryMarket and AttentionOracle events: listings, trades, positions, funding rounds, price history.
import { indexer } from "envio";
import { MARKET_CATEGORY } from "../markets";

const WAD = 10n ** 18n;
const price = (r: bigint, s: bigint) => (s === 0n ? 0n : (2n * r * WAD) / s); // USD 6dp per share

const bytes32ToKey = (b: string) => Buffer.from(b.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

async function market(context: any, addr: string) {
  const id = addr.toLowerCase();
  return (
    (await context.Market.get(id)) ?? {
      id,
      category: MARKET_CATEGORY[id] ?? "unknown",
      totalReserve: 0n,
      volume: 0n,
      feesAccrued: 0n,
      feesToVoters: 0n,
      feesToTreasury: 0n,
    }
  );
}

async function trader(context: any, addr: string) {
  const id = addr.toLowerCase();
  return (await context.Trader.get(id)) ?? { id, trades: 0, volume: 0n, realizedPnl: 0n, feesPaid: 0n };
}

function point(context: any, l: any, kind: string, ts: number, tx: string, logIndex: number) {
  context.PricePoint.set({
    id: `${l.id}-${tx}-${logIndex}`,
    listing_id: l.id,
    kind,
    price: l.price,
    reserve: l.reserve,
    supply: l.supply,
    timestamp: ts,
    txHash: tx,
  });
}

indexer.onEvent({ contract: "CategoryMarket", event: "Listed" }, async ({ event, context }) => {
  const m = await market(context, event.srcAddress);
  const id = `${m.id}-${event.params.index}`;
  const l = {
    id,
    market_id: m.id,
    category: m.category,
    index: Number(event.params.index),
    name: event.params.name,
    token: event.params.token.toLowerCase(),
    reserve: event.params.reserve,
    supply: event.params.supply,
    price: price(event.params.reserve, event.params.supply),
    volume: 0n,
    trades: 0,
    holders: 0,
    fundingNet: 0n,
    lastFundingDelta: 0n,
  };
  context.Listing.set(l);
  context.Market.set({ ...m, totalReserve: m.totalReserve + event.params.reserve });
  point(context, l, "list", event.block.timestamp, event.transaction.hash, event.logIndex);
});

async function trade(context: any, event: any, side: "buy" | "sell") {
  const m = await market(context, event.srcAddress);
  const lid = `${m.id}-${event.params.index}`;
  const l = await context.Listing.getOrThrow(lid);
  const p = event.params;
  const user = (side === "buy" ? p.to : p.seller) as string;
  const t = await trader(context, user);
  const posId = `${lid}-${user.toLowerCase()}`;
  const pos = (await context.Position.get(posId)) ?? {
    id: posId, listing_id: lid, trader_id: t.id, shares: 0n, costBasis: 0n, realizedPnl: 0n,
  };

  let reserve = l.reserve, supply = l.supply, usd: bigint, shares: bigint, pnl = 0n;
  let next = { ...pos };
  if (side === "buy") {
    usd = p.assetIn;
    shares = p.sharesOut;
    reserve += p.assetIn - p.fee;
    supply += p.sharesOut;
    next = { ...pos, shares: pos.shares + shares, costBasis: pos.costBasis + usd };
  } else {
    usd = p.assetOut + p.fee; // gross taken from the reserve
    shares = p.sharesIn;
    reserve -= usd;
    supply -= p.sharesIn;
    // average cost: the sold fraction of the cost basis is released; proceeds are net of fee
    const released = pos.shares === 0n ? 0n : (pos.costBasis * shares) / pos.shares;
    pnl = p.assetOut - released;
    next = { ...pos, shares: pos.shares > shares ? pos.shares - shares : 0n, costBasis: pos.costBasis - released, realizedPnl: pos.realizedPnl + pnl };
  }
  const holderDelta = pos.shares === 0n && next.shares > 0n ? 1 : pos.shares > 0n && next.shares === 0n ? -1 : 0;
  const nl = {
    ...l, reserve, supply, price: price(reserve, supply), volume: l.volume + usd, trades: l.trades + 1, holders: l.holders + holderDelta,
  };
  context.Listing.set(nl);
  context.Position.set(next);
  context.Trader.set({ ...t, trades: t.trades + 1, volume: t.volume + usd, realizedPnl: t.realizedPnl + pnl, feesPaid: t.feesPaid + p.fee });
  context.Market.set({ ...m, totalReserve: m.totalReserve + reserve - l.reserve, volume: m.volume + usd, feesAccrued: m.feesAccrued + p.fee });
  context.Trade.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    listing_id: lid, trader_id: t.id, side, usd, fee: p.fee, shares, priceAfter: nl.price,
    timestamp: event.block.timestamp, txHash: event.transaction.hash,
  });
  point(context, nl, side, event.block.timestamp, event.transaction.hash, event.logIndex);
}

indexer.onEvent({ contract: "CategoryMarket", event: "Bought" }, async ({ event, context }) => trade(context, event, "buy"));
indexer.onEvent({ contract: "CategoryMarket", event: "Sold" }, async ({ event, context }) => trade(context, event, "sell"));

indexer.onEvent({ contract: "CategoryMarket", event: "Funded" }, async ({ event, context }) => {
  const m = await market(context, event.srcAddress);
  let moved = 0n;
  const deltas = event.params.deltas as readonly bigint[];
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (d > 0n) moved += d;
    const l = await context.Listing.get(`${m.id}-${i}`);
    if (!l) continue;
    const reserve = l.reserve + d;
    const nl = { ...l, reserve, price: price(reserve, l.supply), fundingNet: l.fundingNet + d, lastFundingDelta: d };
    context.Listing.set(nl);
    if (d !== 0n) point(context, nl, "funding", event.block.timestamp, event.transaction.hash, event.logIndex * 1000 + i);
  }
  context.FundingRound.set({
    id: `${m.id}-${event.params.epoch}`,
    market_id: m.id,
    category: m.category,
    epoch: event.params.epoch,
    inputsHash: event.params.inputsHash,
    moved,
    deltas: [...deltas],
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "CategoryMarket", event: "FeesCollected" }, async ({ event, context }) => {
  const m = await market(context, event.srcAddress);
  context.Market.set({ ...m, feesToVoters: m.feesToVoters + event.params.toVoters, feesToTreasury: m.feesToTreasury + event.params.toTreasury });
});

indexer.onEvent({ contract: "AttentionOracle", event: "TargetsPosted" }, async ({ event, context }) => {
  context.TargetsPost.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    category: bytes32ToKey(event.params.category),
    asOf: event.params.asOf,
    inputsHash: event.params.inputsHash,
    targets: [...event.params.targets],
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

export { bytes32ToKey };
