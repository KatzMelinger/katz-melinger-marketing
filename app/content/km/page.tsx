"use client";

/**
 * /content/km — the unified Content generator.
 *
 * One guided builder for every Practice Page, Blog Post, and Case Result,
 * run against the full content system prompt (voice, structure, internal
 * links, AEO rules). Start a brief from scratch here, or open one pre-filled
 * from the SEO Opportunity Radar — both use the same builder.
 */

import { useState } from "react";

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import { KmBriefWizard } from "@/components/km-brief-wizard";
import { MarketingNav } from "@/components/marketing-nav";

export default function ContentGeneratorPage() {
  const [open, setOpen] = useState(false);
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <MarketingNav />
      <h1 className="text-2xl font-semibold mb-2">Content generator</h1>
      <p className="text-sm opacity-70 mb-4">
        Generate a Practice Page, Blog Post, or Case Result against the full
        content system prompt — voice, structure, internal links, and AEO rules
        enforced. Start from scratch here, or open a brief from the SEO
        Opportunity Radar to pre-fill the keyword and pillar.
      </p>
      <ContentTypeTabs />
      <ContentNav />

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Start a new content brief
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The guided builder walks you through keyword, structure, internal
          links, and meta — then generates in English or Spanish.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4d8c]"
          >
            New content brief →
          </button>
          {lastDraftId && (
            <a
              href={`/content/drafts?id=${encodeURIComponent(lastDraftId)}`}
              className="text-sm text-[#185FA5] hover:underline"
            >
              Open last draft →
            </a>
          )}
        </div>
      </div>

      {open && (
        <KmBriefWizard
          onClose={() => setOpen(false)}
          onGenerated={(id) => {
            if (id) setLastDraftId(id);
          }}
        />
      )}
    </main>
  );
}
