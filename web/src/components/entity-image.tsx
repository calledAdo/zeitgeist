import { cn } from "@/lib/utils";

/** Monogram tile for an entity; tinted when the entity is running hot (heat ≥ +1). */
export function EntityImage({
  name, hot = false, className, rounded = "rounded-lg",
}: { category?: string; entityKey?: string; name: string; hot?: boolean; className?: string; rounded?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div
      className={cn(
        "grid place-items-center font-semibold tracking-tight transition-colors duration-500",
        hot ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-foreground/5 text-foreground/50",
        rounded, className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}
