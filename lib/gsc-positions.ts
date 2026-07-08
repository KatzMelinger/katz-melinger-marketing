/**
 * Google Search Console per-URL positions, persisted to gsc_page_positions.
 *
 * Feeds the cannibalization step the real position that splits Optimize
 * (ranks > 20) from Update (top 20). Degrades to an empty map whenever GSC
 * isn't connected (no service account / OAuth token) or the query fails, so the
 * pipeline transparently falls back to the DataForSEO rank.
 */

import { getGoogleAccessToken } from "./google-access-token";
import { getTenantJobDb } from "./tenant-db";
import { normalizeUrlForMatch } from "./wordpress";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type GscRow = {
  keys?: string[];
  position?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
};

/**
 * Returns normalized-URL → average position over the last 28 days, and
 * upserts the snapshot into gsc_page_positions. Empty map when GSC is not
 * available — callers must treat "no entry" as "no position signal".
 */
export async function fetchGscPositionMap(
  tenantId: string,
  gscSiteUrl: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!gscSiteUrl) return map;

  const auth = await getGoogleAccessToken([GSC_SCOPE], tenantId);
  if ("error" in auth) return map; // GSC not connected — silent fallback.

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    gscSiteUrl,
  )}/searchAnalytics/query`;

  let rows: GscRow[] = [];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(start),
        endDate: ymd(end),
        dimensions: ["page"],
        rowLimit: 1000,
        orderBy: [{ field: "clicks", sortOrder: "descending" }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return map;
    const json = (await res.json()) as { rows?: GscRow[] };
    rows = json.rows ?? [];
  } catch {
    return map;
  }

  const now = new Date().toISOString();
  const persistRows: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const page = r.keys?.[0];
    if (!page || typeof r.position !== "number") continue;
    map.set(normalizeUrlForMatch(page), r.position);
    persistRows.push({
      page_url: page,
      position: r.position,
      clicks: r.clicks ?? null,
      impressions: r.impressions ?? null,
      ctr: r.ctr ?? null,
      captured_at: now,
    });
  }

  if (persistRows.length > 0) {
    try {
      await getTenantJobDb(tenantId).upsert("gsc_page_positions", persistRows, {
        onConflict: "tenant_id,page_url",
      });
    } catch {
      /* persistence is best-effort — the in-memory map is what the run uses */
    }
  }
  return map;
}
