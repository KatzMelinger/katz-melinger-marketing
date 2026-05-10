import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";

export const SEO_ROUTES = [
  { href: "/seo", label: "Overview" },
  { href: "/seo/keywords", label: "Keywords" },
  { href: "/seo/keywords/competitive", label: "Keyword Battles" },
  { href: "/seo/backlinks", label: "Backlinks" },
  { href: "/seo/link-strategy", label: "Link Strategy" },
  { href: "/seo/competitors", label: "Competitors" },
  { href: "/seo/opportunities", label: "Opportunities" },
  { href: "/seo/technical", label: "Technical SEO" },
  { href: "/seo/cannibalization", label: "Cannibalization" },
  { href: "/seo/internal-links", label: "Internal Links" },
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
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {SEO_ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-1.5 text-xs text-slate-700 transition hover:border-[#185FA5] hover:text-slate-900"
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

