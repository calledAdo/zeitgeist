// ve(3,3) layer: category votes, locks and gauge stakes.
import { indexer } from "envio";
import { GAUGE_CATEGORY } from "../markets";

const key = (b: string) => Buffer.from(b.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

indexer.onEvent({ contract: "CategoryVoter", event: "Voted" }, async ({ event, context }) => {
  const cats = event.params.cats.map(key);
  context.Vote.set({
    id: `${event.block.number}-${event.logIndex}`,
    epoch: event.params.epoch,
    user: event.params.user.toLowerCase(),
    categories: cats,
    amounts: [...event.params.amounts],
    timestamp: event.block.timestamp,
  });
  for (let i = 0; i < cats.length; i++) {
    const id = `${cats[i]}-${event.params.epoch}`;
    const ce = (await context.CategoryEpoch.get(id)) ?? { id, category: cats[i], epoch: event.params.epoch, votes: 0n };
    context.CategoryEpoch.set({ ...ce, votes: ce.votes + event.params.amounts[i] });
  }
});

indexer.onEvent({ contract: "VotingEscrow", event: "Locked" }, async ({ event, context }) => {
  const id = event.params.user.toLowerCase();
  const l = (await context.Lock.get(id)) ?? { id, amount: 0n, end: 0n };
  context.Lock.set({ ...l, amount: l.amount + event.params.amount, end: event.params.end });
});

async function stake(context: any, event: any, d: bigint, reward = 0n) {
  const gauge = event.srcAddress.toLowerCase();
  const id = `${gauge}-${event.params.i}-${event.params.user.toLowerCase()}`;
  const s = (await context.Stake.get(id)) ?? {
    id, user: event.params.user.toLowerCase(), gauge: GAUGE_CATEGORY[gauge] ?? gauge, index: Number(event.params.i), amount: 0n, rewardsPaid: 0n,
  };
  context.Stake.set({ ...s, amount: s.amount + d, rewardsPaid: s.rewardsPaid + reward });
}

indexer.onEvent({ contract: "EntityGauge", event: "Staked" }, async ({ event, context }) => stake(context, event, event.params.amount));
indexer.onEvent({ contract: "EntityGauge", event: "Withdrawn" }, async ({ event, context }) => stake(context, event, -event.params.amount));
indexer.onEvent({ contract: "EntityGauge", event: "RewardPaid" }, async ({ event, context }) => stake(context, event, 0n, event.params.amount));
