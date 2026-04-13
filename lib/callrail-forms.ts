export type CallRailFormSubmission = {
  id: string;
  form_name?: string | null;
  customer_name?: string | null;
  customer_phone_number?: string | null;
  customer_email?: string | null;
  source?: string | null;
  source_name?: string | null;
  submitted_at?: string | null;
  lead_status?: string | null;
};

type FormSubmissionsResponse = {
  page?: number;
  per_page?: number;
  total_pages?: number;
  form_submissions?: CallRailFormSubmission[];
};

function listUrl(accountId: string, page: number): string {
  const url = new URL(
    `https://api.callrail.com/v3/a/${encodeURIComponent(accountId)}/form_submissions.json`,
  );
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  return url.toString();
}

export type FetchFormsResult =
  | { ok: true; submissions: CallRailFormSubmission[] }
  | { ok: false; error: string };

export async function fetchAllFormSubmissions(
  apiKey: string,
  accountId: string,
): Promise<FetchFormsResult> {
  const all: CallRailFormSubmission[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const res = await fetch(listUrl(accountId, page), {
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
          error: `CallRail forms ${res.status}: ${text.slice(0, 400)}`,
        };
      }
      const data = (await res.json()) as FormSubmissionsResponse;
      const batch = Array.isArray(data.form_submissions)
        ? data.form_submissions
        : [];
      all.push(...batch);
      totalPages = Math.max(1, data.total_pages ?? 1);
      page += 1;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  return { ok: true, submissions: all };
}
