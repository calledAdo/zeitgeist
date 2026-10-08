import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** $1,234.56 from 6-decimal units */
export function usd(units: bigint | number, digits = 2) {
  const v = typeof units === "bigint" ? Number(units) / 1e6 : units;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact(n: number) {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function pct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function signed(x: number, digits = 2) {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;
}

export function duration(sec: number) {
  if (sec <= 0) return "now";
  const d = Math.floor(sec / 86400);
  if (d > 0) return `${d}d ${Math.floor((sec % 86400) / 3600)}h`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
