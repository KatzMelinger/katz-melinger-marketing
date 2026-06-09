/**
 * Disavow workflow state, persisted in Supabase.
 *
 * Google's Disavow Links Tool doesn't have an API — every submission is a
 * manual file upload to Search Console. This table tracks our half of the
 * workflow: which toxic domains have been submitted, which need outreach,
 * and which we've decided aren't actually a problem ("safe").
 *
 * The Disavow Manager on /seo/backlinks reads + writes via the
 * /api/seo/backlinks/disavow route.
 */

import { getTenantClient } from "./tenant-db";

export type DisavowStatus = "pending" | "disavowed" | "outreach_sent" | "safe";

export type DisavowAction = {
  domain: string;
  status: DisavowStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export async function listDisavowActions(): Promise<DisavowAction[]> {
  const { supabase: sb } = await getTenantClient();
  const { data, error } = await sb
    .from("seo_disavow_actions")
    .select("domain, status, notes, created_at, updated_at");
  if (error || !data) return [];
  return (data as Array<{
    domain: string;
    status: DisavowStatus;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }>).map((r) => ({
    domain: r.domain,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export type UpsertResult = { ok: boolean; domain: string; status?: DisavowStatus; reason?: string };

export async function setDisavowStatus(
  rawDomain: string,
  status: DisavowStatus,
  notes?: string | null,
): Promise<UpsertResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes(".")) {
    return { ok: false, domain, reason: "Invalid domain" };
  }
  const { supabase: sb, tenantId } = await getTenantClient();
  const { error } = await sb
    .from("seo_disavow_actions")
    .upsert(
      {
        domain,
        status,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
        tenant_id: tenantId,
      },
      { onConflict: "tenant_id,domain" },
    );
  if (error) return { ok: false, domain, reason: error.message };
  return { ok: true, domain, status };
}

export async function clearDisavowAction(rawDomain: string): Promise<UpsertResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, domain, reason: "Invalid domain" };
  const { supabase: sb } = await getTenantClient();
  const { error } = await sb
    .from("seo_disavow_actions")
    .delete()
    .eq("domain", domain);
  if (error) return { ok: false, domain, reason: error.message };
  return { ok: true, domain };
}
