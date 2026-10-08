"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet";
import { cn, usd } from "@/lib/utils";

const NAV = [
  { href: "/markets/geopolitics", label: "Markets", match: "/markets" },
  { href: "/vote", label: "Vote", match: "/vote" },
  { href: "/calls", label: "Calls", match: "/calls" },
  { href: "/activity", label: "Activity", match: "/activity" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-foreground">
        <span className="size-2.5 rounded-full bg-background" />
      </span>
      Zeitgeist
    </Link>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const { theme, setTheme } = useTheme();
  const { account, connect, signOut, session } = useWallet();
  return (
    <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Logo />
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors duration-300",
                path.startsWith(n.match) ? "text-foreground" : "text-foreground/60 hover:text-foreground",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
          {account ? (
            <button
              onClick={signOut}
              title={session ? `Passkey session · ${usd(session.cap - session.spent, 0)} of buys left before re-confirming · click to sign out` : "Sign out"}
              className="group flex items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 font-mono text-xs text-foreground/70 hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              <span className="group-hover:hidden">{account.slice(0, 6)}…{account.slice(-4)}</span>
              <span className="hidden font-sans group-hover:inline">Sign out</span>
            </button>
          ) : (
            <Button onClick={connect}>Sign in</Button>
          )}
        </div>
      </div>
      <nav className="flex gap-1 border-t border-foreground/5 px-4 py-1 sm:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1.5 text-sm", path.startsWith(n.match) ? "text-foreground" : "text-foreground/60")}>
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
