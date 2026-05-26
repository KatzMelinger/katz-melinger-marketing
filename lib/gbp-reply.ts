/**
 * Reply to Google Business Profile reviews — both AI-drafted text and the
 * actual PUT to Google's My Business v4 API.
 *
 * draftReply() uses Claude with the firm's Brand Voice context. The prompt
 * is intentionally measured: never argue, never disclose case details, never
 * make legal commitments, always include a "we'd welcome a private call"
 * offer for negative reviews.
 *
 * postReply() wraps `accounts/{}/locations/{}/reviews/{}/reply` (PUT).
 * Google requires the reply to be ≤ 4096 characters; we truncate defensively.
 */

import {
  cachedSystemPrompt,
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
} from "./anthropic";
import { getFirmContext } from "./firm-context";
import {
  GBP_MYBUSINESS_V4_BASE,
  GBP_OAUTH_SCOPE,
  gbpFetch,
} from "./gbp-http";
import { getGoogleAccessToken } from "./google-access-token";

export type ReviewToReply = {
  reviewId: string;
  author: string;
  rating: number; // 1–5
  comment: string;
  date: string;
};

const MAX_REPLY_CHARS = 4096;
const MAX_TARGET_CHARS = 900; // long enough to be substantive, short enough to feel personal

export async function draftReply(
  review: ReviewToReply,
): Promise<{ reply: string; usedModel: string }> {
  const firm = await getFirmContext();
  const system = `You are drafting public replies to Google Business Profile reviews for a NY/NJ plaintiff-side employment law firm. ${firm}

Constraints — these are not optional:
1. Never argue with the reviewer or call them mistaken. Empathy first.
2. Never disclose, confirm, or deny that anyone is or was a client. Don't reference specific facts the reviewer mentions in a way that confirms a representation.
3. Never make legal commitments, promises of outcomes, or guarantees.
4. Negative reviews (≤ 3 stars): acknowledge their experience, apologize for it without admitting fault, invite a private conversation (offer the office phone or a generic email).
5. Positive reviews (4–5 stars): thank them warmly, briefly reinforce one firm value (e.g. responsiveness, fighting for workers).
6. Keep replies under ${MAX_TARGET_CHARS} characters. Plain, professional prose. No emojis. No exclamation marks beyond one for a thank-you.
7. Sign off with the firm name only — no individual attorney names unless the review references them.

Return ONLY the reply text. No preface, no quotes around it.`;

  const tone =
    review.rating >= 4
      ? "positive"
      : review.rating === 3
        ? "neutral"
        : "negative";

  const user = `Review to reply to:
- Author: ${review.author}
- Rating: ${review.rating} stars (${tone})
- Date: ${review.date}
- Comment: """${review.comment.slice(0, 1500)}"""

Draft the public reply.`;

  const anthropic = getAnthropic();
  const resp = await anthropic.messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 800,
    system: cachedSystemPrompt(system),
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  const cleaned = text.trim().replace(/^["']|["']$/g, "");
  return {
    reply: cleaned.slice(0, MAX_REPLY_CHARS),
    usedModel: KEYWORD_RESEARCH_MODEL,
  };
}

function stripAccountPrefix(id: string): string {
  const t = id.trim();
  return t.startsWith("accounts/") ? t.slice("accounts/".length) : t;
}

function stripLocationPrefix(id: string): string {
  const t = id.trim();
  if (t.includes("/locations/")) {
    const after = t.split("/locations/")[1] ?? t;
    return after.split("/")[0] ?? after;
  }
  return t.startsWith("locations/") ? t.slice("locations/".length) : t;
}

/**
 * PUT the reply to Google's v4 review reply endpoint. Returns the response
 * body on success, throws on error so the caller can surface the message.
 */
export async function postReply(args: {
  accountId: string;
  locationId: string;
  reviewId: string;
  comment: string;
}): Promise<unknown> {
  const auth = await getGoogleAccessToken([GBP_OAUTH_SCOPE]);
  if ("error" in auth) {
    throw new Error(auth.error);
  }
  const acc = encodeURIComponent(stripAccountPrefix(args.accountId));
  const loc = encodeURIComponent(stripLocationPrefix(args.locationId));
  const rid = encodeURIComponent(args.reviewId);
  const url = `${GBP_MYBUSINESS_V4_BASE}/accounts/${acc}/locations/${loc}/reviews/${rid}/reply`;

  const body = JSON.stringify({
    comment: args.comment.slice(0, MAX_REPLY_CHARS),
  });

  const res = await gbpFetch("review-reply", url, auth.token, {
    method: "PUT",
    body,
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Google rejected the reply (HTTP ${res.status}): ${errBody.slice(0, 400)}`);
  }
  return res.json();
}
