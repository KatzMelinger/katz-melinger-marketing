/**
 * POST /api/onboarding — persist a new firm's profile in one call.
 *
 * Writes everything the wizard collects for the CURRENT tenant:
 *   - tenant_settings (canonical): firm identity, domains, geography, spokesperson,
 *     practice_areas (jsonb)
 *   - brand_voice_settings (mirror, so getFirmContext picks up identity + voice)
 *   - practice_areas table (replace-all, so getPracticeAreas / content gen uses them)
 *
 * The content system prompt is handled separately by /api/brand-voice/system-prompt
 * (generate + save), so the wizard's last step reuses that.
 *
 * All writes go through getTenantDb (RLS-enforced, tenant_id auto-stamped).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const db = await getTenantDb();

  // ---- 1) Firm identity + config → tenant_settings (canonical) ----
  // Map of incoming field → tenant_settings column. Only provided strings written.
  const COLS: Record<string, string> = {
    firmName: "firm_name",
    firmWebsite: "firm_website",
    firmEmail: "firm_email",
    firmPhone: "firm_phone",
    firmAddress: "firm_address",
    targetGeography: "target_geography",
    firmSpokesperson: "firm_spokesperson",
    seoDomain: "seo_domain",
    gscSiteUrl: "gsc_site_url",
    brandColor: "brand_primary_color",
    logoUrl: "logo_url",
  };
  const settingsPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [field, col] of Object.entries(COLS)) {
    if (field in body) settingsPatch[col] = str(body[field]) || null;
  }

  // Practice areas (deduped, trimmed) → both the jsonb column and the table.
  const seen = new Set<string>();
  const areas: string[] = [];
  if (Array.isArray(body.practiceAreas)) {
    for (const item of body.practiceAreas) {
      const label = str(item);
      if (!label || label.length > 80) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      areas.push(label);
      if (areas.length >= 50) break;
    }
  }
  if (areas.length > 0) {
    settingsPatch.practice_areas = areas.map((label) => ({ id: slugify(label), label }));
  }

  const { error: tsErr } = await db.upsert("tenant_settings", [settingsPatch], {
    onConflict: "tenant_id",
  });
  if (tsErr) return NextResponse.json({ error: tsErr.message }, { status: 500 });

  // ---- 2) Mirror identity + voice into brand_voice_settings (for getFirmContext) ----
  const BV_KEYS = [
    "firmName",
    "firmWebsite",
    "firmEmail",
    "firmPhone",
    "firmAddress",
    "targetGeography",
    "firmSpokesperson",
    "brandVoice",
    "toneOfVoice",
    "keyMessages",
  ];
  const bvRows = BV_KEYS.filter((k) => k in body).map((k) => ({ key: k, value: str(body[k]) }));
  if (bvRows.length > 0) {
    const { error: bvErr } = await db.upsert("brand_voice_settings", bvRows, {
      onConflict: "tenant_id,key",
    });
    if (bvErr) return NextResponse.json({ error: bvErr.message }, { status: 500 });
  }

  // ---- 3) practice_areas table — replace-all so content gen reads them ----
  if (areas.length > 0) {
    const { error: delErr } = await db
      .from("practice_areas")
      .delete()
      .eq("tenant_id", db.tenantId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: insErr } = await db.insert(
      "practice_areas",
      areas.map((label, i) => ({ label, sort_order: i })),
    );
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
