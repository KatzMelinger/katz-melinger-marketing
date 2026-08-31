/**
 * Telling someone when a draft is blocked or a serious finding is raised.
 *
 * Detection without notification is the gap Diana's B4 describes: the FMLA
 * issues were found, written down, and then sat unseen for ten days. Every
 * piece of that loop existed except the last one — nothing announced a hold.
 *
 * Two events are worth interrupting someone for:
 *   - a draft held by a gate (compliance or freshness), because it has stopped
 *     moving and will stay stopped until a person acts;
 *   - a new CRITICAL or IMPORTANT finding, because those are the ones that
 *     block or change what gets published.
 *
 * Advisory findings deliberately do not notify. A readability nit is real work
 * but it is not news, and a channel that fires on everything gets muted — at
 * which point the blocked drafts go unseen again, just for a different reason.
 *
 * In-app goes to `marketing_alerts`, the inbox the app already has, so this
 * needs no new surface and no new table. Email goes through dispatch(), which
 * stubs cleanly when Resend is not configured — so this works end to end in dev
 * without provisioning, and a missing key never breaks an approval.
 *
 * Everything here is best-effort and never throws: failing to send a
 * notification must not fail the gate that produced it.
 */

import { writeAlert } from "./alerts-engine";
import { recordAuditEvent } from "./content-findings-store";
import { dispatch } from "./messaging";
import { getSupabaseAdmin } from "./supabase-server";
import type { NormalizedFinding } from "./content-findings";
import { reviewersFor } from "./legal-reviewers";


/** Where the app lives, for links in emails. */
function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

/**
 * Who hears about this draft: its owner, plus the standing reviewers.
 *
 * "The owner and the designated reviewer" maps onto what the app actually
 * models — the board row's owner, and ADMIN_EMAILS, which is already the
 * app's notion of who is accountable. If a draft has no owner the admins still
 * get it, because an unowned blocked draft is the one most likely to be lost.
 */
async function recipientsFor(draftId: string, tenantId: string): Promise<string[]> {
  const emails = new Set<string>();
  try {
    const sb = getSupabaseAdmin();
    const { data: rows } = await sb
      .from("content_pipeline")
      .select("owner_user_id")
      .eq("draft_id", draftId)
      .eq("tenant_id", tenantId)
      .limit(1);
    const ownerId = (rows ?? [])[0]?.owner_user_id as string | undefined;
    if (ownerId) {
      const { data: users } = await sb
        .from("app_users")
        .select("email")
        .eq("user_id", ownerId)
        .limit(1);
      const email = (users ?? [])[0]?.email as string | undefined;
      if (email) emails.add(email.toLowerCase());
    }
  } catch (e) {
    console.warn("[notify] owner lookup failed:", e);
  }

  for (const raw of (process.env.ADMIN_EMAILS ?? "").split(",")) {
    const email = raw.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

async function sendEmails(to: string[], subject: string, body: string): Promise<number> {
  let sent = 0;
  for (const address of to) {
    try {
      const result = await dispatch("email", { to: address, subject, body });
      if (result.status !== "failed") sent += 1;
      else console.warn(`[notify] email to ${address} failed:`, result.error);
    } catch (e) {
      console.warn(`[notify] email to ${address} threw:`, e);
    }
  }
  return sent;
}

async function draftTitle(draftId: string): Promise<string> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("content_drafts")
      .select("title, topic")
      .eq("id", draftId)
      .maybeSingle();
    const row = data as { title?: string | null; topic?: string | null } | null;
    return row?.title?.trim() || row?.topic?.trim() || "Untitled draft";
  } catch {
    return "Untitled draft";
  }
}

/**
 * A gate has held a draft at needs_legal.
 *
 * Deduped per draft per hold reason: the gates re-run on every approve attempt,
 * and a fresh alert each time would bury the first one. `writeAlert` skips a
 * duplicate while any non-archived alert with the same key is live, so the
 * notification returns once the reviewer has cleared it and it happens again.
 */
export async function notifyDraftBlocked(args: {
  draftId: string;
  tenantId: string;
  reason: "compliance" | "freshness";
  detail: string;
}): Promise<void> {
  try {
    const title = await draftTitle(args.draftId);
    const url = `${appBaseUrl()}/content-production`;
    const heading =
      args.reason === "compliance"
        ? "Held by the compliance gate"
        : "Held for time-sensitive figures";

    const wrote = await writeAlert(
      {
        type: "content_blocked",
        severity: "high",
        source: "content",
        title: `${heading}: ${title}`,
        body: args.detail,
        payload: { draft_id: args.draftId, reason: args.reason },
        dedupeKey: `blocked:${args.draftId}:${args.reason}`,
      },
      args.tenantId,
    );

    // writeAlert returning false means an identical live alert already exists.
    // The email follows the alert: if we did not raise it, we do not re-send.
    if (!wrote) return;

    const to = await recipientsFor(args.draftId, args.tenantId);
    const sent = await sendEmails(
      to,
      `[Huraqan] ${heading}: ${title}`,
      `${heading}.\n\n${title}\n\n${args.detail}\n\nThis draft will not publish until it is resolved.\n\n${url}`,
    );

    await recordAuditEvent({
      tenantId: args.tenantId,
      draftId: args.draftId,
      event: "notified_blocked",
      detail: { reason: args.reason, recipients: to.length, emails_sent: sent },
    });
  } catch (e) {
    console.warn("[notify] blocked notification failed:", e);
  }
}

/**
 * New findings worth interrupting for. Advisory ones are skipped — see the
 * module note. Called with only the findings that were newly INSERTED, so a
 * finding already on the board does not re-notify on every analysis run.
 */
export async function notifyNewFindings(args: {
  draftId: string;
  tenantId: string;
  findings: NormalizedFinding[];
}): Promise<void> {
  const notable = args.findings.filter(
    (f) => f.severity === "critical" || f.severity === "important",
  );
  if (notable.length === 0) return;

  try {
    const title = await draftTitle(args.draftId);
    const critical = notable.filter((f) => f.severity === "critical");
    const lines = notable.slice(0, 8).map((f) => `  • [${f.severity}] ${f.title}`);
    if (notable.length > lines.length) {
      lines.push(`  • …and ${notable.length - lines.length} more`);
    }
    const summary = lines.join("\n");
    const headline =
      critical.length > 0
        ? `${critical.length} critical finding${critical.length === 1 ? "" : "s"} on "${title}"`
        : `${notable.length} finding${notable.length === 1 ? "" : "s"} on "${title}"`;

    const wrote = await writeAlert(
      {
        type: "content_finding",
        severity: critical.length > 0 ? "high" : "medium",
        source: "content",
        title: headline,
        body: summary,
        payload: {
          draft_id: args.draftId,
          critical: critical.length,
          important: notable.length - critical.length,
        },
        // Keyed on the findings themselves, so a genuinely new problem raises a
        // new alert while a re-run of the same set stays quiet.
        dedupeKey: `findings:${args.draftId}:${notable
          .map((f) => f.fingerprint)
          .sort()
          .join(",")}`,
      },
      args.tenantId,
    );
    if (!wrote) return;

    const to = await recipientsFor(args.draftId, args.tenantId);
    const sent = await sendEmails(
      to,
      `[Huraqan] ${headline}`,
      `${headline}\n\n${summary}\n\n${appBaseUrl()}/content-production`,
    );

    await recordAuditEvent({
      tenantId: args.tenantId,
      draftId: args.draftId,
      event: "notified_findings",
      detail: {
        critical: critical.length,
        important: notable.length - critical.length,
        recipients: to.length,
        emails_sent: sent,
      },
    });
  } catch (e) {
    console.warn("[notify] finding notification failed:", e);
  }
}

/**
 * A draft is held for legal review — tell the attorney who owns it.
 *
 * Diana's §5 routing: the practice-area attorney is notified, and the other two
 * are copied because any of them may clear it. A hold that only one person can
 * lift is a hold that waits for a holiday to end.
 */
export async function notifyLegalReview(args: {
  draftId: string;
  tenantId: string;
  practiceArea?: string | null;
  pillarId?: string | null;
  topic?: string | null;
  title?: string | null;
  criticalCount: number;
  summary: string;
}): Promise<void> {
  try {
    const title = await draftTitle(args.draftId);
    const reviewers = reviewersFor({
      practiceArea: args.practiceArea,
      pillarId: args.pillarId,
      topic: args.topic,
      title: args.title,
    });
    const owner = reviewers[0];
    const heading = `Legal review needed: ${title}`;

    const wrote = await writeAlert(
      {
        type: "content_blocked",
        severity: "high",
        source: "content",
        title: heading,
        body: `${args.criticalCount} legal finding(s) to clear. Assigned to ${owner?.name ?? "an attorney"}.

${args.summary}`,
        payload: { draft_id: args.draftId, reason: "legal", reviewer: owner?.id ?? null },
        dedupeKey: `blocked:${args.draftId}:legal`,
      },
      args.tenantId,
    );
    if (!wrote) return;

    // The owning attorney first, the other two as backup.
    const to = reviewers.map((r) => r.email).filter(Boolean);
    const sent = await sendEmails(
      to,
      `[Huraqan] ${heading}`,
      `${args.criticalCount} legal finding(s) need an attorney before this can be approved.

` +
        `Assigned to ${owner?.name ?? "an attorney"} (the other reviewers are copied and may also clear it).

` +
        `${args.summary}

${appBaseUrl()}/content-production`,
    );

    await recordAuditEvent({
      tenantId: args.tenantId,
      draftId: args.draftId,
      event: "notified_legal_review",
      detail: { reviewer: owner?.id ?? null, critical: args.criticalCount, emails_sent: sent },
    });
  } catch (e) {
    console.warn("[notify] legal review notification failed:", e);
  }
}
