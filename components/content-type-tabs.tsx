"use client";

/**
 * Top-of-page Website / Social Media / Email tabs shown on every type-scoped
 * Content Studio page. Reads/writes the `type` query param so the selection
 * sticks across navigation between sub-pages (Generate / Multi-format batch /
 * Drafts / Pipeline). The ContentNav row below has its own active state.
 *
 * Render once at the top of each type-scoped page, above the ContentNav.
 */

import { useRouter, useSearchParams } from "next/navigation";

import {
  CONTENT_TYPE_LABEL,
  CONTENT_TYPES,
  ContentTypeKey,
  readContentType,
} from "@/lib/content-types";

export function ContentTypeTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = readContentType(searchParams);

  const setType = (type: ContentTypeKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("type", type);
    router.replace(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap gap-1 mb-3">
      {CONTENT_TYPES.map((t) => {
        const active = t === current;
        return (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
              active
                ? "bg-[#185FA5] text-white"
                : "bg-white border border-slate-200 text-slate-700 hover:border-slate-300"
            }`}
          >
            {CONTENT_TYPE_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}
