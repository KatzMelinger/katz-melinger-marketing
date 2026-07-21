import { NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import {
  getBacklinkChange30d,
  getBacklinkDomains,
  getBacklinkOverview,
} from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tenantId, seoDomain } = await getTenantConfig();
    const [overview, domains, change] = await Promise.all([
      getBacklinkOverview(seoDomain),
      getBacklinkDomains(seoDomain),
      getBacklinkChange30d(seoDomain),
    ]);

    const toxicLinks = domains
      .filter((domain) => domain.toxicityRisk === "high")
      .slice(0, 20)
      .map((domain) => `domain:${domain.domain}`);

    return NextResponse.json({
      domain: seoDomain,
      competitors: await listCompetitors(tenantId),
      overview,
      domains,
      // Real counts from backlink timestamps (was fabricated from domain count).
      newBacklinksLast30d: change.newLast30d,
      lostBacklinksLast30d: change.lostLast30d,
      backlinkChangeCapped: change.newCapped || change.lostCapped,
      disavowFile: toxicLinks.join("\n"),
      linkBuildingOpportunities: domains
        .filter((domain) => domain.authorityScore >= 40)
        .slice(0, 10)
        .map((domain) => ({
          domain: domain.domain,
          authorityScore: domain.authorityScore,
          backlinks: domain.backlinks,
          reason:
            domain.authorityScore >= 60
              ? "High-authority site (AS ≥ 60). Top-tier referral target — pursue editorial coverage or directory listings."
              : "Healthy authority (AS 40-59). Worth pitching for legal directory listing, expert quote, or guest content.",
        })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed backlink intelligence" },
      { status: 500 },
    );
  }
}

