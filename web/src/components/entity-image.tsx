import logos from "@/generated/logos.json";
import people from "@/generated/people.json";
import { cn } from "@/lib/utils";

/**
 * Companies: the company's own logo (fetched from its own site, see scripts/fetch-logos.mjs).
 * People: an official portrait (government site, company leadership page, or the person's own verified
 * account; sources in src/generated/people.json). Monogram fallback where none is available yet.
 * Colour carries meaning: logos sit in greyscale and turn to full colour when the name runs hot (heat ≥ +1);
 * avatars get an emerald ring.
 */
const LOGOS = logos as Record<string, { src: string }>;
const PEOPLE = people as Record<string, { src: string; credit: string }>;

// heads of state → ISO country (rendered as the flag emoji)
const COUNTRY: Record<string, string> = {
  trump: "US", modi: "IN", xi: "CN", putin: "RU", carney: "CA", netanyahu: "IL", zelensky: "UA",
  merz: "DE", macron: "FR", milei: "AR", starmer: "GB", ramaphosa: "ZA", erdogan: "TR", lula: "BR",
};
// tech personalities → the company they're best known for (badge uses that company's logo)
const COMPANY: Record<string, string> = {
  zuckerberg: "meta", musk: "tesla", amodei: "anthropic", altman: "openai", gates: "microsoft", cook: "apple", huang: "nvidia",
};

// square marks for the small badge where the main logo is a wordmark
const BADGE: Record<string, string> = { nvidia: "/logos/nvidia-mark.svg" };

const flag = (iso: string) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Stable hue per name, so every avatar is recognisably its own without photos. */
function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function EntityImage({
  category, entityKey, name, hot = false, className, rounded = "rounded-lg",
}: { category?: string; entityKey?: string; name: string; hot?: boolean; className?: string; rounded?: string }) {
  const logo = category === "tech_companies" && entityKey ? LOGOS[entityKey] : undefined;
  if (logo) {
    return (
      <div className={cn("grid place-items-center overflow-hidden bg-white p-[13%] ring-1 ring-black/5", rounded, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} alt={`${name} logo`} loading="lazy"
          className={cn("h-full w-full object-contain transition-[filter] duration-500", hot ? "grayscale-0" : "grayscale group-hover:grayscale-0")} />
      </div>
    );
  }

  const photo = entityKey ? PEOPLE[entityKey] : undefined;
  if (photo) {
    return (
      <div className={cn("overflow-hidden bg-foreground/5", rounded, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.src} alt={name} title={photo.credit} loading="lazy"
          className={cn("size-full object-cover object-top transition-[filter] duration-500", hot ? "grayscale-0" : "grayscale group-hover:grayscale-0")} />
      </div>
    );
  }

  // no usable photo yet: monogram fallback
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const h = hue(entityKey ?? name);
  const iso = entityKey ? COUNTRY[entityKey] : undefined;
  const co = entityKey ? COMPANY[entityKey] : undefined;
  const badgeLogo = co ? (BADGE[co] ? { src: BADGE[co] } : LOGOS[co]) : undefined;
  return (
    <div
      className={cn("relative overflow-hidden transition-shadow duration-500", hot && "ring-2 ring-emerald-500 ring-inset", rounded, className)}
      style={{
        containerType: "size",
        background: `linear-gradient(135deg, oklch(0.93 0.05 ${h}), oklch(0.84 0.08 ${(h + 40) % 360}))`,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-0 grid place-items-center font-semibold tracking-tight"
        style={{ fontSize: "min(34cqw, 34cqh)", color: `oklch(0.35 0.08 ${h})` }}
      >
        {initials}
      </span>
      {(iso || badgeLogo) && (
        <span
          className="zg-badge absolute grid place-items-center overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/10"
          style={{ width: "max(14px, min(26cqw, 26cqh))", height: "max(14px, min(26cqw, 26cqh))", right: "6%", bottom: "6%" }}
        >
          {iso ? (
            <span style={{ fontSize: "max(10px, min(17cqw, 17cqh))", lineHeight: 1 }}>{flag(iso)}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeLogo!.src} alt="" className="h-[66%] w-[66%] object-contain" />
          )}
        </span>
      )}
    </div>
  );
}
