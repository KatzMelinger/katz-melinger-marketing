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
import { ContentTypeTabs } from "@/components/content-type-tabs";
import { MarketingNav } from "@/components/marketing-nav";

export default function ContentGeneratorPage() {
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

      <div className="mt-6">
        <ContentGeneratorLauncher />
      </div>
    </main>
  );
}
