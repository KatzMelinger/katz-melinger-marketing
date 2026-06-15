/**
 * GET /api/auth/me
 *
 * Returns the current logged-in user's id, email, and role. Used by the
 * sidebar to render the user menu. Returns 401 when no session.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  // Firm name + primary domain drive the in-app white-label (wordmark, and the
  // useTenant() hook that feeds tool-page URL prefills / helper copy). Tolerate
  // a config read failure — consumers fall back to the product name / generics.
  let firmName: string | null = null;
  let domain: string | null = null;
  let brandColor: string | null = null;
  let logoUrl: string | null = null;
  try {
    const cfg = await getTenantConfig();
    firmName = cfg.firmName || null;
    domain = cfg.seoDomain || null;
    brandColor = cfg.brandColor || null;
    logoUrl = cfg.logoUrl || null;
  } catch {
    firmName = null;
    domain = null;
  }
  return NextResponse.json({ user, firmName, domain, brandColor, logoUrl });
}
