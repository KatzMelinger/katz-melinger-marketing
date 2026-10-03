/**
 * Live intake records for the Intake & Sales dashboard, read straight from
 * Katz Melinger's Airtable "Intake Form Data" table (the system of record;
 * nothing here goes through a synced copy).
 *
 * Only intakes created on or after DASHBOARD_SINCE are read. Results are
 * cached in memory for a few minutes so filter changes don't refetch.
 */

const BASE = process.env.AIRTABLE_INTAKE_BASE_ID?.trim() || "appXNqmZ6ECzxVCDL";
const TABLE = "Intake Form Data";
const CACHE_MS = 5 * 60 * 1000;

/** The dashboard's data starts here (decision 2026-10-03). */
export const DASHBOARD_SINCE = "2026-01-01";

const FIELDS = [
  "Name",
  "Date Created",
  "Case Status",
  "Case Category",
  "Case Quality",
  "Source",
  "Primary Phone",
  "Legal Assistant # 1",
  "Attorney/Reviewer",
  "Scheduled Calls",
  "Consult_Scheduled",
  "Engagement Letter Sent Date",
  "Engagement_Letter_Sent",
  "Retained Date",
  "Stamped Decline Reason",
  "Last Stage Change",
  "Follow-Up Notes",
] as const;

export type IntakeRecord = {
  id: string;
  /** Exact time the record was created in Airtable (ISO). */
  createdAt: string;
  name: string | null;
  status: string | null;
  category: string | null;
  quality: "High" | "Medium" | "Low" | null;
  source: string | null;
  phone: string | null;
  /** Current values. Airtable swaps both to matter staff at signing. */
  legalAssistant: string | null;
  reviewer: string | null;
  hadSalesCall: boolean;
  letterSentAt: string | null;
  retainedAt: string | null;
  declineReason: string | null;
  lastStageChange: string | null;
  followUpNotes: string | null;
};

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && !Array.isArray(v) && "name" in v) return text((v as { name: unknown }).name);
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/** "1 High" / "2 Medium" / "3 Low" → High / Medium / Low */
function quality(v: unknown): IntakeRecord["quality"] {
  const t = text(v)?.toLowerCase() ?? "";
  if (t.includes("high")) return "High";
  if (t.includes("medium")) return "Medium";
  if (t.includes("low")) return "Low";
  return null;
}

function toRecord(r: { id: string; createdTime: string; fields: Record<string, unknown> }): IntakeRecord {
  const f = r.fields;
  const scheduled = Array.isArray(f["Scheduled Calls"]) && (f["Scheduled Calls"] as unknown[]).length > 0;
  return {
    id: r.id,
    createdAt: r.createdTime,
    name: text(f["Name"]),
    status: text(f["Case Status"]),
    category: text(f["Case Category"]),
    quality: quality(f["Case Quality"]),
    source: text(f["Source"]),
    phone: text(f["Primary Phone"]),
    legalAssistant: text(f["Legal Assistant # 1"]),
    reviewer: text(f["Attorney/Reviewer"]),
    hadSalesCall: scheduled || text(f["Consult_Scheduled"]) != null,
    letterSentAt: text(f["Engagement Letter Sent Date"]) ?? text(f["Engagement_Letter_Sent"]),
    retainedAt: text(f["Retained Date"]),
    declineReason: text(f["Stamped Decline Reason"]),
    lastStageChange: text(f["Last Stage Change"]),
    followUpNotes: typeof f["Follow-Up Notes"] === "string" ? (f["Follow-Up Notes"] as string) : null,
  };
}

let cache: { at: number; rows: IntakeRecord[] } | null = null;

export async function listDashboardIntakes(opts: { fresh?: boolean } = {}): Promise<IntakeRecord[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const token = process.env.AIRTABLE_API_TOKEN?.trim();
  if (!token) throw new Error("AIRTABLE_API_TOKEN is not configured");

  const rows: IntakeRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    for (const f of FIELDS) url.searchParams.append("fields[]", f);
    url.searchParams.set("filterByFormula", `IS_AFTER({Date Created}, DATEADD('${DASHBOARD_SINCE}', -1, 'days'))`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      records: { id: string; createdTime: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    rows.push(...json.records.map(toRecord));
    offset = json.offset;
  } while (offset);

  cache = { at: Date.now(), rows };
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Status buckets (same grouping as the CMS owners intake funnel)             */
/* -------------------------------------------------------------------------- */

export type Outcome = "signed" | "referred" | "declined" | "active";

const DECLINED = new Set([
  "Decline - Firm",
  "Decline - Client Reject",
  "Decline - For Now",
  "Decline - Not a Fit",
  "Decline - Client No Show",
  "Decline - No Response to Engagement Letter",
  "Declined - Notice Sent",
  "Closed - Withdrawal",
]);

export function outcomeOf(status: string | null): Outcome {
  if (status === "Moved to Matters DB") return "signed";
  if (status === "Decline - Referred") return "referred";
  if (status && DECLINED.has(status)) return "declined";
  return "active";
}
