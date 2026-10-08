"use client";
import { X } from "lucide-react";
import { useWallet } from "@/lib/wallet";

export function TxToast() {
  const { pending, error, clearError } = useWallet();
  if (!pending && !error) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-background px-4 py-3 text-sm shadow-lg">
      {pending ? (
        <>
          <span className="size-2 animate-pulse rounded-full bg-foreground" />
          Waiting for the transaction to confirm…
        </>
      ) : (
        <>
          <span className="size-2 rounded-full bg-red-500" />
          <span className="text-foreground/80">{error}</span>
          <button onClick={clearError} aria-label="Dismiss" className="text-foreground/50 hover:text-foreground"><X className="size-4" /></button>
        </>
      )}
    </div>
  );
}
