/**
 * Tracked review-link redirect — the click step of the review-generation
 * funnel. A recipient follows /r/<token>; we stamp clicked_at (advancing the
 * funnel) and 302 them to the firm's public Google "write a review" form.
 *
 * Public route, NO auth: the secret token is looked up via the service-role
 * client (recordReviewRequestClick). Returns a friendly page rather than a dead
 * link when the token is unknown or the review destination isn't configured.
 */

import { NextResponse, type NextRequest } from "next/server";

import { recordReviewRequestClick } from "@/lib/review-requests";

export const dynamic = "force-dynamic";

function notice(title: string, detail: string, status: number): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937"><h1 style="font-size:1.25rem">${title}</h1><p style="color:#4b5563;line-height:1.6">${detail}</p></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/r/[token]">,
) {
  const { token } = await ctx.params;

  let destination: string | null;
  let found: boolean;
  try {
    ({ destination, found } = await recordReviewRequestClick(token));
  } catch (e) {
    console.error("[r/token] click tracking failed:", e);
    // Never 500 a recipient who clicked a legitimate link — degrade gracefully.
    return notice(
      "Almost there",
      "Thank you! We hit a snag opening the review form — please search for the firm on Google to leave your review.",
      200,
    );
  }

  if (!found) {
    return notice(
      "Link not found",
      "This review link is invalid or has expired. If you meant to leave a review, please search for the firm on Google.",
      404,
    );
  }
  if (!destination) {
    return notice(
      "Almost there",
      "Thank you! Our review link isn't fully set up yet — please search for the firm on Google to leave your review.",
      200,
    );
  }

  return NextResponse.redirect(destination, 302);
}
