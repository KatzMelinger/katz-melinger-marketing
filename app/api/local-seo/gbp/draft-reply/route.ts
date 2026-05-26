/**
 * POST /api/local-seo/gbp/draft-reply
 *   body: { reviewId, author, rating, comment, date }
 *
 * Returns an AI-drafted reply in the firm's Brand Voice. Does NOT post to
 * Google — that's the /reply endpoint. The marketer reviews the draft first.
 */

import { NextRequest, NextResponse } from "next/server";

import { draftReply, type ReviewToReply } from "@/lib/gbp-reply";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<ReviewToReply>;
  if (!body.reviewId || typeof body.comment !== "string") {
    return NextResponse.json(
      { error: "reviewId and comment required" },
      { status: 400 },
    );
  }

  const review: ReviewToReply = {
    reviewId: String(body.reviewId),
    author: typeof body.author === "string" ? body.author : "Google user",
    rating:
      typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5
        ? Math.round(body.rating)
        : 5,
    comment: body.comment,
    date: typeof body.date === "string" ? body.date : "",
  };

  try {
    const { reply, usedModel } = await draftReply(review);
    return NextResponse.json({ reply, usedModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "draft failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
