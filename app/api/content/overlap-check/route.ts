/**
 * POST /api/content/overlap-check
 *   body: { terms: string[], keyword?: string, excludeUrl?: string }
 *
 * The reviewer-facing "link, don't redefine" check. Runs TWO detectors, because
 * they see different things and the reviewer needs both:
 *
 *   1. detectContentOverlap — term-by-term against the published site_pages
 *      cluster map. Answers "which live page already defines this?"
 *   2. findExistingContent — the same duplicate guard that gates generation,
 *      across drafts, briefs in progress, the production board, published pages,
 *      and the keyword cluster. Answers "is something already in flight for this
 *      keyword?"
 *
 * Only running (1) is what let this check report "No overlap found in the
 * cluster map" for a draft that opened almost identically to another draft
 * sitting one column over in Approve — the live site genuinely had no such page
 * yet, because neither had been published.
 */

import { NextRequest, NextResponse } from "next/server";

import { detectContentOverlap } from "@/lib/content-overlap";
import { findExistingContent, duplicateMessage } from "@/lib/content-dedup";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    terms?: unknown;
    keyword?: unknown;
    excludeUrl?: unknown;
  };
  const terms = Array.isArray(body.terms)
    ? (body.terms as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (terms.length === 0) {
    return NextResponse.json(
      { error: "terms (string[]) required" },
      { status: 400 },
    );
  }
  // The one keyword this piece actually targets. Callers should send it
  // explicitly; the first term is the historical fallback.
  const keyword =
    typeof body.keyword === "string" && body.keyword.trim()
      ? body.keyword.trim()
      : terms[0];
  const excludeUrl =
    typeof body.excludeUrl === "string" ? body.excludeUrl : undefined;

  try {
    // Run both together — the pipeline scan is independent of the site scan and
    // must not double the reviewer's wait.
    const [result, inFlight] = await Promise.all([
      detectContentOverlap(terms, { excludeUrl }),
      (async () => {
        try {
          const dup = await findExistingContent({
            tenantId: await resolveTenantId(),
            keyword,
            secondaryKeywords: terms,
          });
          // A published match is already covered by detectContentOverlap's
          // richer per-term output; surfacing it twice reads as two problems.
          return dup && dup.kind !== "published" ? dup : null;
        } catch {
          // Fail soft: a pipeline-scan error must not blank the site results.
          return null;
        }
      })(),
    ]);

    return NextResponse.json({
      ...result,
      /** Something already in flight for this keyword, or null. */
      inFlight: inFlight
        ? { ...inFlight, message: duplicateMessage(inFlight) }
        : null,
      /** True when NEITHER detector found anything — the real "all clear". */
      allClear: !result.hasOverlap && !inFlight,
      keyword,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "overlap check failed" },
      { status: 500 },
    );
  }
}
