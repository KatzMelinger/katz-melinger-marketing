/**
 * KM AutoPilot — server-side helpers for the WordPress plugin queue.
 *
 * Auth model: the plugin holds a bearer token issued by the dashboard. We
 * store only the sha256 of the token in `wp_autopilot_tokens.token_hash`,
 * so revoking is just `revoked_at = now()`. The plugin sends the raw token
 * in the `X-KM-AutoPilot-Token` header on every request.
 *
 * Domain scoping: every token is bound to one domain (e.g. katzmelinger.com).
 * The plugin can only fetch / write recommendations for its own domain.
 */

import { createHash, randomBytes } from "node:crypto";

import { getSupabaseAdmin } from "./supabase-server";

export type FixType =
  | "meta_title"
  | "meta_description"
  | "canonical"
  | "schema_jsonld"
  | "h1"
  | "og_title"
  | "og_description"
  | "internal_link_insert"
  | "alt_text";

export type FixStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "reverted";

export type AutoPilotRecommendation = {
  id: string;
  domain: string;
  page_url: string;
  fix_type: FixType;
  current_value: string | null;
  suggested_value: string;
  rationale: string;
  status: FixStatus;
  applied_at: string | null;
  applied_value: string | null;
  reverted_at: string | null;
  wp_post_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generate a new bearer token. Returns the raw token (show once, store hash). */
export function generateToken(): string {
  // 32 random bytes → 64-char hex; we prefix so it's recognizable.
  return `kmap_${randomBytes(32).toString("hex")}`;
}

/**
 * Look up a token by its raw value. Returns the bound domain if valid + not
 * revoked, otherwise null. Also touches last_used_at on success.
 */
export async function authenticateToken(token: string): Promise<{
  domain: string;
  tokenId: string;
  tenantId: string;
} | null> {
  if (!token || token.length < 16) return null;
  const sb = getSupabaseAdmin();
  const tokenHash = hashToken(token);
  const { data, error } = await sb
    .from("wp_autopilot_tokens")
    .select("id, domain, tenant_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;

  // Best-effort last_used_at update; failure is non-fatal.
  await sb
    .from("wp_autopilot_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  // The token is the tenant authority for plugin requests (no session cookie).
  return {
    domain: data.domain as string,
    tokenId: data.id as string,
    tenantId: data.tenant_id as string,
  };
}

/** Normalize a domain string for comparison (lowercase, strip protocol/www/path). */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export async function listRecommendations(args: {
  domain: string;
  tenantId: string;
  status?: FixStatus;
  limit?: number;
}): Promise<AutoPilotRecommendation[]> {
  const sb = getSupabaseAdmin();
  const domain = normalizeDomain(args.domain);
  let q = sb
    .from("wp_autopilot_recommendations")
    .select("*")
    .eq("tenant_id", args.tenantId)
    .eq("domain", domain)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 100);
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AutoPilotRecommendation[];
}

/**
 * Mark a recommendation as applied. Called by the plugin after it successfully
 * writes the change to WordPress. We require the recommendation to be in
 * 'approved' status — refuse to apply otherwise so a stale plugin can't
 * write changes the marketer hasn't sanctioned.
 */
export async function markApplied(args: {
  id: string;
  domain: string;
  tenantId: string;
  appliedValue: string;
  wpPostId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<AutoPilotRecommendation> {
  const sb = getSupabaseAdmin();
  const domain = normalizeDomain(args.domain);

  const { data: existing, error: lookupErr } = await sb
    .from("wp_autopilot_recommendations")
    .select("id, domain, status, metadata")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.id)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!existing) throw new Error("recommendation not found");
  if (existing.domain !== domain) throw new Error("domain mismatch");
  if (existing.status !== "approved") {
    throw new Error(
      `cannot apply recommendation in status='${existing.status}' — must be 'approved'`,
    );
  }

  const mergedMetadata = {
    ...(existing.metadata as Record<string, unknown> | null ?? {}),
    ...(args.metadata ?? {}),
  };

  const { data, error } = await sb
    .from("wp_autopilot_recommendations")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      applied_value: args.appliedValue,
      wp_post_id: args.wpPostId ?? null,
      metadata: mergedMetadata,
    })
    .eq("tenant_id", args.tenantId)
    .eq("id", args.id)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "update failed");
  return data as AutoPilotRecommendation;
}
