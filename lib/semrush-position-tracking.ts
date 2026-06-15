/**
 * Push keywords INTO a Semrush Position Tracking campaign (two-way sync).
 *
 * Read sync (Semrush -> Huraqan) is the CSV import + the domain_organic
 * refresh cron. This module is the reverse: when keywords are added in
 * Huraqan, mirror them into the firm's Semrush campaign so Semrush's
 * dashboards / position history / reports stay in sync.
 *
 * API: PUT https://api.semrush.com/management/v1/projects/{campaignID}/keywords
 *      body: { keywords: [{ keyword, tags? }] }
 *      cost: 100 API units per keyword added.
 *
 * SAFETY: pushing spends real API units, so auto-push is OFF unless
 * SEMRUSH_PUSH_ENABLED === "true". The one-time bulk push additionally
 * requires an explicit confirm flag on its endpoint.
 */

const MANAGEMENT_BASE = "https://api.semrush.com/management/v1";

/**
 * The firm's Position Tracking campaign ID. The API expects the FULL campaign
 * id, usually "<projectId>_<campaignId>" (e.g. 29122727_4545594 from the CSV
 * export). Override via env without a code change once verified.
 */
export const SEMRUSH_CAMPAIGN_ID =
  process.env.SEMRUSH_CAMPAIGN_ID?.trim() || "29114708";

/** Push keywords in chunks to keep request bodies sane. */
const CHUNK_SIZE = 100;

export function isSemrushPushEnabled(): boolean {
  return (
    process.env.SEMRUSH_PUSH_ENABLED === "true" &&
    Boolean(process.env.SEMRUSH_API_KEY?.trim()) &&
    Boolean(SEMRUSH_CAMPAIGN_ID)
  );
}

export type PushResult = {
  ok: boolean;
  pushed: number;
  attempted: number;
  unitsSpent: number; // 100 per keyword the API accepted
  error?: string;
};

/**
 * Add keywords to the configured Position Tracking campaign. De-dupes and
 * trims input. Returns a structured result; never throws.
 */
export async function pushKeywordsToCampaign(
  keywords: string[],
): Promise<PushResult> {
  const key = process.env.SEMRUSH_API_KEY?.trim();
  const campaignId = SEMRUSH_CAMPAIGN_ID;
  const clean = Array.from(
    new Set(keywords.map((k) => k.trim()).filter(Boolean)),
  );
  const base: PushResult = {
    ok: true,
    pushed: 0,
    attempted: clean.length,
    unitsSpent: 0,
  };
  if (clean.length === 0) return base;
  if (!key) return { ...base, ok: false, error: "SEMRUSH_API_KEY not set" };
  if (!campaignId)
    return { ...base, ok: false, error: "SEMRUSH_CAMPAIGN_ID not set" };

  let pushed = 0;
  for (let i = 0; i < clean.length; i += CHUNK_SIZE) {
    const chunk = clean.slice(i, i + CHUNK_SIZE);
    const url = `${MANAGEMENT_BASE}/projects/${encodeURIComponent(
      campaignId,
    )}/keywords?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: chunk.map((keyword) => ({ keyword })) }),
      });
      const text = await res.text();
      if (!res.ok || text.trim().startsWith("ERROR")) {
        return {
          ok: false,
          pushed,
          attempted: clean.length,
          unitsSpent: pushed * 100,
          error: `Semrush ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      pushed += chunk.length;
    } catch (e) {
      return {
        ok: false,
        pushed,
        attempted: clean.length,
        unitsSpent: pushed * 100,
        error: e instanceof Error ? e.message : "push failed",
      };
    }
  }

  return {
    ok: true,
    pushed,
    attempted: clean.length,
    unitsSpent: pushed * 100,
  };
}
