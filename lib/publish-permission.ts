/**
 * Who may press Publish (Oct 20 spec, decisions; Kenneth, 2026-10-20: a
 * narrow "can publish" permission rather than full Admin).
 *
 * A person may publish when they are an Admin, or when their email is in the
 * Brand setting `publishers` (a JSON list or a comma list). Diana gets the
 * permission by being added there; she does not need Admin, which would also
 * open Settings and Integrations. Every publish is logged with who and when
 * (metadata.publish_log and the audit trail).
 */
import { getSupabaseAdmin } from "./supabase-server";
import type { SessionUser } from "./supabase-route";

export function parsePublishers(value: string | null | undefined): string[] {
  const v = (value ?? "").trim();
  if (!v) return [];
  let list: unknown = null;
  try {
    list = JSON.parse(v);
  } catch {
    list = v.split(/[,;\n]/);
  }
  return Array.isArray(list)
    ? [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => /@/.test(x)))]
    : [];
}

export async function loadPublishers(tenantId: string): Promise<string[]> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("brand_voice_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "publishers")
      .maybeSingle();
    return parsePublishers((data?.value as string | null) ?? null);
  } catch {
    return [];
  }
}

export async function canPublish(user: SessionUser | null, tenantId: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  return (await loadPublishers(tenantId)).includes((user.email ?? "").trim().toLowerCase());
}

export type PublishLogEntry = { action: "queued" | "go_live" | "rollback" | "published"; by: string; at: string };

/** Append to metadata.publish_log (who published what, when). */
export function withPublishLog(meta: Record<string, unknown>, entry: PublishLogEntry): Record<string, unknown> {
  const log = Array.isArray(meta.publish_log) ? (meta.publish_log as PublishLogEntry[]) : [];
  return { ...meta, publish_log: [...log, entry].slice(-50) };
}
