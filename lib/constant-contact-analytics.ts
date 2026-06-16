import { NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { getSupabaseServer } from "@/lib/supabase-server";

import {
  ccAuthedFetch,
  CONSTANT_CONTACT_API_BASE,
  getAuthConfig,
  getConstantContactAuthUrl,
  parseJsonSafe,
  type ConstantContactApiErrorBody,
} from "@/lib/constant-contact-server";

function extractNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const p = Number(value);
    if (Number.isFinite(p)) return p;
  }
  return 0;
}

/** CC may return rate as 0–1 or 0–100 */
function normalizeRate(raw: number): number {
  if (raw <= 0) return 0;
  if (raw <= 1) return raw * 100;
  return Math.min(raw, 100);
}

export type CampaignPerformanceRow = {
  campaign_id: string;
  campaign_name: string;
  send_date: string | null;
  opens: number;
  clicks: number;
  emails_sent: number;
  open_rate: number;
  click_rate: number;
  unsubscribes: number;
};

export type SegmentRow = {
  segment_id: string;
  name: string;
  /** CC doesn't always return a count on the list endpoint — null when absent. */
  contact_count: number | null;
};

export type SyncActivityRow = {
  id?: string;
  list_id: string | null;
  synced_count: number;
  created_at: string;
  message?: string | null;
};

function normalizeCampaigns(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.email_campaigns)) return o.email_campaigns as Record<string, unknown>[];
  if (Array.isArray(o.campaigns)) return o.campaigns as Record<string, unknown>[];
  return [];
}

function parseCampaignRow(
  c: Record<string, unknown>,
  index: number,
): CampaignPerformanceRow {
  const campaign_id = String(c.campaign_id ?? `unknown-${index}`);
  const campaign_name = String(c.name ?? "Untitled");
  const sendRaw =
    c.last_sent_date ?? c.scheduled_date ?? c.updated_at ?? c.created_at ?? null;
  const send_date = typeof sendRaw === "string" ? sendRaw : null;

  const status =
    c.current_status && typeof c.current_status === "object"
      ? (c.current_status as Record<string, unknown>)
      : {};

  let opens = extractNumber(
    status.unique_opens ?? status.opens ?? c.unique_opens ?? c.opens,
  );
  let clicks = extractNumber(
    status.unique_clicks ?? status.clicks ?? c.unique_clicks ?? c.clicks,
  );
  const emails_sent = extractNumber(
    status.emails_sent ?? status.sends ?? status.send_count ?? c.emails_sent,
  );

  const unsubscribes = extractNumber(
    status.unsubscribes ??
      status.opt_outs ??
      status.unsubscribe_count ??
      status.opt_out_count ??
      c.unsubscribes ??
      c.opt_outs,
  );

  let open_rate = normalizeRate(
    extractNumber(status.open_rate ?? status.unique_open_rate ?? c.open_rate),
  );
  let click_rate = normalizeRate(
    extractNumber(status.click_rate ?? status.unique_click_rate ?? c.click_rate),
  );

  if (opens === 0 && emails_sent > 0 && open_rate > 0) {
    opens = Math.round((emails_sent * open_rate) / 100);
  }
  if (clicks === 0 && emails_sent > 0 && click_rate > 0) {
    clicks = Math.round((emails_sent * click_rate) / 100);
  }

  if (emails_sent > 0) {
    open_rate = (opens / emails_sent) * 100;
    click_rate = (clicks / emails_sent) * 100;
  } else if (opens > 0 || clicks > 0) {
    open_rate = open_rate || 0;
    click_rate = click_rate || 0;
  }

  return {
    campaign_id,
    campaign_name,
    send_date,
    opens,
    clicks,
    emails_sent,
    open_rate: Number.isFinite(open_rate) ? open_rate : 0,
    click_rate: Number.isFinite(click_rate) ? click_rate : 0,
    unsubscribes,
  };
}

type CampaignStats = {
  sends: number;
  opens: number;
  clicks: number;
  bounces: number;
  unsubscribes: number;
};

/**
 * Per-campaign performance stats. CC's /emails list carries only a status
 * string (no metrics), so opens/clicks/bounces/unsubscribes come from the
 * summary-reports endpoint, keyed by campaign_id. Best-effort: returns an empty
 * map if the endpoint isn't available, leaving the /emails-derived fallback.
 */
async function fetchCampaignSummaries(): Promise<Map<string, CampaignStats>> {
  const map = new Map<string, CampaignStats>();
  try {
    const res = await ccAuthedFetch(
      `${CONSTANT_CONTACT_API_BASE}/reports/summary_reports/email_campaign_summaries?limit=500`,
    );
    if (!res.ok) return map;
    const body = await parseJsonSafe(res);
    const arr = Array.isArray((body as { bulk_email_campaign_summaries?: unknown }).bulk_email_campaign_summaries)
      ? ((body as { bulk_email_campaign_summaries: Record<string, unknown>[] }).bulk_email_campaign_summaries)
      : [];
    for (const s of arr) {
      const id = String(s.campaign_id ?? "");
      if (!id) continue;
      const u =
        s.unique_counts && typeof s.unique_counts === "object"
          ? (s.unique_counts as Record<string, unknown>)
          : {};
      map.set(id, {
        sends: extractNumber(u.sends),
        opens: extractNumber(u.opens),
        clicks: extractNumber(u.clicks),
        bounces: extractNumber(u.bounces),
        // CC names this field "optouts" (no underscore) on unique_counts.
        unsubscribes: extractNumber(u.optouts ?? u.opt_outs ?? u.unsubscribes),
      });
    }
  } catch {
    /* endpoint unavailable — fall back to /emails-derived values */
  }
  return map;
}

/** Fetch contact segments (names + counts where CC provides them). Best-effort:
 *  returns [] if the segments endpoint is unavailable on the account/plan. */
async function fetchSegments(): Promise<SegmentRow[]> {
  try {
    const res = await ccAuthedFetch(`${CONSTANT_CONTACT_API_BASE}/segments?limit=1000`);
    if (!res.ok) return [];
    const body = await parseJsonSafe(res);
    const arr = Array.isArray((body as { segments?: unknown }).segments)
      ? ((body as { segments: unknown[] }).segments as Record<string, unknown>[])
      : [];
    return arr.map((s) => ({
      segment_id: String(s.segment_id ?? s.id ?? ""),
      name: String(s.name ?? "Untitled segment"),
      contact_count:
        s.contact_count != null || s.member_count != null
          ? extractNumber(s.contact_count ?? s.member_count)
          : null,
    }));
  } catch {
    return [];
  }
}

async function fetchRevenuePlaceholder(): Promise<number> {
  const data = await fetchCmsJson<{ total?: number; attributed_total?: number }>(
    "/api/v1/revenue/attribution",
  );
  if (!data) return 0;
  const n = extractNumber(data.attributed_total ?? data.total);
  return n;
}

export async function recordSyncActivityServer(
  listId: string,
  synced: number,
  at: string,
  message?: string,
): Promise<void> {
  const sb = getSupabaseServer();
  if (!sb) return;
  await sb.from("constant_contact_sync_log").insert({
    list_id: listId,
    synced_count: synced,
    created_at: at,
    message: message ?? null,
  });
}

export async function fetchAnalyticsResponse(): Promise<NextResponse> {
  const cfg = await getAuthConfig();
  if ("error" in cfg) {
    return NextResponse.json(
      {
        error: cfg.error,
        status: 401,
        needsAuth: true,
        authUrl: getConstantContactAuthUrl("cc-reconnect"),
      },
      { status: 401 },
    );
  }

  const emailsUrl = `${CONSTANT_CONTACT_API_BASE}/emails?limit=500`;
  const listsUrl = `${CONSTANT_CONTACT_API_BASE}/contact_lists?limit=1000&include_membership_count=active`;

  try {
    const [emailsRes, listsRes, segments, summaries] = await Promise.all([
      ccAuthedFetch(emailsUrl),
      ccAuthedFetch(listsUrl),
      fetchSegments(),
      fetchCampaignSummaries(),
    ]);

    const emailsBody = await parseJsonSafe(emailsRes);
    const listsBody = await parseJsonSafe(listsRes);

    if (!emailsRes.ok) {
      const err = emailsBody as ConstantContactApiErrorBody;
      if (emailsRes.status === 401) {
        return NextResponse.json(
          {
            error:
              err?.error_message ??
              "Constant Contact token expired or revoked. Reconnect required.",
            status: 401,
            needsAuth: true,
            authUrl: getConstantContactAuthUrl("cc-reconnect"),
            details: emailsBody,
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        {
          error:
            err?.error_message ??
            (typeof err?.error_key === "string" ? err.error_key : null) ??
            `Constant Contact emails error (${emailsRes.status})`,
        },
        {
          status:
            emailsRes.status >= 400 && emailsRes.status < 600
              ? emailsRes.status
              : 502,
        },
      );
    }

    const rawCampaigns = normalizeCampaigns(emailsBody);
    const performance: CampaignPerformanceRow[] = rawCampaigns.map((c, i) => {
      const row = parseCampaignRow(c, i);
      // Overlay real stats from the summary-reports endpoint (the /emails list
      // carries no metrics). Keeps the /emails-derived row as the fallback.
      const s = summaries.get(row.campaign_id);
      if (s) {
        const opens = s.opens || row.opens;
        const clicks = s.clicks || row.clicks;
        const sends = s.sends || row.emails_sent;
        return {
          ...row,
          opens,
          clicks,
          emails_sent: sends,
          unsubscribes: s.unsubscribes,
          open_rate: sends > 0 ? (opens / sends) * 100 : row.open_rate,
          click_rate: sends > 0 ? (clicks / sends) * 100 : row.click_rate,
        };
      }
      return row;
    });

    let total_opens = 0;
    let total_clicks = 0;
    let total_sent = 0;
    let total_unsubscribes = 0;
    for (const row of performance) {
      total_opens += row.opens;
      total_clicks += row.clicks;
      total_sent += row.emails_sent;
      total_unsubscribes += row.unsubscribes;
    }

    const overall_open_rate =
      total_sent > 0 ? (total_opens / total_sent) * 100 : 0;
    const overall_click_rate =
      total_sent > 0 ? (total_clicks / total_sent) * 100 : 0;

    let total_contacts = 0;
    if (listsRes.ok && listsBody && typeof listsBody === "object") {
      const lists = Array.isArray((listsBody as { lists?: unknown }).lists)
        ? ((listsBody as { lists: unknown[] }).lists as Record<string, unknown>[])
        : [];
      for (const L of lists) {
        total_contacts += extractNumber(L.membership_count);
      }
    }

    let revenue_generated = 0;
    try {
      revenue_generated = await fetchRevenuePlaceholder();
    } catch {
      revenue_generated = 0;
    }

    let sync_activity: SyncActivityRow[] = [];
    const sbLog = getSupabaseServer();
    if (sbLog) {
      const { data: logData, error: logError } = await sbLog
        .from("constant_contact_sync_log")
        .select("id, list_id, synced_count, created_at, message")
        .order("created_at", { ascending: false })
        .limit(30);

      if (!logError && Array.isArray(logData)) {
        sync_activity = logData.map((row: Record<string, unknown>) => ({
          id: typeof row.id === "string" ? row.id : undefined,
          list_id: typeof row.list_id === "string" ? row.list_id : null,
          synced_count: extractNumber(row.synced_count),
          created_at:
            typeof row.created_at === "string"
              ? row.created_at
              : new Date().toISOString(),
          message: typeof row.message === "string" ? row.message : null,
        }));
      }
    }

    const generated_at = new Date().toISOString();

    return NextResponse.json({
      summary: {
        total_campaigns: performance.length,
        total_contacts,
        total_opens,
        total_clicks,
        total_sent,
        total_unsubscribes,
        total_segments: segments.length,
        overall_open_rate,
        overall_click_rate,
        revenue_generated,
      },
      campaigns: performance,
      segments,
      sync_activity,
      generated_at,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load analytics", details: message },
      { status: 502 },
    );
  }
}
