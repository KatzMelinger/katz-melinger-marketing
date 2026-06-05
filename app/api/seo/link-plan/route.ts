/**
 * POST /api/seo/link-plan
 *
 * Returns the internal link plan for a brief: confirmed live pages from the
 * Cluster Map (plus the assigned pillar), each with suggested anchor text and a
 * target section. Cannibalization-risk pages are returned separately in
 * `flagged` and never offered as links.
 *
 * Body: { primaryKeyword, secondaryKeywords?, faqQuestions?, pillarId?,
 *         practiceArea?, excludeUrl? }
 */

import { NextResponse } from "next/server";

import { buildLinkPlan } from "@/lib/internal-links";
import type { KMPracticeArea } from "@/lib/km-content-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const primaryKeyword = typeof body.primaryKeyword === "string" ? body.primaryKeyword.trim() : "";
  if (!primaryKeyword) {
    return NextResponse.json({ error: "primaryKeyword is required" }, { status: 400 });
  }

  const practiceArea =
    body.practiceArea === "employment" || body.practiceArea === "collections"
      ? (body.practiceArea as KMPracticeArea)
      : undefined;

  try {
    const plan = await buildLinkPlan({
      primaryKeyword,
      secondaryKeywords: asStringArray(body.secondaryKeywords),
      faqQuestions: asStringArray(body.faqQuestions),
      pillarId: typeof body.pillarId === "string" ? body.pillarId : undefined,
      practiceArea,
      excludeUrl: typeof body.excludeUrl === "string" ? body.excludeUrl : undefined,
    });
    return NextResponse.json(plan);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build link plan" },
      { status: 500 },
    );
  }
}
