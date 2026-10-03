/**
 * Who handled a call.
 *
 * CallRail forwards every call to Vonage, so CallRail's agent_email is always
 * empty. The scorer instead reports the first name the Katz Melinger team
 * member uses on the call ("Thank you for calling Katz Melinger, this is
 * Alicia"). This module maps that name onto `sales_staff`.
 *
 * Two people can share a first name (Gabriel Moreno / Gabriel Olivares). When
 * the name alone is ambiguous we look up the caller's Airtable intake and pick
 * whichever candidate is its Legal Assistant # 1 or Attorney/Reviewer.
 *
 * Attribution never overwrites a stronger source: a call already attributed
 * from Vonage's call log or by hand keeps that attribution.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhone } from "@/lib/lead-response";

export type SalesStaff = {
  id: string;
  full_name: string;
  first_name: string;
  aliases: string[];
  email: string | null;
  initials: string | null;
  roles: string[];
};

export type StaffSource = "transcript" | "airtable" | "vonage" | "manual";

/** Sources that a transcript-based guess must never overwrite. */
const STRONGER_SOURCES: ReadonlySet<string> = new Set(["vonage", "manual"]);

export async function loadSalesStaff(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<SalesStaff[]> {
  const { data, error } = await supabase
    .from("sales_staff")
    .select("id, full_name, first_name, aliases, email, initials, roles")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("credit_eligible", true);
  if (error || !data) return [];
  return data as SalesStaff[];
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Every staff member whose first name, full name or alias matches. */
export function staffMatchingName(name: string, staff: SalesStaff[]): SalesStaff[] {
  const n = fold(name);
  if (!n) return [];
  return staff.filter(
    (s) =>
      fold(s.first_name) === n ||
      fold(s.full_name) === n ||
      s.aliases.some((a) => fold(a) === n),
  );
}

/* -------------------------------------------------------------------------- */
/* Airtable tie-break                                                         */
/* -------------------------------------------------------------------------- */

const AIRTABLE_INTAKE_BASE = process.env.AIRTABLE_INTAKE_BASE_ID?.trim() || "appXNqmZ6ECzxVCDL";
const AIRTABLE_INTAKE_TABLE = "Intake Form Data";

/**
 * Names on the caller's most recent Airtable intake. Before a case is signed
 * these are the intake person (Legal Assistant # 1) and the sales reviewer
 * (Attorney/Reviewer); at signing Airtable swaps both for matter staff, who
 * won't be in the candidate list, so a stale lookup simply fails to match.
 */
async function intakeStaffNames(phone: string): Promise<string[]> {
  const token = process.env.AIRTABLE_API_TOKEN?.trim();
  const digits = normalizePhone(phone);
  if (!token || !digits) return [];

  const url = new URL(
    `https://api.airtable.com/v0/${AIRTABLE_INTAKE_BASE}/${encodeURIComponent(AIRTABLE_INTAKE_TABLE)}`,
  );
  url.searchParams.set(
    "filterByFormula",
    `FIND('${digits}', REGEX_REPLACE({Primary Phone} & '', '[^0-9]', ''))`,
  );
  url.searchParams.append("fields[]", "Legal Assistant # 1");
  url.searchParams.append("fields[]", "Attorney/Reviewer");
  url.searchParams.append("sort[0][field]", "Date Created");
  url.searchParams.append("sort[0][direction]", "desc");
  url.searchParams.set("maxRecords", "1");

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { records?: { fields: Record<string, unknown> }[] };
    const fields = json.records?.[0]?.fields ?? {};
    return ["Legal Assistant # 1", "Attorney/Reviewer"]
      .map((f) => fields[f])
      .map((v) => (v && typeof v === "object" && "name" in v ? (v as { name: unknown }).name : v))
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                */
/* -------------------------------------------------------------------------- */

export type AttributionResult =
  | { staff: SalesStaff; source: StaffSource }
  | { staff: null; reason: "no_name" | "not_staff" | "ambiguous" | "kept_existing" };

/**
 * Resolve the detected name to one staff member and record it on the call.
 * Safe to call repeatedly; it only writes when it has a confident answer and
 * the call isn't already attributed from a stronger source.
 */
export async function attributeCall(params: {
  supabase: SupabaseClient;
  tenantId: string;
  callId: string;
  detectedName: string | null;
  customerPhone: string | null;
  currentSource: string | null;
  staff: SalesStaff[];
}): Promise<AttributionResult> {
  const { supabase, tenantId, callId, detectedName, customerPhone, currentSource, staff } = params;
  if (currentSource && STRONGER_SOURCES.has(currentSource)) {
    return { staff: null, reason: "kept_existing" };
  }
  if (!detectedName) return { staff: null, reason: "no_name" };

  let candidates = staffMatchingName(detectedName, staff);
  let source: StaffSource = "transcript";
  if (candidates.length === 0) return { staff: null, reason: "not_staff" };

  if (candidates.length > 1 && customerPhone) {
    const onIntake = new Set((await intakeStaffNames(customerPhone)).map(fold));
    const narrowed = candidates.filter((c) => onIntake.has(fold(c.full_name)));
    if (narrowed.length === 1) {
      candidates = narrowed;
      source = "airtable";
    }
  }
  if (candidates.length !== 1) return { staff: null, reason: "ambiguous" };

  const match = candidates[0];
  await supabase
    .from("calls")
    .update({ staff_id: match.id, staff_source: source })
    .eq("tenant_id", tenantId)
    .eq("id", callId);
  return { staff: match, source };
}
