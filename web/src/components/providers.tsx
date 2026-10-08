"use client";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <WalletProvider>{children}</WalletProvider>
    </ThemeProvider>
  );
}
