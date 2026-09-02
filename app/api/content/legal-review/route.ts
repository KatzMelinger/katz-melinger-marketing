/**
 * GET /api/content/legal-review — everything held for legal review.
 *
 * The queue behind the notification. The approval gate has been able to hold a
 * draft at `needs_legal` and email an attorney since the legal layer shipped,
 * but the email named a draft and nothing gathered them — so a hold waited for
 * someone to remember it.
 *
 * Returns oldest first, with the legal findings attached and the reviewers who
 * may clear each item, plus whether the SIGNED-IN user is one of them. The
 * caller needs that last part to know whether to offer a resolve control or
 * explain who to ask.
 */

import { NextResponse } from "next/server";

import { canClearLegalHold } from "@/lib/legal-reviewers";
import { listLegalReviewQueue } from "@/lib/legal-review";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { tenantId } = await getTenantClient();
  const items = await listLegalReviewQueue(tenantId);

  // Whether this user may clear a hold is a property of the person, not the
  // draft — the three attorneys can each clear any of them. Sent once rather
  // than recomputed per row.
  const canClear = canClearLegalHold(user.email ?? "");

  return NextResponse.json({
    items,
    canClear,
    viewer: user.email ?? null,
    // A queue that is empty because nothing is held and a queue that is empty
    // because the feature is switched off look identical to a reader. Say which.
    legalAccuracyEnabled: process.env.LEGAL_ACCURACY?.trim().toLowerCase() === "on",
  });
}
