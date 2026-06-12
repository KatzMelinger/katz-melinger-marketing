/**
 * scheduleDraftAnalysis — the "check readability anytime we create content"
 * rule, applied to every generation path.
 *
 * It runs the full content analysis (readability + grade level, SEO, brand
 * voice, AEO, CASH, linkability) AFTER the response is sent, using Next's
 * after() so the work is reliable in serverless yet never adds latency to
 * generation. analyzeDraft() self-persists to content_analyses, so the score
 * is already waiting when Diana opens the draft on the Production Board.
 *
 * Must be called from within a request (route handler) so after() can capture
 * the request context that resolveTenantId() relies on.
 */

import { after } from "next/server";

import { analyzeDraft } from "@/lib/content-analysis";

export function scheduleDraftAnalysis(args: {
  draftId: string | null | undefined;
  body: string;
  title?: string | null;
  topic?: string | null;
  format?: string | null;
  template?: string | null;
  targetKeywords?: string[];
}): void {
  if (!args.draftId || !args.body?.trim()) return;
  const draftId = args.draftId;
  const {
    body,
    title = null,
    topic = null,
    format = null,
    template = null,
    targetKeywords = [],
  } = args;

  after(async () => {
    try {
      await analyzeDraft({ draftId, body, title, topic, format, template, targetKeywords });
    } catch (err) {
      // Non-fatal: the draft is saved regardless. A failed auto-analysis just
      // means the score is blank until someone clicks "Re-check readability".
      console.warn("[auto-analyze] failed for draft", draftId, err);
    }
  });
}
