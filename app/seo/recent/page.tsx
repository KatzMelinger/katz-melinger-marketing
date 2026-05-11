"use client";

/**
 * Cross-SEO recent searches.
 *
 * Reads from the localStorage log written by `recordSearch()` calls scattered
 * across the SEO surfaces. Renders the last 10 per scope (Keywords, Battles,
 * Cannibalization, etc.) so the user can jump back into a recent query without
 * retyping it.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { SeoShell } from "@/components/seo-shell";
import {
  clearRecent,
  hrefForSearch,
  labelForScope,
  listRecent,
  RecentSearch,
  RecentSearchScope,
} from "@/lib/recent-searches";

const SCOPES: RecentSearchScope[] = [
  "keywords",
  "battles",
  "competitors",
  "cannibalization",
  "internal-links",
  "opportunities",
  "technical",
  "backlinks",
];

export default function SeoRecentPage() {
  const [grouped, setGrouped] = useState<Record<RecentSearchScope, RecentSearch[]>>(
    () =>
      Object.fromEntries(SCOPES.map((s) => [s, [] as RecentSearch[]])) as unknown as Record<
        RecentSearchScope,
        RecentSearch[]
      >,
  );

  const refresh = useCallback(() => {
    const next = Object.fromEntries(
      SCOPES.map((s) => [s, listRecent(s, 10)]),
    ) as unknown as Record<RecentSearchScope, RecentSearch[]>;
    setGrouped(next);
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("storage", onChange);
    window.addEventListener("km:recent-searches", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("km:recent-searches", onChange);
    };
  }, [refresh]);

  const totalCount = SCOPES.reduce((sum, s) => sum + grouped[s].length, 0);

  const onClearAll = () => {
    if (!window.confirm("Clear all recent SEO searches?")) return;
    clearRecent();
    refresh();
  };

  const onClearScope = (scope: RecentSearchScope) => {
    clearRecent(scope);
    refresh();
  };

  return (
    <SeoShell
      title="Recent searches"
      subtitle="The last 10 queries from every SEO surface, ready to re-run. Stored locally in your browser."
    >
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-500">
          {totalCount === 0
            ? "No recent searches yet. Run a search on Keywords, Battles, Cannibalization, etc. and they'll show up here."
            : `${totalCount} recent search${totalCount === 1 ? "" : "es"} across SEO surfaces.`}
        </span>
        {totalCount > 0 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-slate-500 hover:text-red-600 underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SCOPES.map((scope) => {
          const items = grouped[scope];
          if (items.length === 0) return null;
          return (
            <section
              key={scope}
              className="rounded-xl border border-[#e2e8f0] bg-white p-4"
            >
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  {labelForScope(scope)}
                </h2>
                <button
                  type="button"
                  onClick={() => onClearScope(scope)}
                  className="text-[11px] text-slate-400 hover:text-red-500"
                >
                  Clear
                </button>
              </header>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li
                    key={`${item.scope}|${item.query}|${item.createdAt}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <Link
                      href={hrefForSearch(item)}
                      className="text-sm text-slate-700 hover:text-[#185FA5] truncate"
                      title={item.query}
                    >
                      {item.query}
                    </Link>
                    <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </SeoShell>
  );
}
