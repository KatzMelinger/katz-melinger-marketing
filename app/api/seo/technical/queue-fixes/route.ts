/**
 * POST /api/seo/technical/queue-fixes
 *   body: { page_url: string, fixes: SuggestedFix[] }
 *
 * Inserts approved technical-SEO fixes into the `wp_autopilot_recommendations`
 * queue. Status is set to 'approved' so the WP plugin picks them up on its
 * next 15-minute sync — the marketer already approved by clicking "Queue".
 *
 * Domain is derived from page_url so the plugin's token-scoped fetch picks up
 * only its own site.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { normalizeDomain, type FixType } from "@/lib/wp-autopilot";

export const runtime = "nodejs";

type IncomingFix = {
  fix_type?: unknown;
  current_value?: unknown;
  suggested_value?: unknown;
  rationale?: unknown;
};

const VALID_FIX_TYPES: FixType[] = [
  "meta_title",
  "meta_description",
  "canonical",
  "schema_jsonld",
  "og_title",
  "og_description",
];

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    page_url?: unknown;
    fixes?: unknown;
  };
  const pageUrlRaw = typeof body.page_url === "string" ? body.page_url.trim() : "";
  if (!pageUrlRaw) {
    return NextResponse.json({ error: "page_url required" }, { status: 400 });
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pageUrlRaw);
  } catch {
    return NextResponse.json({ error: "invalid page_url" }, { status: 400 });
  }
  if (!Array.isArray(body.fixes) || body.fixes.length === 0) {
    return NextResponse.json({ error: "fixes required" }, { status: 400 });
  }

  const domain = normalizeDomain(parsedUrl.host);
  const pageUrl = parsedUrl.toString();

  const rows: Array<{
    domain: string;
    page_url: string;
    fix_type: FixType;
    current_value: string | null;
    suggested_value: string;
    rationale: string;
    status: "approved";
    metadata: Record<string, unknown>;
  }> = [];

  for (const raw of body.fixes as IncomingFix[]) {
    const fix_type = raw.fix_type;
    if (typeof fix_type !== "string") continue;
    if (!VALID_FIX_TYPES.includes(fix_type as FixType)) continue;
    const suggested_value = raw.suggested_value;
    if (typeof suggested_value !== "string" || !suggested_value.trim()) continue;
    rows.push({
      domain,
      page_url: pageUrl,
      fix_type: fix_type as FixType,
      current_value:
        typeof raw.current_value === "string" && raw.current_value.length > 0
          ? raw.current_value
          : null,
      suggested_value,
      rationale:
        typeof raw.rationale === "string" && raw.rationale.length > 0
          ? raw.rationale
          : "Queued from Technical SEO",
      status: "approved",
      metadata: { source: "technical_seo" },
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "no valid fixes in payload" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const tid = await resolveTenantId();
    const { data, error } = await sb
      .from("wp_autopilot_recommendations")
      .insert(rows.map((r) => ({ ...r, tenant_id: tid })))
      .select("id, fix_type, status");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      queued: data ?? [],
      domain,
      page_url: pageUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Queue failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
