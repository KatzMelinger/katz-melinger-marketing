/**
 * GET  /api/ads/keyword-queue?status=pending  — list queued negative-keyword
 *      suggestions awaiting approval (default: pending).
 * POST /api/ads/keyword-queue                  — queue one or more suggestions.
 *      Body: { suggestions: [{ keyword, match_type?, level?, reason?, source? }] }
 *
 * Approve-before-publish: audit-suggested negatives land here as 'pending'
 * instead of going straight into the live negative-keyword list.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  listKeywordQueue,
  queueKeywordSuggestions,
  type KeywordQueueStatus,
  type KeywordSuggestionInput,
} from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const statusParam = req.nextUrl.searchParams.get("status");
    const status = (
      ["pending", "approved", "rejected"].includes(statusParam ?? "")
        ? statusParam
        : "pending"
    ) as KeywordQueueStatus;
    const items = await listKeywordQueue(status);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list queue" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.suggestions)
      ? body.suggestions
      : body?.keyword
      ? [body]
      : [];
    const suggestions: KeywordSuggestionInput[] = raw
      .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s: Record<string, unknown>) => ({
        keyword: typeof s.keyword === "string" ? s.keyword : "",
        match_type:
          s.match_type === "exact" || s.match_type === "broad"
            ? s.match_type
            : "phrase",
        level: s.level === "account" ? "account" : "campaign",
        reason: typeof s.reason === "string" ? s.reason : null,
        source: typeof s.source === "string" ? s.source : "audit",
      }));

    if (suggestions.length === 0) {
      return NextResponse.json(
        { error: "suggestions are required" },
        { status: 400 },
      );
    }

    const created = await queueKeywordSuggestions(suggestions);
    return NextResponse.json({ items: created, queued: created.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to queue" },
      { status: 500 },
    );
  }
}
