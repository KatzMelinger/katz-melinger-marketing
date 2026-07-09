/**
 * POST /api/content-production/email
 *
 * The Repurpose tab's "Generate email → Constant Contact" action. One click:
 *   1. generateMultiFormat() → a brand-voice email newsletter (subject +
 *      preview + scannable body), saved to content_drafts.
 *   2. If Constant Contact is connected and a from-address is configured, the
 *      email is wrapped in branded HTML and created as a DRAFT campaign in
 *      Constant Contact (format_type 5, same shape the CC page uses) — it lands
 *      in Drafts ready to preview / schedule / send.
 *
 * Degrades gracefully (mirrors the social→scheduler flow): if CC isn't
 * connected or NEXT_PUBLIC_CC_FROM_EMAIL isn't set, the draft is still
 * generated + saved and we say it wasn't pushed.
 */

import { NextResponse } from "next/server";
import { marked } from "marked";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { generateMultiFormat } from "@/lib/content-multiformat";
import {
  ccAuthedFetch,
  CONSTANT_CONTACT_API_BASE,
  getAuthConfig,
  parseJsonSafe,
} from "@/lib/constant-contact-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** CC custom-code emails need the [[trackingImage]] token for opens tracking. */
function ensureTrackingHtml(html: string): string {
  const trimmed = html.trim();
  if (trimmed.includes("[[trackingImage]]")) return trimmed;
  return `<html><body>[[trackingImage]]${trimmed}</body></html>`;
}

function brandedEmailHtml(firmName: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
  <div style="background:#116AB2;padding:16px 20px;color:#ffffff;font-size:18px;font-weight:bold">${firmName}</div>
  <div style="padding:20px;font-size:15px;line-height:1.6">${bodyHtml}</div>
</div>`;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    topic?: string;
    practiceArea?: string | null;
    sourceText?: string | null;
  };
  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  const db = await getTenantDb();

  // 1) Generate the email newsletter (saved to content_drafts).
  let draft: { id: string; title: string | null; body: string; metadata: Record<string, unknown> } | undefined;
  try {
    const gen = await generateMultiFormat({
      topic,
      practiceArea: body.practiceArea ?? undefined,
      formats: ["email"],
      sourceText: body.sourceText ?? undefined,
      tenantId: db.tenantId,
    });
    draft = gen.drafts.find((d) => d.format === "email") ?? gen.drafts[0];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 },
    );
  }

  const subject =
    (draft?.metadata?.subject as string | undefined)?.trim() || draft?.title?.trim() || topic;
  const preheader = (draft?.metadata?.preview_text as string | undefined) ?? undefined;

  // 2) Push to Constant Contact as a draft campaign (best-effort).
  const fromEmail = process.env.NEXT_PUBLIC_CC_FROM_EMAIL?.trim() || "";
  let ccPushed = false;
  let ccName: string | null = null;
  let ccError: string | null = null;

  if (!fromEmail) {
    ccError = "from-address not set (NEXT_PUBLIC_CC_FROM_EMAIL)";
  } else {
    const auth = await getAuthConfig();
    if ("error" in auth) {
      ccError = "Constant Contact not connected";
    } else {
      try {
        const cfg = await getTenantConfig(db.tenantId);
        const firmName = cfg.firmName || "Katz Melinger PLLC";
        const bodyHtml = marked.parse(draft?.body ?? "", { async: false }) as string;
        const html = ensureTrackingHtml(brandedEmailHtml(firmName, bodyHtml));
        // CC rejects duplicate campaign names — stamp with a timestamp.
        ccName = `${subject}`.slice(0, 70) + ` — ${new Date().toISOString().slice(0, 16)}`;
        const payload = {
          name: ccName,
          email_campaign_activities: [
            {
              format_type: 5,
              from_name: firmName,
              from_email: fromEmail,
              reply_to_email: fromEmail,
              subject,
              ...(preheader ? { preheader } : {}),
              html_content: html,
            },
          ],
        };
        const res = await ccAuthedFetch(`${CONSTANT_CONTACT_API_BASE}/emails`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const j = (await parseJsonSafe(res)) as { error_message?: string } | null;
        if (res.ok) {
          ccPushed = true;
        } else {
          ccError = j?.error_message ?? `Constant Contact error (${res.status})`;
        }
      } catch (e) {
        ccError = e instanceof Error ? e.message : "push failed";
      }
    }
  }

  const message = ccPushed
    ? `Email generated and created as a Constant Contact draft campaign — review & schedule it in Constant Contact → Campaigns.`
    : `Email draft generated and saved to Drafts.${ccError ? ` Not pushed to Constant Contact (${ccError}).` : ""}`;

  return NextResponse.json({
    ok: true,
    draft_id: draft?.id ?? null,
    subject,
    cc_pushed: ccPushed,
    cc_name: ccName,
    message,
  });
}
