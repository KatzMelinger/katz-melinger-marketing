"use client";

/**
 * /seo/generator — KM AI System Prompt content generator under the SEO hub.
 *
 * Same generator UI as /content/km, mounted inside the SEO Ops Hub shell.
 * Marketing team requested both entry points so SEO and content workflows
 * can each launch a brief-driven generation from their own surface.
 */

import { KMContentGenerator } from "@/components/km-content-generator";
import { SeoShell } from "@/components/seo-shell";

export default function SeoGeneratorPage() {
  return (
    <SeoShell
      title="Content generator"
      subtitle="Strict Per-Page Brief generator running the Katz Melinger AI System Prompt. Practice Page, Blog Post, and Case Result. Brief is required before Generate is enabled."
    >
      <KMContentGenerator />
    </SeoShell>
  );
}
