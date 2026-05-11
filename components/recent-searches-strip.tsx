"use client";

/**
 * Inline chip strip rendered above search inputs on individual SEO pages.
 * Shows the last N recent searches for a given scope and lets the user
 * jump back into one with a click. Re-renders on every recordSearch().
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  hrefForSearch,
  listRecent,
  RecentSearch,
  RecentSearchScope,
} from "@/lib/recent-searches";

export function RecentSearchesStrip({
  scope,
  limit = 6,
  onPick,
}: {
  scope: RecentSearchScope;
  limit?: number;
  /**
   * Optional click handler. If provided, the chip becomes a button that
   * fills the page's local search input with the query rather than
   * navigating. The page is responsible for re-running the search.
   */
  onPick?: (query: string) => void;
}) {
  const [items, setItems] = useState<RecentSearch[]>([]);

  useEffect(() => {
    setItems(listRecent(scope, limit));
    const onStorage = () => setItems(listRecent(scope, limit));
    window.addEventListener("storage", onStorage);
    window.addEventListener("km:recent-searches", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("km:recent-searches", onStorage);
    };
  }, [scope, limit]);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
      <span className="font-medium text-slate-600">Recent:</span>
      {items.map((item) => {
        const className =
          "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]";
        if (onPick) {
          return (
            <button
              key={`${item.scope}|${item.query}|${item.createdAt}`}
              type="button"
              className={className}
              onClick={() => onPick(item.query)}
            >
              {item.query}
            </button>
          );
        }
        return (
          <Link
            key={`${item.scope}|${item.query}|${item.createdAt}`}
            href={hrefForSearch(item)}
            className={className}
          >
            {item.query}
          </Link>
        );
      })}
    </div>
  );
}
