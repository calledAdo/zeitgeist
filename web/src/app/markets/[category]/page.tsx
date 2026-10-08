import { notFound } from "next/navigation";
import { CATEGORIES, type CategoryKey } from "@/lib/contracts";
import { Board } from "@/components/board";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.key }));
}

export default async function Page({ params }: PageProps<"/markets/[category]">) {
  const { category } = await params;
  if (!CATEGORIES.some((c) => c.key === category)) notFound();
  return <Board category={category as CategoryKey} />;
}
