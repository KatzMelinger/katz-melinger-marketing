"use client";

/**
 * /content/km — the unified Content generator.
 *
 * One guided builder for every Practice Page, Blog Post, and Case Result,
 * run against the full content system prompt (voice, structure, internal
 * links, AEO rules). Start a brief from scratch here, or open one pre-filled
 * from the SEO Opportunity Radar — both use the same builder.
 */

import { ContentGeneratorLauncher } from "@/components/content-generator-launcher";
import { ContentNav } from "@/components/content-nav";
import { MarketingNav } from "@/components/marketing-nav";

export default function ContentGeneratorPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <MarketingNav />
      <div className="mb-2 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Content generator</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          Website pages
        </span>
      </div>
      <p className="text-sm opacity-70 mb-4">
        Generate a Practice Page, Blog Post, or Case Result against the full
        content system prompt — voice, structure, internal links, and AEO rules
        enforced. Start from scratch here, or open a brief from the SEO
        Opportunity Radar to pre-fill the keyword and pillar. For social posts
        or email, use <b>Generate</b> or <b>Multi-format batch</b>.
      </p>
      <ContentNav />

      <div className="mt-6">
        <ContentGeneratorLauncher />
      </div>
    </main>
  );
}
