/**
 * GET /api/recommendations/items?status=active|done|hold|disregard
 *
 * Returns the persistent action list. Omit `status` to get every row.
 * See app/api/recommendations/items/[id]/route.ts for PATCH/DELETE.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  listRecommendationItems,
  type RecStatus,
} from "@/lib/recommendation-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: RecStatus[] = ["active", "done", "hold", "disregard"];

export async function GET(req: NextRequest) {
  try {
    const statusParam = req.nextUrl.searchParams.get("status");
    const status =
      statusParam && VALID.includes(statusParam as RecStatus)
        ? (statusParam as RecStatus)
        : undefined;
    const items = await listRecommendationItems(status);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load items" },
      { status: 500 },
    );
  }
}
