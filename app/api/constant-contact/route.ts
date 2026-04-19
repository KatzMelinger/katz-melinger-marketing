import { NextResponse, type NextRequest } from "next/server";

import {
  authHeaders,
  CONSTANT_CONTACT_API_BASE,
  fetchContactListsResponse,
  getAuthConfig,
  parseJsonSafe,
  syncContactsToList,
  type ConstantContactApiErrorBody,
} from "@/lib/constant-contact-server";
import {
  fetchAnalyticsResponse,
  recordSyncActivityServer,
} from "@/lib/constant-contact-analytics";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Subset of fields returned for email campaigns in list responses. */
export type EmailCampaignSummary = {
  campaign_id?: string;
  name?: string;
  current_status?: string | Record<string, unknown>;
  email_subject?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

/** Typical GET /emails JSON body from Constant Contact v3. */
export type EmailsListApiResponse = {
  email_campaigns?: EmailCampaignSummary[];
  campaigns?: EmailCampaignSummary[];
  _links?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Activity object for POST /emails (custom code and other formats). */
export type EmailCampaignActivityInput = {
  format_type: number;
  from_name: string;
  from_email: string;
  reply_to_email: string;
  subject: string;
  html_content?: string;
  preheader?: string;
  physical_address_in_footer?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Body for creating a campaign via POST /emails. */
export type CreateEmailCampaignBody = {
  name: string;
  email_campaign_activities: EmailCampaignActivityInput[];
  [key: string]: unknown;
};

/** Successful create response (subset). */
export type CreateEmailCampaignResponse = {
  campaign_id?: string;
  name?: string;
  current_status?: string;
  campaign_activities?: Array<{ role?: string; campaign_activity_id?: string }>;
  [key: string]: unknown;
};

function normalizeCampaignsList(data: unknown): EmailCampaignSummary[] {
  if (!data || typeof data !== "object") return [];
  const o = data as EmailsListApiResponse;
  if (Array.isArray(o.email_campaigns)) return o.email_campaigns;
  if (Array.isArray(o.campaigns)) return o.campaigns;
  return [];
}

const AUTOMATION_TRIGGERS = [
  "intake_complete",
  "case_closed",
  "settlement_reached",
] as const;

type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

function countSequenceLines(sequence: string): number {
  return sequence
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function isAutomationTrigger(v: string): v is AutomationTrigger {
  return (AUTOMATION_TRIGGERS as readonly string[]).includes(v);
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  if (action === "lists") {
    return fetchContactListsResponse();
  }

  if (action === "analytics") {
    return fetchAnalyticsResponse();
  }

  if (
    action != null &&
    action !== "" &&
    action !== "campaigns" &&
    action !== "lists" &&
    action !== "analytics" &&
    action !== "automation"
  ) {
    return NextResponse.json(
      { error: `Unknown action: ${action}. Use campaigns, lists, automation, or analytics.` },
      { status: 400 },
    );
  }

  if (action === "automation") {
    const sb = getSupabaseServer();
    if (!sb) {
      return NextResponse.json(
        { error: "Supabase is not configured", rules: [] },
        { status: 503 },
      );
    }

    const { data, error } = await sb
      .from("constant_contact_automation")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      const msg = error.message.toLowerCase();
      const missingTable =
        msg.includes("does not exist") ||
        msg.includes("schema cache") ||
        msg.includes("could not find the table") ||
        (msg.includes("relation") && msg.includes("does not exist"));
      if (missingTable) {
        return NextResponse.json({
          rules: [] as unknown[],
          needsSchema: true as const,
          message:
            "The constant_contact_automation table was not found. Run scripts/constant-contact-automation.sql in the Supabase SQL editor.",
        });
      }
      return NextResponse.json(
        { error: error.message, rules: [] },
        { status: 500 },
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const rules = rows.map((row: Record<string, unknown>) => {
      const email_sequence =
        typeof row.email_sequence === "string" ? row.email_sequence : "";
      return {
        ...row,
        sequence_count: countSequenceLines(email_sequence),
      };
    });

    return NextResponse.json({ rules });
  }

  const config = getAuthConfig();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 503 });
  }

  const url = `${CONSTANT_CONTACT_API_BASE}/emails`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: authHeaders(config.accessToken),
    });

    const body = await parseJsonSafe(res);

    if (!res.ok) {
      const err = body as ConstantContactApiErrorBody;
      const message =
        err?.error_message ??
        (typeof err?.error_key === "string" ? err.error_key : null) ??
        `Constant Contact API error (${res.status})`;
      return NextResponse.json(
        {
          error: message,
          status: res.status,
          details: body,
        },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const data = body as EmailsListApiResponse;
    const campaigns = normalizeCampaignsList(body);
    return NextResponse.json({
      campaigns,
      ...(data._links ? { _links: data._links } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch Constant Contact campaigns", details: message },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const record = payload as Record<string, unknown>;

  if (record.action === "create_automation") {
    const name =
      typeof record.name === "string" ? record.name.trim() : "";
    const triggerRaw =
      typeof record.trigger_type === "string"
        ? record.trigger_type.trim()
        : "";
    const email_sequence =
      typeof record.email_sequence === "string" ? record.email_sequence : "";
    const active =
      typeof record.active === "boolean" ? record.active : true;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!triggerRaw || !isAutomationTrigger(triggerRaw)) {
      return NextResponse.json(
        {
          error: `trigger_type must be one of: ${AUTOMATION_TRIGGERS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const sb = getSupabaseServer();
    if (!sb) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 },
      );
    }

    const insertRow = {
      name,
      trigger_type: triggerRaw,
      email_sequence,
      active,
    };

    const { data, error } = await sb
      .from("constant_contact_automation")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      const msg = error.message.toLowerCase();
      const missingTable =
        msg.includes("does not exist") ||
        msg.includes("schema cache") ||
        msg.includes("could not find the table") ||
        (msg.includes("relation") && msg.includes("does not exist"));
      if (missingTable) {
        return NextResponse.json(
          {
            error:
              "Table constant_contact_automation not found. Run scripts/constant-contact-automation.sql in Supabase.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const seq =
      typeof row.email_sequence === "string" ? row.email_sequence : "";
    return NextResponse.json({
      rule: {
        ...row,
        sequence_count: countSequenceLines(seq),
      },
    });
  }

  const config = getAuthConfig();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 503 });
  }

  if (record.action === "sync_contacts") {
    const listId =
      typeof record.list_id === "string" ? record.list_id.trim() : "";
    if (!listId) {
      return NextResponse.json(
        { error: "list_id is required for sync_contacts" },
        { status: 400 },
      );
    }

    const result = await syncContactsToList(listId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    await recordSyncActivityServer(
      listId,
      result.synced,
      result.last_sync_at,
      result.message,
    );

    return NextResponse.json({
      success: true,
      message: result.message,
      synced: result.synced,
      last_sync_at: result.last_sync_at,
      list_id: listId,
    });
  }

  const url = `${CONSTANT_CONTACT_API_BASE}/emails`;

  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(config.accessToken),
      body: JSON.stringify(payload),
    });

    const body = await parseJsonSafe(res);

    if (!res.ok) {
      const err = body as ConstantContactApiErrorBody;
      const message =
        err?.error_message ??
        (typeof err?.error_key === "string" ? err.error_key : null) ??
        `Constant Contact API error (${res.status})`;
      return NextResponse.json(
        {
          error: message,
          status: res.status,
          details: body,
        },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    return NextResponse.json(body as CreateEmailCampaignResponse, {
      status: 201,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create Constant Contact campaign", details: message },
      { status: 502 },
    );
  }
}
