"use client";

/**
 * /seo/generator — the unified Content generator under the SEO hub.
 *
 * Mounts the same guided builder as /content/km. When opened with a
 * ?packetId= or ?suggestion= deep link (e.g. from the Research Libraries),
 * it falls back to the detailed brief form, which pre-fills the richer
 * research fields (statutes, FAQs, legal sources) the guided wizard doesn't
 * surface. Otherwise it shows the unified launcher.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ContentGeneratorLauncher } from "@/components/content-generator-launcher";
import { KMContentGenerator } from "@/components/km-content-generator";
import { SeoShell } from "@/components/seo-shell";

function SeoGeneratorBody() {
  const params = useSearchParams();
  const hasPrefill = Boolean(params?.get("packetId") || params?.get("suggestion"));
  return hasPrefill ? <KMContentGenerator /> : <ContentGeneratorLauncher />;
}

export default function SeoGeneratorPage() {
  return (
    <SeoShell
      title="Content generator"
      subtitle="Generate a Practice Page, Blog Post, or Case Result against the full content system prompt — start from scratch, or open a research packet to pre-fill the brief."
    >
      <Suspense fallback={null}>
        <SeoGeneratorBody />
      </Suspense>
    </SeoShell>
  );
}
