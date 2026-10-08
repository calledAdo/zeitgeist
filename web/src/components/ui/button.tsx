import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Core UI · Button: rounded-lg, black not primary-blue, tracking-tight on every label. */
export const buttonVariants = cva(
  "group inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-tight transition-colors duration-300 disabled:pointer-events-none disabled:bg-neutral-400 disabled:text-white dark:disabled:bg-neutral-700 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border border-foreground/20 bg-background hover:bg-foreground/5",
        secondary: "bg-muted text-foreground hover:bg-foreground/10",
        ghost: "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
        destructive: "bg-red-500 text-white hover:bg-red-600",
        up: "bg-emerald-500 text-white hover:bg-emerald-600",
        link: "h-auto px-0 text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground",
      },
      size: { sm: "h-9 px-3", default: "h-10 px-4", lg: "h-11 px-5 text-base", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...p} />;
}
