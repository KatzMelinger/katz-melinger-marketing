"use client";

/**
 * <ContentGeneratorLauncher /> — the shared entry point into the unified
 * content builder (the KmBriefWizard, opened from scratch). Used by both
 * /content/km and /seo/generator so there is a single generator surface.
 */

import { useState } from "react";

import { KmBriefWizard } from "@/components/km-brief-wizard";

export function ContentGeneratorLauncher() {
  const [open, setOpen] = useState(false);
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">
        Start a new content brief
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        The guided builder walks you through keyword, structure, internal links,
        and meta — then generates in English or Spanish.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4d8c]"
        >
          New content brief →
        </button>
        <a
          href="/seo/opportunities"
          className="rounded-md border border-[#185FA5] px-4 py-2 text-sm font-medium text-[#185FA5] hover:bg-[#185FA5]/5"
        >
          Browse SEO opportunities →
        </a>
        {lastDraftId && (
          <a
            href={`/content/drafts?id=${encodeURIComponent(lastDraftId)}`}
            className="text-sm text-[#185FA5] hover:underline"
          >
            Open last draft →
          </a>
        )}
      </div>

      {open && (
        <KmBriefWizard
          onClose={() => setOpen(false)}
          onGenerated={(id) => {
            if (id) setLastDraftId(id);
          }}
        />
      )}
    </div>
  );
}
