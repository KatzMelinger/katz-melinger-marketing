/**
 * Review-generation workflow — the WRITE loop that complements review
 * monitoring. Creates outbound review requests, AI-personalizes the ask in the
 * firm's brand voice, runs it through the same attorney-advertising compliance
 * engine as every other outbound surface, sends via the channel abstraction
 * (lib/messaging), and tracks the funnel.
 *
 * Compliance is ADVISORY — same as everywhere else in the app
 * (lib/content-compliance). Every send returns its compliance result so the UI
 * can surface violations/warnings to staff, but it never blocks the send.
 *
 * NO sentiment gating — every recipient is sent to the same public Google
 * review form. We never pre-screen for happy customers (Google review policy +
 * FTC Rule on reviews, 16 CFR 465).
 */

import { randomUUID } from "node:crypto";

import {
  cachedSystemPrompt,
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
} from "@/lib/anthropic";
import {
  checkContentCompliance,
  type ContentComplianceResult,
} from "@/lib/content-compliance";
import { getFirmContext } from "@/lib/firm-context";
import { dispatch, type SendChannel } from "@/lib/messaging";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getTenantClient } from "@/lib/tenant-db";

export type ReviewRequestStatus =
  | "queued"
  | "sent"
  | "clicked"
  | "posted"
  | "failed";

export type ReviewRequest = {
  id: string;
  recipient_name: string | null;
  recipient_contact: string;
  channel: SendChannel;
  practice_area: string | null;
  status: ReviewRequestStatus;
  token: string;
  subject: string | null;
  message: string | null;
  source: "manual" | "csv";
  provider: string | null;
  provider_id: string | null;
  error: string | null;
  sent_at: string | null;
  clicked_at: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
};

const SMS_MAX_CHARS = 320;

/** A URL-safe, unguessable token for the tracked redirect (/r/<token>). */
function newToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * The public destination the tracked link 302s to. Prefer a full review URL if
 * the firm configured one; otherwise build the standard Google "write a review"
 * deep link from a Place ID. Returns null if neither is set — the redirect
 * route turns that into a friendly "not configured" response rather than a dead
 * link.
 */
export function reviewDestinationUrl(): string | null {
  const explicit = process.env.GOOGLE_REVIEW_URL?.trim();
  if (explicit) return explicit;
  const placeId = process.env.GOOGLE_PLACE_ID?.trim();
  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// AI message generation
// ---------------------------------------------------------------------------

export type GeneratedMessage = {
  subject: string | null; // null for SMS
  body: string;
  compliance: ContentComplianceResult | null;
};

/**
 * Draft a personalized review request in the firm's brand voice, with the
 * tracked review link worked in, then run an advisory compliance pass.
 *
 * `reviewLink` is the /r/<token> URL (built by the caller from the request
 * origin) — never the raw Google link, so every click is tracked.
 */
export async function generateRequestMessage(input: {
  recipientName: string | null;
  practiceArea: string | null;
  channel: SendChannel;
  reviewLink: string;
}): Promise<GeneratedMessage> {
  const firm = await getFirmContext();
  const isSms = input.channel === "sms";

  const system = `You are drafting a short, warm message asking a former client of a NY/NJ plaintiff-side employment law firm to leave an honest Google review. ${firm}

Hard constraints — not optional:
1. This is an ask for an HONEST review. Never imply we only want positive reviews, never offer anything of value in exchange, never pressure.
2. No guarantees, no claims about results or outcomes, no superlatives ("best", "top", "#1"), no specialist/expert claims.
3. Do not confirm or describe the substance of their legal matter. Keep it general ("thank you for trusting us").
4. Identify the firm by name. Use the firm contact info verbatim — never invent any.
5. Include the review link EXACTLY as given, on its own line. Do not alter or shorten it.
6. Plain, sincere, professional. No emojis.${
    isSms
      ? `\n7. SMS: ONE short paragraph, under ${SMS_MAX_CHARS} characters TOTAL including the link. No subject line.`
      : `\n7. EMAIL: a subject line, then 2 short paragraphs. End with the firm name.`
  }

${
  isSms
    ? `Return ONLY the SMS text (which must contain the link). No preface.`
    : `Return ONLY a JSON object: {"subject": "...", "body": "..."}. No markdown fences, no preface. The body must contain the link on its own line.`
}`;

  const user = `Recipient name: ${input.recipientName?.trim() || "(unknown — use a generic, warm greeting)"}
Practice area (context only — do NOT describe their matter): ${input.practiceArea?.trim() || "Employment law (general)"}
Review link (use verbatim): ${input.reviewLink}

Draft the ${isSms ? "SMS" : "email"}.`;

  const resp = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 700,
    system: cachedSystemPrompt(system),
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";

  let subject: string | null = null;
  let body: string;
  if (isSms) {
    body = text.trim().replace(/^["']|["']$/g, "");
  } else {
    // Tolerate a stray fence or prose around the JSON.
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      subject =
        typeof parsed?.subject === "string" ? parsed.subject.trim() : null;
      body =
        typeof parsed?.body === "string" ? parsed.body.trim() : text.trim();
    } catch {
      body = text.trim();
    }
  }

  // Safety net: if the model dropped the link, append it so the ask is never
  // a dead end. (The compliance pass and staff preview still apply.)
  if (!body.includes(input.reviewLink)) {
    body = `${body}\n\n${input.reviewLink}`;
  }

  // Advisory compliance pass. A review-request message is a client
  // solicitation — same obligations as a marketing email (RPC 7.3, labeling).
  const compliance = await checkContentCompliance({
    content: subject ? `${subject}\n\n${body}` : body,
    surface: "email",
    practiceArea: input.practiceArea ?? undefined,
  }).catch((err) => {
    console.warn("[review-requests] Compliance check failed:", err);
    return null;
  });

  return { subject, body, compliance };
}

/** True if a compliance result carries any HIGH-severity violation. */
export function hasHighSeverityViolation(
  c: ContentComplianceResult | null,
): boolean {
  return Boolean(c?.violations?.some((v) => v.severity === "high"));
}

// ---------------------------------------------------------------------------
// Data access (tenant-scoped via RLS)
// ---------------------------------------------------------------------------

export type NewRecipient = {
  recipient_name?: string | null;
  recipient_contact: string;
  channel: SendChannel;
  practice_area?: string | null;
  source?: "manual" | "csv";
};

/** Insert queued requests (one per recipient), each with a fresh token. */
export async function createReviewRequests(
  recipients: NewRecipient[],
): Promise<ReviewRequest[]> {
  if (recipients.length === 0) return [];
  const { supabase, tenantId } = await getTenantClient();
  const payload = recipients.map((r) => ({
    tenant_id: tenantId,
    recipient_name: r.recipient_name?.trim() || null,
    recipient_contact: r.recipient_contact.trim(),
    channel: r.channel,
    practice_area: r.practice_area?.trim() || null,
    source: r.source ?? "manual",
    status: "queued" as const,
    token: newToken(),
  }));
  const { data, error } = await supabase
    .from("review_requests")
    .insert(payload)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as ReviewRequest[];
}

export async function listReviewRequests(): Promise<ReviewRequest[]> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("review_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReviewRequest[];
}

async function getReviewRequest(id: string): Promise<ReviewRequest | null> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("review_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReviewRequest) ?? null;
}

// ---------------------------------------------------------------------------
// Send (with compliance gate)
// ---------------------------------------------------------------------------

export type SendOutcome = {
  request: ReviewRequest | null;
  /** Advisory compliance result for the sent copy — surfaced to staff, never
   *  blocks the send. */
  compliance?: ContentComplianceResult | null;
  error?: string;
};

/**
 * Generate (if needed), send, and record the outcome for one request. `origin`
 * is the request origin used to build the tracked link. Pass `message`/
 * `subject` to send staff-edited copy.
 *
 * Compliance is advisory: the result is computed and returned so the UI can
 * flag violations, but it does not block the send (matching every other
 * outbound surface in the app).
 */
export async function sendReviewRequest(input: {
  id: string;
  origin: string;
  message?: string;
  subject?: string;
}): Promise<SendOutcome> {
  const request = await getReviewRequest(input.id);
  if (!request) return { request: null, error: "Request not found." };
  if (request.status === "sent" || request.status === "clicked" || request.status === "posted") {
    return { request, error: `Already ${request.status}.` };
  }

  const reviewLink = `${input.origin.replace(/\/$/, "")}/r/${request.token}`;

  // Use staff-edited copy if provided, else generate fresh.
  let subject = input.subject ?? request.subject;
  let body = input.message ?? request.message ?? "";
  let compliance: ContentComplianceResult | null = null;

  if (input.message) {
    // Re-check edited copy.
    compliance = await checkContentCompliance({
      content: subject ? `${subject}\n\n${body}` : body,
      surface: "email",
      practiceArea: request.practice_area ?? undefined,
    }).catch(() => null);
  } else {
    const gen = await generateRequestMessage({
      recipientName: request.recipient_name,
      practiceArea: request.practice_area,
      channel: request.channel,
      reviewLink,
    });
    subject = gen.subject;
    body = gen.body;
    compliance = gen.compliance;
  }

  // Compliance is advisory — `compliance` is returned to the caller for display
  // but never blocks the send (consistent with the rest of the app).
  const result = await dispatch(request.channel, {
    to: request.recipient_contact,
    subject: subject ?? undefined,
    body,
  });

  const failed = result.status === "failed";
  const { supabase } = await getTenantClient();
  const { data: updated, error } = await supabase
    .from("review_requests")
    .update({
      status: failed ? "failed" : "sent",
      subject,
      message: body,
      provider: result.provider,
      provider_id: result.id,
      error: failed ? (result.error ?? "send failed") : null,
      sent_at: failed ? null : new Date().toISOString(),
    })
    .eq("id", request.id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    request: (updated as ReviewRequest) ?? request,
    compliance,
    error: failed ? result.error : undefined,
  };
}

// ---------------------------------------------------------------------------
// Click tracking (public — NO session, service-role by token)
// ---------------------------------------------------------------------------

/**
 * Record a click on a tracked review link and return the destination URL.
 * Runs in the public /r/<token> route with no auth, so it looks up by the
 * globally-unique secret token via the service-role client. Idempotent: a
 * re-click of an already-posted/clicked request just returns the destination.
 */
export async function recordReviewRequestClick(
  token: string,
): Promise<{ destination: string | null; found: boolean }> {
  const destination = reviewDestinationUrl();
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("review_requests")
    .select("id, status")
    .eq("token", token)
    .maybeSingle();
  if (!data) return { destination, found: false };

  // Only advance the funnel forward (queued/sent → clicked); never downgrade
  // a request already marked posted.
  if (data.status !== "posted") {
    await supabase
      .from("review_requests")
      .update({ status: "clicked", clicked_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return { destination, found: true };
}
