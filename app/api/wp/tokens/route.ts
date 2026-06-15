/**
 * POST /api/wp/tokens
 *   body: { domain: string, label?: string }
 *
 * Creates a new bearer token bound to the given domain. The raw token is
 * returned in the response *once* — only the sha256 hash is stored. The
 * marketer pastes the raw token into the WordPress plugin's settings.
 *
 * GET /api/wp/tokens?domain=... returns the list of tokens for a domain
 * (without their raw values) so the dashboard can show / revoke them.
 *
 * DELETE /api/wp/tokens?id=... revokes a token (soft delete: sets revoked_at).
 *
 * Auth: relies on the dashboard's existing session auth. We don't add a
 * separate gate here — anyone with access to the dashboard can manage tokens.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import {
  generateToken,
  hashToken,
  normalizeDomain,
} from "@/lib/wp-autopilot";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    domain?: unknown;
    label?: unknown;
  };
  const rawDomain = typeof body.domain === "string" ? body.domain : "";
  const label = typeof body.label === "string" ? body.label : null;
  if (!rawDomain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }
  const domain = normalizeDomain(rawDomain);
  if (!domain.includes(".")) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  }

  const token = generateToken();
  const tokenHash = hashToken(token);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("wp_autopilot_tokens")
    .insert({ domain, token_hash: tokenHash, label, tenant_id: await resolveTenantId() })
    .select("id, domain, label, created_at")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "create failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    id: data.id,
    domain: data.domain,
    label: data.label,
    created_at: data.created_at,
    token, // shown ONCE
    note: "Save this token now — it cannot be retrieved later.",
  });
}

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const url = new URL(req.url);
  const domainParam = url.searchParams.get("domain") ?? "";
  const sb = getSupabaseAdmin();
  let q = sb
    .from("wp_autopilot_tokens")
    .select("id, domain, label, last_used_at, revoked_at, created_at")
    .eq("tenant_id", await resolveTenantId())
    .order("created_at", { ascending: false });
  if (domainParam) q = q.eq("domain", normalizeDomain(domainParam));
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tokens: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("wp_autopilot_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
