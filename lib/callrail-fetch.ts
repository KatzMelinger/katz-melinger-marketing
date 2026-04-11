const CALLS_FIELDS =
  "id,customer_name,customer_phone_number,tracking_phone_number,duration,answered,source_name,start_time,first_call,lead_status";

export type CallRailCall = {
  id: string;
  customer_name: string | null;
  customer_phone_number: string | null;
  tracking_phone_number: string | null;
  duration: number | null;
  answered: boolean;
  source_name: string | null;
  start_time: string;
  first_call: boolean;
  lead_status: string | null;
};

type CallRailCallsResponse = {
  page?: number;
  per_page?: number;
  total_pages?: number;
  total_records?: number;
  calls?: CallRailCall[];
};

function callsListUrl(accountId: string, page: number): string {
  const url = new URL(
    `https://api.callrail.com/v3/a/${encodeURIComponent(accountId)}/calls.json`
  );
  url.searchParams.set("per_page", "250");
  url.searchParams.set("fields", CALLS_FIELDS);
  url.searchParams.set("page", String(page));
  return url.toString();
}

export type FetchCallsResult =
  | { ok: true; calls: CallRailCall[]; totalPages: number }
  | { ok: false; error: string };

export async function fetchCallRailCallsPage(
  apiKey: string,
  accountId: string,
  page: number
): Promise<FetchCallsResult> {
  try {
    const res = await fetch(callsListUrl(accountId, page), {
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

export async function fetchAllCallRailCalls(
  apiKey: string,
  accountId: string
): Promise<FetchCallsResult> {
  const all: CallRailCall[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const result = await fetchCallRailCallsPage(apiKey, accountId, page);
    if (!result.ok) {
      return result;
    }
    all.push(...result.calls);
    totalPages = result.totalPages;
    page += 1;
  }

  return { ok: true, calls: all, totalPages };
}
