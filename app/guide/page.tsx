"use client";

/**
 * In-app Guide — explains what every section of the app does and how to use it,
 * plus a glossary of the terminology used across the product.
 *
 * The Sections tab is generated from `SIDEBAR_SECTIONS` (the same source of
 * truth the sidebar renders from), joined with the per-item prose in
 * `lib/guide-content.ts`, so the Guide can never drift out of sync with the
 * real navigation. Admin-only items are hidden from non-admins, mirroring the
 * sidebar's own filtering.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import { SIDEBAR_SECTIONS } from "@/lib/departments";
import { GUIDE_ENTRIES, GLOSSARY } from "@/lib/guide-content";
import { useTenant } from "@/components/tenant-provider";

type Tab = "sections" | "glossary";

export default function GuidePage() {
  const { user } = useTenant();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("sections");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  // Sections joined with their prose, admin items filtered, then text-filtered
  // by the search box. A section drops out entirely when no item matches.
  const sections = useMemo(() => {
    return SIDEBAR_SECTIONS.map((section) => {
      const items = section.items
        .filter((it) => !it.adminOnly || isAdmin)
        .map((it) => {
          const entry = GUIDE_ENTRIES[it.href];
          return {
            href: it.href,
            label: it.label,
            icon: it.icon,
            whatItIs: entry?.whatItIs ?? "",
            howToUse: entry?.howToUse ?? "",
          };
        })
        .filter((it) => {
          if (!q) return true;
          return (
            it.label.toLowerCase().includes(q) ||
            it.whatItIs.toLowerCase().includes(q) ||
            it.howToUse.toLowerCase().includes(q) ||
            section.label.toLowerCase().includes(q)
          );
        });
      return { ...section, joined: items };
    }).filter((s) => s.joined.length > 0);
  }, [isAdmin, q]);

  const glossary = useMemo(() => {
    const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
    if (!q) return sorted;
    return sorted.filter(
      (g) =>
        g.term.toLowerCase().includes(q) ||
        g.definition.toLowerCase().includes(q),
    );
  }, [q]);

  const tabClass = (active: boolean) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
      active
        ? "border-brand text-brand"
        : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
    }`;

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Guide</h1>
        <p className="mt-1 text-sm text-slate-500">
          What each section does and how to use it — plus a glossary of the
          terms used across the app.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("sections")}
          className={tabClass(tab === "sections")}
        >
          Sections
        </button>
        <button
          type="button"
          onClick={() => setTab("glossary")}
          className={tabClass(tab === "glossary")}
        >
          Glossary
        </button>
      </div>

      {/* Search */}
      <div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === "sections"
              ? "Search sections — e.g. backlinks, calendar, attribution…"
              : "Search terms — e.g. AEO, NAP, cannibalization…"
          }
          className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {tab === "sections" ? (
        <div className="space-y-8">
          {sections.length === 0 ? (
            <p className="text-sm text-slate-500">
              No sections match “{query}”.
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: section.accent }}
                    aria-hidden
                  />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                    {section.label}
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {section.joined.map((item) => (
                    <Link
                      key={`${section.key}-${item.href}`}
                      href={item.href}
                      className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand hover:shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        {item.icon && (
                          <span className="text-base leading-none" aria-hidden>
                            {item.icon}
                          </span>
                        )}
                        <h3 className="text-sm font-semibold text-slate-900 group-hover:text-brand">
                          {item.label}
                        </h3>
                      </div>
                      {item.whatItIs ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                          {item.whatItIs}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs italic text-slate-400">
                          Description coming soon.
                        </p>
                      )}
                      {item.howToUse && (
                        <p className="mt-2 text-xs leading-relaxed text-slate-500">
                          <span className="font-medium text-slate-600">
                            How to use:{" "}
                          </span>
                          {item.howToUse}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-brand group-hover:underline">
                        Open →
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {glossary.length === 0 ? (
            <p className="text-sm text-slate-500">
              No terms match “{query}”.
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {glossary.map((g) => (
                <div
                  key={g.term}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <dt className="text-sm font-semibold text-slate-900">
                    {g.term}
                  </dt>
                  <dd className="mt-1 text-xs leading-relaxed text-slate-600">
                    {g.definition}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
