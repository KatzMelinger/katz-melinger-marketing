"use client";

/**
 * /content/km — KM AI System Prompt content generator.
 *
 * The strict, brief-driven generator that runs every Practice Page, Blog
 * Post, and Case Result through the KM AI System Prompt. Sibling to the
 * existing /content (blog/social/email) generator, accessible from the
 * Content nav. Same UI is also mounted at /seo/generator.
 */

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import { KMContentGenerator } from "@/components/km-content-generator";
import { MarketingNav } from "@/components/marketing-nav";

export default function ContentKMPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <MarketingNav />
      <h1 className="text-2xl font-semibold mb-2">KM brief generator</h1>
      <p className="text-sm opacity-70 mb-4">
        Practice Page, Blog Post, and Case Result generation against the
        full Katz Melinger AI System Prompt. Brief required.
      </p>
      <ContentTypeTabs />
      <ContentNav />
      <KMContentGenerator />
    </main>
  );
}
