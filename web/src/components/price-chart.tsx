"use client";
// Price history for one name from the Envio index: trades move the line, funding rounds are the dots.
import { listingId, useIndexer, type PricePoint } from "@/lib/indexer";
import { usd } from "@/lib/utils";

const Q = `query($id: String!) { PricePoint(where: {listing_id: {_eq: $id}}, order_by: [{timestamp: asc}, {id: asc}], limit: 500) { kind price timestamp } }`;

export function PriceChart({ market, index }: { market: string; index: number }) {
  const data = useIndexer<{ PricePoint: PricePoint[] }>(Q, { id: listingId(market, index) });
  const pts = data?.PricePoint ?? [];
  if (pts.length < 2) {
    return <p className="text-xs text-foreground/50">{data ? "Not enough history yet." : "Price history appears once the indexer is running."}</p>;
  }
  const W = 360, H = 96, P = 4;
  const ys = pts.map((p) => Number(p.price) / 1e6);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || hi * 0.01 || 1;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const line = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const rounds = pts.filter((p) => p.kind === "funding").length;
  const up = ys[ys.length - 1] >= ys[0];
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Price history">
        <path d={line} fill="none" strokeWidth={1.75} className={up ? "stroke-emerald-500" : "stroke-red-500"} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => p.kind === "funding" && <circle key={i} cx={x(i)} cy={y(ys[i])} r={2.75} className="fill-foreground" />)}
      </svg>
      <figcaption className="flex justify-between text-xs text-foreground/50">
        <span>{usd(Math.round(lo * 1e6))} – {usd(Math.round(hi * 1e6))}</span>
        <span>{rounds} funding {rounds === 1 ? "round" : "rounds"} · {pts.length} price changes · indexed by Envio</span>
      </figcaption>
    </figure>
  );
}
