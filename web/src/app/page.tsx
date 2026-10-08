import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Index, Mesh } from "@/components/ui/bits";
import { HotNow, ProofPanel, HeroFigures } from "@/components/home-live";
import { cn } from "@/lib/utils";

const STEPS = [
  { t: "Pick a name in a category", b: "Geopolitics, tech companies or tech personalities. Each name is a pool you can buy into with test USD." },
  { t: "The news is read every 15 minutes", b: "We count unique stories about every name in GDELT's global news files. Each count is compared with that name's own normal level and swings." },
  { t: "Money moves every 8 hours", b: "Names running hotter than their normal get money from names running cooler, 15% of the gap at a time. Your share price moves with it." },
  { t: "Vote where the rewards go", b: "Lock ZEIT to vote for a category. Voters earn that category's trading fees and bribes, and steer next week's ZEIT to its holders." },
];

export default function Home() {
  return (
    <>
      <section className="relative mx-4 mt-4 overflow-hidden rounded-xl border bg-foreground/[0.015] sm:mx-6">
        <Mesh />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 pb-40 pt-24 text-center sm:pt-32">
          <Link href="/markets/geopolitics" className="group mb-8 inline-flex items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-3 text-sm text-foreground/70 hover:text-foreground">
            <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">Live</span>
            Season 0 is open on Monad testnet
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <h1 className="text-5xl font-semibold leading-[1.02] sm:text-7xl">
            Buy the story before
            <span className="block text-foreground/40">the world catches on.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground/60">
            Every leader, company and founder has a normal amount of news. Zeitgeist prices how far today runs above it, so a quiet
            week for Trump and a breakout week for Starmer are judged on the same scale.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/markets/geopolitics" className={buttonVariants({ size: "lg" })}>
              Open the markets <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link href="#how" className={buttonVariants({ size: "lg", variant: "outline" })}>How it works</Link>
          </div>
          <HeroFigures />
        </div>
        <div aria-hidden className="pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[11rem] font-semibold leading-none tracking-[-0.06em] text-foreground/[0.04] sm:text-[16rem]">
          zeitgeist
        </div>
      </section>

      <HotNow />

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-4xl font-semibold sm:text-5xl">How a price moves</h2>
            <p className="mt-4 text-lg leading-relaxed text-foreground/60">Four steps, the same for every name in every category.</p>
          </div>
          <ol className="divide-y border-y">
            {STEPS.map((s, i) => (
              <li key={s.t} className="flex gap-5 py-6">
                <Index n={i + 1} className="pt-1" />
                <div>
                  <div className="font-medium">{s.t}</div>
                  <p className="mt-1.5 leading-relaxed text-foreground/60">{s.b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ProofPanel />

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-foreground/60">
          <span>Zeitgeist · built for Monad Metropolis</span>
          <span className="flex gap-4">
            <span>Test markets with test money. Nothing here is investment advice.</span>
          </span>
        </div>
      </footer>
    </>
  );
}
