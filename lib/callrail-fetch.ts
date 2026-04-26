/**
 * CallRail API client.
 *
 * Two query modes:
 *   - List view (used by /calls dashboard): minimal fields, paginates fast.
 *   - Detailed view (used by sync + sales-coach): includes recording URL,
 *     CallRail-provided transcription, voicemail flag, agent email, etc.
 *
 * VM detection: CallRail surfaces a `voicemail` boolean. A call can be both
 * `answered=true` (the system picked up) and `voicemail=true` (the caller
 * left a message), or `answered=false` for a true missed call. The UI shows
 * three statuses: Answered / Voicemail / Missed.
 */

const LIST_FIELDS =
  "id,customer_name,customer_phone_number,tracking_phone_number,duration,answered,voicemail,direction,source_name,start_time,first_call,lead_status,agent_email";

const DETAIL_FIELDS = [
  "id",
  "customer_name",
  "customer_phone_number",
  "customer_city",
  "customer_state",
  "customer_country",
  "tracking_phone_number",
  "duration",
  "answered",
  "voicemail",
  "direction",
  "source_name",
  "start_time",
  "first_call",
  "lead_status",
  "agent_email",
  "value",
  "tags",
  "note",
  "keywords",
  "recording",
  "recording_player",
  "recording_duration",
  "transcription",
].join(",");

export type CallRailCall = {
  id: string;
  customer_name: string | null;
  customer_phone_number: string | null;
  customer_city?: string | null;
  customer_state?: string | null;
  customer_country?: string | null;
  tracking_phone_number: string | null;
  duration: number | null;
  answered: boolean;
  voicemail?: boolean;
  direction?: string | null;
  source_name: string | null;
  start_time: string;
  first_call: boolean;
  lead_status: string | null;
  agent_email?: string | null;
  value?: number | string | null;
  tags?: string[] | null;
  note?: string | null;
  keywords?: string | null;
  recording?: string | null;            // signed audio URL (expires)
  recording_player?: string | null;     // hosted player URL
  recording_duration?: number | null;
  transcription?: string | null;        // CallRail-provided transcript
};

type CallRailCallsResponse = {
  page?: number;
  per_page?: number;
  total_pages?: number;
  total_records?: number;
  calls?: CallRailCall[];
};

function callsListUrl(accountId: string, page: number, fields: string, since?: string): string {
  const url = new URL(
    `https://api.callrail.com/v3/a/${encodeURIComponent(accountId)}/calls.json`
  );
  url.searchParams.set("per_page", "250");
  url.searchParams.set("fields", fields);
  url.searchParams.set("page", String(page));
  if (since) {
    // ISO 8601 — CallRail accepts a `start_date` filter.
    url.searchParams.set("start_date", since);
  }
  return url.toString();
}

export type FetchCallsResult =
  | { ok: true; calls: CallRailCall[]; totalPages: number }
  | { ok: false; error: string };

async function fetchPage(
  apiKey: string,
  accountId: string,
  page: number,
  fields: string,
  since?: string
): Promise<FetchCallsResult> {
  try {
    const res = await fetch(callsListUrl(accountId, page, fields, since), {
      headers: {
        Authorization: `Token token=${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `CallRail request failed (${res.status}): ${text.slice(0, 500)}`,
      };
    }

    const data = (await res.json()) as CallRailCallsResponse;
    const calls = Array.isArray(data.calls) ? data.calls : [];
    const totalPages = Math.max(1, data.total_pages ?? 1);
    return { ok: true, calls, totalPages };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: message };
  }
}

export async function fetchCallRailCallsPage(
  apiKey: string,
  accountId: string,
  page: number
): Promise<FetchCallsResult> {
  return fetchPage(apiKey, accountId, page, LIST_FIELDS);
}

export async function fetchAllCallRailCalls(
  apiKey: string,
  accountId: string
): Promise<FetchCallsResult> {
  const all: CallRailCall[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await fetchPage(apiKey, accountId, page, LIST_FIELDS);
    if (!result.ok) return result;
    all.push(...result.calls);
    totalPages = result.totalPages;
    page += 1;
  }
  return { ok: true, calls: all, totalPages };
}

/**
 * Detailed sync — pulls recording URLs + transcription text.
 * If `since` is provided (ISO date), only fetches calls on or after that date.
 */
export async function fetchAllCallRailCallsDetailed(
  apiKey: string,
  accountId: string,
  since?: string
): Promise<FetchCallsResult> {
  const all: CallRailCall[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await fetchPage(apiKey, accountId, page, DETAIL_FIELDS, since);
    if (!result.ok) return result;
    all.push(...result.calls);
    totalPages = result.totalPages;
    page += 1;
    if (page > 50) break; // safety: 250 calls × 50 pages = 12,500 cap per sync
  }
  return { ok: true, calls: all, totalPages };
}

/** Fetch one call with full detail. */
export async function fetchCallRailCall(
  apiKey: string,
  accountId: string,
  callId: string
): Promise<{ ok: true; call: CallRailCall } | { ok: false; error: string }> {
  const url = new URL(
    `https://api.callrail.com/v3/a/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(callId)}.json`
  );
  url.searchParams.set("fields", DETAIL_FIELDS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Token token=${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `CallRail call fetch failed (${res.status}): ${text.slice(0, 500)}` };
    }
    const call = (await res.json()) as CallRailCall;
    return { ok: true, call };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/** Compute the human-readable status label: Answered | Voicemail | Missed. */
export function callStatusLabel(call: Pick<CallRailCall, "answered" | "voicemail">): "Answered" | "Voicemail" | "Missed" {
  if (call.voicemail === true) return "Voicemail";
  if (call.answered === true) return "Answered";
  return "Missed";
}
