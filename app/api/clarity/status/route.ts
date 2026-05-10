/**
 * GET /api/clarity/status
 *
 * Returns whether the Microsoft Clarity Project ID is configured. The /clarity
 * page uses this to decide between the setup-required state and the launcher
 * (heatmaps / recordings / etc).
 *
 * Microsoft Clarity does not expose a public REST API for heatmap or
 * recording data — they're available only through Clarity's own UI, which we
 * deep-link into. The Project ID is not a secret (it's already embedded in
 * the public tracking script), so we return it directly.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const projectId = process.env.CLARITY_PROJECT_ID?.trim() ?? "";
  return NextResponse.json({
    configured: Boolean(projectId),
    projectId,
  });
}
