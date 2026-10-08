import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card · shadcn base: rounded-xl, hairline border, shadow-sm. */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card shadow-sm", className)} {...p} />;
}

/** Index: mono, for real sequences only, e.g. (01). */
export function Index({ n, className }: { n: number; className?: string }) {
  return <span className={cn("font-mono text-xs text-foreground/50", className)}>({String(n).padStart(2, "0")})</span>;
}

/** Bracketed figure, the DS's way of marking a live number: [$1.08] */
export function Fig({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-semibold tabular-nums tracking-tight", className)}>[{children}]</span>;
}

export function Pill({ className, ...p }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-foreground/70", className)} {...p} />;
}

export function Delta({ v, digits = 1, className }: { v: number; digits?: number; className?: string }) {
  const up = v >= 0;
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400", className)}>
      {up ? "+" : "−"}{Math.abs(v * 100).toFixed(digits)}%
    </span>
  );
}

/** Gradient-mesh background: three drifting blobs, 20 / 25 / 30s, each under 25% opacity. */
export function Mesh({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="animate-mesh-1 absolute -left-20 top-10 size-[32rem] rounded-full bg-blue-400/20 blur-3xl" />
      <div className="animate-mesh-2 absolute right-0 top-0 size-[28rem] rounded-full bg-purple-400/15 blur-3xl" />
      <div className="animate-mesh-3 absolute bottom-0 left-1/3 size-[26rem] rounded-full bg-pink-300/10 blur-3xl" />
    </div>
  );
}
