/**
 * /api/current-facts
 *   GET — return the live current-facts list: { facts: CurrentFact[] } (ordered).
 *   PUT — replace the whole list. Body: { facts: CurrentFact[] }. Validates,
 *         drops incomplete rows, and stores in the given order per tenant.
 *
 * Backs the editor on /settings/current-facts and is read by the content
 * generators via lib/current-facts-store.getCurrentFacts().
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { CURRENT_FACTS, type CurrentFact } from "@/lib/current-facts";
import { getCurrentFacts } from "@/lib/current-facts-store";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FACTS = 100;
const MAX_LEN = 200;

const str = (v: unknown, max = MAX_LEN): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Value denominators the freshness matcher understands. */
const UNITS = new Set(["", "hour", "week", "year"]);

/** Empty string → null, so date/timestamptz columns don't get "" written to them. */
const nullIfBlank = (s: string): string | null => (s ? s : null);

const strArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
    : typeof v === "string"
      ? v.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

export async function GET() {
  try {
    const facts = await getCurrentFacts();
    return NextResponse.json({ facts });
  } catch {
    return NextResponse.json({ facts: [...CURRENT_FACTS] });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = (body as { facts?: unknown }).facts;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "facts must be an array" }, { status: 400 });
  }

  const seen = new Set<string>();
  const facts: CurrentFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = str(o.label);
    const value = str(o.value);
    // A row needs at least a label and a value to be meaningful.
    if (!label || !value) continue;
    // Derive a stable key from the id or the label.
    const id = (str(o.id) || label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const keywords = strArray(o.keywords);
    // Every field on CurrentFact is carried through, not just the five the
    // editor renders inputs for. This used to whitelist label/value/
    // jurisdiction/effectiveDate/keywords, so the FIRST save on this page
    // silently dropped unit, verifyOnly, reVerifyBy, sourceUrl, the derived
    // link, and the supersedes list — and because a non-empty table replaces
    // the code-seeded list wholesale, they were gone for good. That quietly
    // undid weekly-vs-annual matching, made the litigated federal threshold
    // auto-writable, and stopped re-verification dates from ever firing.
    const unitRaw = str(o.unit, 8).toLowerCase();
    const derivedRaw =
      o.derived && typeof o.derived === "object"
        ? (o.derived as Record<string, unknown>)
        : null;
    const derivedFrom = derivedRaw ? str(derivedRaw.fromFactId) : "";
    const derivedMultiplier = derivedRaw ? Number(derivedRaw.multiplier) : NaN;

    facts.push({
      id,
      label,
      value,
      jurisdiction: str(o.jurisdiction),
      effectiveDate: str(o.effectiveDate),
      keywords,
      unit: UNITS.has(unitRaw) ? unitRaw : "",
      sourceUrl: str(o.sourceUrl, 500),
      verifiedBy: str(o.verifiedBy),
      verifiedAt: str(o.verifiedAt, 40),
      reVerifyBy: str(o.reVerifyBy, 40),
      verifyOnly: o.verifyOnly === true,
      supersedes: strArray(o.supersedes),
      ...(derivedFrom && Number.isFinite(derivedMultiplier) && derivedMultiplier !== 0
        ? { derived: { fromFactId: derivedFrom, multiplier: derivedMultiplier } }
        : {}),
    });
    if (facts.length >= MAX_FACTS) break;
  }

  // Drop derived links that point at a fact not in this payload. Ids are
  // re-derived from the label, so renaming a source fact would otherwise leave
  // a dangling reference and the annual figure would silently stop recomputing.
  const ids = new Set(facts.map((f) => f.id));
  for (const f of facts) {
    if (f.derived && !ids.has(f.derived.fromFactId)) delete f.derived;
  }

  try {
    const sb = getSupabaseAdmin();
    const tid = await resolveTenantId();
    const { error: delErr } = await sb.from("current_facts").delete().eq("tenant_id", tid);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (facts.length > 0) {
      const rows = facts.map((f, i) => ({
        fact_key: f.id,
        label: f.label,
        value: f.value,
        jurisdiction: f.jurisdiction,
        effective_date: f.effectiveDate,
        keywords: f.keywords,
        // These columns are NOT NULL DEFAULT '' — write "" rather than null.
        unit: f.unit ?? "",
        source_url: f.sourceUrl ?? "",
        verified_by: f.verifiedBy ?? "",
        verify_only: f.verifyOnly === true,
        // Date / timestamptz columns are nullable — "" is not a valid value.
        verified_at: nullIfBlank(f.verifiedAt ?? ""),
        re_verify_by: nullIfBlank(f.reVerifyBy ?? ""),
        supersedes: f.supersedes ?? [],
        derived_from: f.derived?.fromFactId ?? null,
        derived_multiplier: f.derived?.multiplier ?? null,
        sort_order: i,
        tenant_id: tid,
      }));
      const { error: insErr } = await sb.from("current_facts").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ facts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save current facts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
