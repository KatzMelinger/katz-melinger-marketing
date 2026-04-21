import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";

export const SEO_ROUTES = [
  { href: "/seo", label: "Overview" },
  { href: "/seo/keywords", label: "Keywords" },
  { href: "/seo/keywords/competitive", label: "Keyword Battles" },
  { href: "/seo/backlinks", label: "Backlinks" },
  { href: "/seo/competitors", label: "Competitors" },
  { href: "/seo/competitors/add", label: "Add Competitor" },
  { href: "/seo/opportunities", label: "Opportunities" },
  { href: "/seo/technical", label: "Technical SEO" },
] as const;

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export function SeoShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="text-sm text-slate-400">{subtitle}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {SEO_ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="rounded-md border border-[#2a3f5f] bg-[#1a2540] px-3 py-1.5 text-xs text-slate-200 transition hover:border-[#185FA5] hover:text-white"
              >
                {route.label}
              </Link>
            ))}
          </div>
        </section>
        {children}
      </main>
    </div>
  );
}

