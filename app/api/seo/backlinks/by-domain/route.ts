/**
 * GET /api/seo/backlinks/by-domain?domain=example.com
 *
 * Returns sample backlinks for a single referring domain. Used by the
 * row-expand UX on the Disavow Manager and the Link Quality table so the
 * user can see exactly what pages on a domain link back before disavowing.
 */

import { NextRequest, NextResponse } from "next/server";

import { getBacklinksForDomain } from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain")?.trim() ?? "";
  if (!domain) {
    return NextResponse.json({ error: "domain query param required" }, { status: 400 });
  }
  try {
    const { semrushDomain } = await getTenantConfig();
    const backlinks = await getBacklinksForDomain(domain, semrushDomain);
    return NextResponse.json({ domain, backlinks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch backlinks for domain" },
      { status: 500 },
    );
  }
}
