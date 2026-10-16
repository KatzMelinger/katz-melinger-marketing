/**
 * Search Console query rows for the Radar's discovery and the Opportunities
 * gap tabs (Oct 6 spec, Tasks 16 and 18). One call per (dimensions, days),
 * cached for an hour per tenant, so six tabs do not make six calls.
 */
import { getGoogleAccessToken } from "./google-access-token";
import { getTenantConfig } from "./tenant-config";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type GscRow = {
  query: string;
  /** Present when the dimensions include "page". */
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscResult = { ok: true; rows: GscRow[]; fetchedAt: string } | { ok: false; error: string };

const cache = new Map<string, { at: number; value: GscResult }>();

export async function gscQueries(
  tenantId: string,
  opts: { days?: number; withPage?: boolean; rowLimit?: number } = {},
): Promise<GscResult> {
  const days = opts.days ?? 28;
  const withPage = opts.withPage ?? true;
  const key = `${tenantId}:${days}:${withPage}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.value;

  const { gscSiteUrl } = await getTenantConfig(tenantId);
  if (!gscSiteUrl) return { ok: false, error: "Search Console is not connected" };
  const auth = await getGoogleAccessToken([GSC_SCOPE], tenantId);
  if ("error" in auth) return { ok: false, error: "Search Console is not connected" };
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  try {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          dimensions: withPage ? ["query", "page"] : ["query"],
          rowLimit: opts.rowLimit ?? 25000,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return { ok: false, error: `Search Console returned ${res.status}` };
    const json = (await res.json()) as {
      rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[];
    };
    const rows: GscRow[] = (json.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? "",
      page: withPage ? r.keys?.[1] ?? null : null,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
    const value: GscResult = { ok: true, rows, fetchedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
