"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/sales", label: "Dashboard" },
  { href: "/sales/pending", label: "Pending Intakes" },
];

export function SalesSubnav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b border-slate-200 text-sm">
      {TABS.map((t) => {
        const active = t.href === "/sales" ? pathname === "/sales" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-1 pb-2 ${
              active ? "border-brand font-medium text-brand" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
