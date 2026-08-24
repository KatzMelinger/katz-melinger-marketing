/**
 * POST /api/content/drafts/[id]/certify
 *   body: { key: string, value: boolean }
 *
 * Records (or clears) one reviewer self-certification on a draft.
 *
 * The certifications used to be `useState(false)` in two different components:
 * the Production Board drawer ("Legal review complete", "Proofread and on
 * brand") and Publishing QA (five more). Nothing persisted, nothing carried a
 * name, and a refresh cleared them — so the boxes certified precisely nothing
 * while reading, to anyone looking at the screen, like a sign-off had happened.
 *
 * A certification is now a server-stamped record: who ticked it, and when. The
 * client sends only the key and the intent — the identity comes from the
 * session, so a certification cannot be attributed to someone else by editing
 * the request.
 *
 * The legal certification additionally REFUSES to be set while the draft's last
 * analysis has the attorney-advertising compliance check failing. That is the
 * narrow, buildable half of "a checkbox that does not depend on the actual
 * check is decorative" — the other half (a legal-accuracy verdict) does not
 * exist yet, and this deliberately does not pretend otherwise.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Certification keys, and which of them the compliance check gates. */
const CERTIFICATION_KEYS = [
  "legal_review",
  "proofread",
  "schema",
  "internal_links",
  "citations",
] as const;

type CertificationKey = (typeof CERTIFICATION_KEYS)[number];

/** Keys that cannot be ticked while the compliance check is failing. */
const COMPLIANCE_GATED: ReadonlySet<string> = new Set<CertificationKey>(["legal_review"]);

export type Certification = {
  by: string;
  by_email: string;
  at: string;
};

function isCertificationKey(v: unknown): v is CertificationKey {
  return typeof v === "string" && (CERTIFICATION_KEYS as readonly string[]).includes(v);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    key?: unknown;
    value?: unknown;
  };

  if (!isCertificationKey(body.key)) {
    return NextResponse.json(
      { error: `Unknown certification. Expected one of: ${CERTIFICATION_KEYS.join(", ")}.` },
      { status: 400 },
    );
  }
  const key = body.key;
  const value = body.value !== false;

  const { supabase, tenantId } = await getTenantClient();

  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("id, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refuse the legal tick while the automated compliance check is failing. Read
  // from the stored analysis rather than re-running the gate: this is a click,
  // and the gate is a multi-second model call that already runs at approve.
  if (value && COMPLIANCE_GATED.has(key)) {
    const { data: analyses } = await supabase
      .from("content_analyses")
      .select("compliance_status")
      .eq("draft_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    const complianceStatus = analyses?.[0]?.compliance_status as string | null | undefined;
    if (complianceStatus === "non_compliant" || complianceStatus === "needs_changes") {
      return NextResponse.json(
        {
          error:
            "The attorney-advertising check is failing on this draft — resolve it before certifying legal review.",
          compliance_status: complianceStatus,
        },
        { status: 409 },
      );
    }
  }

  const metadata = (draft.metadata as Record<string, unknown> | null) ?? {};
  const existing = (metadata.certifications as Record<string, Certification> | undefined) ?? {};
  const certifications = { ...existing };
  if (value) {
    certifications[key] = {
      by: user.id,
      by_email: user.email,
      at: new Date().toISOString(),
    };
  } else {
    delete certifications[key];
  }

  const { error: updateError } = await supabase
    .from("content_drafts")
    .update({ metadata: { ...metadata, certifications } })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ id, certifications });
}
