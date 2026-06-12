/**
 * Review-generation API — create / preview / send outbound review requests,
 * and read the funnel. Tenant-scoped via RLS (getTenantClient inside the lib).
 *
 *   GET                      → { requests, funnel, messaging }
 *   POST { action:'create' } → insert queued requests from recipients[]
 *   POST { action:'preview' }→ AI-draft (+ compliance) one request, persist draft
 *   POST { action:'send' }   → compliance-gate + dispatch one request
 */

import { NextResponse, type NextRequest } from "next/server";

import { messagingStatus } from "@/lib/messaging";
import {
  createReviewRequests,
  generateRequestMessage,
  listReviewRequests,
  sendReviewRequest,
  type NewRecipient,
  type ReviewRequest,
  type ReviewRequestStatus,
} from "@/lib/review-requests";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";

/** Tracked-link origin: explicit app URL wins (stable behind proxies), else
 *  the request's own origin. */
function originFor(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
}

function funnelOf(requests: ReviewRequest[]) {
  const counts: Record<ReviewRequestStatus, number> = {
    queued: 0,
    sent: 0,
    clicked: 0,
    posted: 0,
    failed: 0,
  };
  for (const r of requests) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const requests = await listReviewRequests();
    return NextResponse.json({
      requests,
      funnel: funnelOf(requests),
      messaging: messagingStatus(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ requests: [], error: message }, { status: 500 });
  }
}

const VALID_CHANNELS = new Set(["email", "sms"]);

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action = String(body.action ?? "");

  try {
    if (action === "create") {
      const raw = Array.isArray(body.recipients) ? body.recipients : [];
      const recipients: NewRecipient[] = [];
      for (const r of raw as Array<Record<string, unknown>>) {
        const contact = String(r.recipient_contact ?? "").trim();
        const channel = String(r.channel ?? "");
        if (!contact || !VALID_CHANNELS.has(channel)) continue;
        recipients.push({
          recipient_contact: contact,
          channel: channel as NewRecipient["channel"],
          recipient_name: r.recipient_name ? String(r.recipient_name) : null,
          practice_area: r.practice_area ? String(r.practice_area) : null,
          source: r.source === "csv" ? "csv" : "manual",
        });
      }
      if (recipients.length === 0) {
        return NextResponse.json(
          { error: "No valid recipients (need recipient_contact + channel)." },
          { status: 400 },
        );
      }
      const created = await createReviewRequests(recipients);
      return NextResponse.json({ created, count: created.length });
    }

    if (action === "preview") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const { supabase } = await getTenantClient();
      const { data: request } = await supabase
        .from("review_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!request) {
        return NextResponse.json({ error: "Request not found." }, { status: 404 });
      }
      const r = request as ReviewRequest;
      const reviewLink = `${originFor(req).replace(/\/$/, "")}/r/${r.token}`;
      const gen = await generateRequestMessage({
        recipientName: r.recipient_name,
        practiceArea: r.practice_area,
        channel: r.channel,
        reviewLink,
      });
      // Persist the draft so the staff preview and the eventual send agree.
      await supabase
        .from("review_requests")
        .update({ subject: gen.subject, message: gen.body })
        .eq("id", r.id);
      return NextResponse.json({
        id: r.id,
        subject: gen.subject,
        body: gen.body,
        compliance: gen.compliance,
        reviewLink,
      });
    }

    if (action === "send") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const outcome = await sendReviewRequest({
        id,
        origin: originFor(req),
        message: body.message ? String(body.message) : undefined,
        subject: body.subject ? String(body.subject) : undefined,
      });
      if (outcome.error && !outcome.request) {
        return NextResponse.json({ error: outcome.error }, { status: 400 });
      }
      return NextResponse.json({
        request: outcome.request,
        compliance: outcome.compliance ?? null,
        error: outcome.error ?? null,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action || "(none)"}` },
      { status: 400 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
