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
    const keywords = Array.isArray(o.keywords)
      ? o.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
      : typeof o.keywords === "string"
        ? (o.keywords as string).split(",").map((k) => k.trim()).filter(Boolean)
        : [];
    facts.push({
      id,
      label,
      value,
      jurisdiction: str(o.jurisdiction),
      effectiveDate: str(o.effectiveDate),
      keywords,
    });
    if (facts.length >= MAX_FACTS) break;
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
