/**
 * POST /api/local-seo/gbp/reply
 *   body: { accountId?, locationId?, reviewId, comment }
 *
 * Sends a reply to a Google Business Profile review. accountId and locationId
 * fall back to GOOGLE_BUSINESS_ACCOUNT_ID / GOOGLE_BUSINESS_LOCATION_ID env
 * vars when not provided in the body (matches the pattern in the existing
 * google-business POST handler).
 */

import { NextRequest, NextResponse } from "next/server";

import { postReply } from "@/lib/gbp-reply";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";

type Body = {
  accountId?: unknown;
  locationId?: unknown;
  reviewId?: unknown;
  comment?: unknown;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Body;
  const reviewId = asString(body.reviewId).trim();
  const comment = asString(body.comment).trim();
  if (!reviewId) {
    return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  }
  if (!comment) {
    return NextResponse.json({ error: "comment required" }, { status: 400 });
  }

  const accountId =
    asString(body.accountId).trim() ||
    process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ||
    "";
  const locationId =
    asString(body.locationId).trim() ||
    process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ||
    "";
  if (!accountId || !locationId) {
    return NextResponse.json(
      {
        error:
          "accountId and locationId required (or set GOOGLE_BUSINESS_ACCOUNT_ID / GOOGLE_BUSINESS_LOCATION_ID).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await postReply({
      accountId,
      locationId,
      reviewId,
      comment,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "reply failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
