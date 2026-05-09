"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/content", label: "Generate" },
  { href: "/content/batch", label: "Multi-format batch" },
  { href: "/content/sources", label: "Source material" },
  { href: "/content/drafts", label: "Saved drafts" },
];

export function ContentNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-6">
      {TABS.map((t) => {
        const active = pathname === t.href || (t.href !== "/content" && pathname?.startsWith(t.href));
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              active
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
