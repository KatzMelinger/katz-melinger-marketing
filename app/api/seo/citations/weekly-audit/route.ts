/**
 * Weekly citations re-audit (powers the in-app "This week" summary).
 *
 * GET  /api/seo/citations/weekly-audit — Vercel Cron (Bearer CRON_SECRET),
 *      scheduled Monday morning. Re-audits every linked listing and saves a
 *      consistency snapshot, so the summary + trend on /seo/citations refresh
 *      themselves without anyone clicking Audit. The results live on that page.
 * POST /api/seo/citations/weekly-audit — manual trigger for the signed-in
 *      tenant, to run the same refresh on demand.
 *
 * Email digest is OFF by default (the results are shown in-app). To also email
 * it, set CITATIONS_DIGEST_EMAIL=true (sends via the Resend adapter — needs
 * RESEND_API_KEY + RESEND_FROM; recipient override CITATIONS_DIGEST_TO).
 */

import { NextRequest, NextResponse } from "next/server";

import { dispatch } from "@/lib/messaging";
import {
  auditCitationsByLinks,
  listCitationSnapshots,
  listCitations,
  saveCitationSnapshot,
  type CitationRow,
  type CitationSnapshot,
} from "@/lib/seo-citations";
import { listDirectories } from "@/lib/seo-directories";
import { guardUser } from "@/lib/supabase-route";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DIGEST_TO = process.env.CITATIONS_DIGEST_TO?.trim() || "marketing@katzmelinger.com";
const EMAIL_ENABLED = process.env.CITATIONS_DIGEST_EMAIL?.trim() === "true";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

type Digest = { subject: string; text: string; stats: Record<string, number> };

function buildDigest(
  citations: CitationRow[],
  directoryStatuses: string[],
  snapshots: CitationSnapshot[],
  audited: number,
): Digest {
  const total = citations.length;
  const consistent = citations.filter((c) => c.status === "consistent").length;
  const inconsistent = citations.filter((c) => c.status === "inconsistent").length;
  const missing = citations.filter((c) => c.status === "missing").length;
  const unverified = citations.filter((c) => c.status === "unverified").length;
  const verifiable = consistent + inconsistent;
  const consistencyPct = verifiable ? Math.round((consistent / verifiable) * 100) : 0;

  // Trend vs the previous snapshot (snapshots are oldest→newest).
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const delta = prev ? consistencyPct - prev.consistency_pct : 0;
  const trendStr = prev
    ? ` (${delta > 0 ? "▲" : delta < 0 ? "▼" : "±"}${Math.abs(delta)} pts vs last week)`
    : "";

  const dirTotal = directoryStatuses.length;
  const dirDone = directoryStatuses.filter((s) => s === "listed" || s === "claimed").length;

  const needsFix = citations
    .filter((c) => c.status === "inconsistent" || c.status === "missing")
    .slice(0, 15);

  const lines: string[] = [];
  lines.push("Katz Melinger — Weekly Directories & Citations digest");
  lines.push("");
  lines.push(`NAP consistency: ${consistencyPct}%${trendStr}`);
  lines.push(`Verified consistent: ${consistent} of ${verifiable} checkable listing(s)`);
  lines.push(`Needs attention: ${inconsistent} inconsistent, ${missing} missing, ${unverified} unverified (couldn't auto-read)`);
  lines.push(`Directory coverage: ${dirDone} listed/claimed of ${dirTotal} tracked`);
  lines.push(`Re-audited ${audited} linked listing(s) this run.`);
  lines.push("");

  if (needsFix.length) {
    lines.push("Listings to fix:");
    for (const c of needsFix) {
      const why = c.status === "missing" ? "not listed / no NAP found" : c.issues || "NAP mismatch";
      lines.push(`- ${c.source}: ${why}`);
    }
    if (inconsistent + missing > needsFix.length) {
      lines.push(`…and ${inconsistent + missing - needsFix.length} more.`);
    }
    lines.push("");
  } else {
    lines.push("No inconsistent or missing listings this week. 🎉");
    lines.push("");
  }

  if (APP_URL) lines.push(`Open the full page: ${APP_URL}/seo/citations`);
  else lines.push("Open Directories & Citations in Huracán to fix each one.");

  const subject = `Citations digest — ${consistencyPct}% consistent, ${inconsistent + missing} need attention`;
  return {
    subject,
    text: lines.join("\n"),
    stats: { total, consistent, inconsistent, missing, unverified, consistencyPct, audited },
  };
}

async function runWeeklyAudit(tenantId: string) {
  // 1. Re-audit every linked listing (best-effort — still send the digest with
  //    whatever the current statuses are if the audit partially fails).
  let audited = 0;
  try {
    const res = await auditCitationsByLinks(tenantId);
    audited = res.results.length;
  } catch (e) {
    console.warn("[weekly-audit] link audit failed:", e);
  }
  // 2. Freeze today's snapshot for the trend.
  await saveCitationSnapshot(tenantId);

  // 3. Gather current state + build and send the digest.
  const [citations, directories, snapshots] = await Promise.all([
    listCitations(tenantId),
    listDirectories(tenantId).catch(() => []),
    listCitationSnapshots(8, tenantId),
  ]);
  const digest = buildDigest(
    citations,
    (directories as Array<{ status: string }>).map((d) => d.status),
    snapshots,
    audited,
  );
  // The results are shown on /seo/citations. Email is an opt-in extra.
  if (!EMAIL_ENABLED) {
    return { ...digest.stats, email: "disabled" as const };
  }
  const send = await dispatch("email", {
    to: DIGEST_TO,
    subject: digest.subject,
    body: digest.text,
  });
  return { ...digest.stats, recipient: DIGEST_TO, email: send.status, emailError: send.error ?? null };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWeeklyAudit(DEFAULT_TENANT_ID);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "weekly audit failed" },
      { status: 500 },
    );
  }
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const tenantId = await resolveTenantId();
    const result = await runWeeklyAudit(tenantId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "weekly audit failed" },
      { status: 500 },
    );
  }
}
