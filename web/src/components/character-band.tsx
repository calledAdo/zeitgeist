import { cn } from "@/lib/utils";

/**
 * The entity's own normal range drawn as a band from −3 to +3 heat, with today's position marked.
 * The shaded middle is "one normal swing either way"; outside it the entity is unusually hot or quiet.
 */
export function CharacterBand({ heat, className }: { heat: number | null; className?: string }) {
  const h = heat ?? 0;
  const x = ((Math.max(-3, Math.min(3, h)) + 3) / 6) * 100;
  const tone = h >= 1 ? "bg-emerald-500" : h <= -1 ? "bg-red-500" : "bg-foreground";
  return (
    <div className={cn("relative h-5 w-32", className)} role="img" aria-label={heat === null ? "No heat yet" : `Heat ${h.toFixed(1)} on a scale of −3 to +3`}>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/5" />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/15" style={{ left: `${(2 / 6) * 100}%`, width: `${(2 / 6) * 100}%` }} />
      <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/30" style={{ left: "50%" }} />
      {heat !== null && (
        <div className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background transition-[left] duration-500", tone)} style={{ left: `${x}%` }} />
      )}
    </div>
  );
}

/** Pool share against funding target: the gap is what the next funding epoch closes 15% of. */
export function GapBar({ share, target, className }: { share: number; target: number; className?: string }) {
  const max = Math.max(share, target, 0.0001) * 1.25;
  return (
    <div className={cn("relative h-2 w-28 rounded-full bg-foreground/5", className)} aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${(share / max) * 100}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-chart" style={{ left: `${(target / max) * 100}%` }} />
    </div>
  );
}
