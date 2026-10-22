/**
 * GET /api/content/publish-permission   { canPublish: boolean }
 * Whether the signed-in person may press Publish (Admins and Brand settings
 * "publishers"; Kenneth, 2026-10-20). The publish routes enforce it; this only
 * lets the screens hide the buttons.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { canPublish } from "@/lib/publish-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ canPublish: false });
  const { tenantId } = await getTenantClient();
  return NextResponse.json({ canPublish: await canPublish(user, tenantId) });
}
