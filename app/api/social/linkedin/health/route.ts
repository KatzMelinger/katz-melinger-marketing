/**
 * LinkedIn credential health.
 *
 * GET  — Vercel Cron (Bearer CRON_SECRET). Checks the token and raises an alert
 *        when it is expiring or already dead.
 * POST — manual check for a signed-in user. Returns the same result and can
 *        raise the same alert, so "is LinkedIn still connected?" is answerable
 *        without waiting for a cron.
 *
 * Runs daily. A 60-day token needs checking often enough that a 14-day warning
 * is not missed, and the check is two cheap calls.
 */

import { NextRequest, NextResponse } from "next/server";

import { writeAlert } from "@/lib/alerts-engine";
import { checkLinkedInHealth, RENEWAL_STEPS, type LinkedInHealth } from "@/lib/linkedin-health";
import { guardUser } from "@/lib/supabase-route";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

/**
 * Raise an alert when one is warranted, and only then.
 *
 * The dedupe key carries the STATE and, for an expiring token, the expiry date.
 * That gives one alert per situation rather than one per day: a daily repeat of
 * the same warning is how an alerts inbox becomes something people scroll past,
 * which costs more than the alert was worth. A new token moves the expiry date,
 * so the next warning is a new key and does appear.
 */
async function raiseIfNeeded(health: LinkedInHealth, tenantId: string): Promise<boolean> {
  if (health.state === "ok") return false;

  // "unknown" is deliberately silent. It covers a timeout, a 429, a LinkedIn
  // outage — transient things that resolve themselves. Alerting on them would
  // train the reader to ignore the ones that matter.
  if (health.state === "unknown") return false;

  const common = { source: "social", payload: { integration: "linkedin", state: health.state } };

  if (health.state === "expired") {
    return writeAlert(
      {
        ...common,
        type: "integration_credential",
        severity: "high",
        title: "LinkedIn is disconnected — the monthly report cannot update",
        body:
          `${health.detail}\n\n` +
          "Until it is replaced, the LinkedIn section of the monthly report keeps showing " +
          "the numbers from the last successful run.\n\n" +
          `To get a new token:\n${RENEWAL_STEPS}`,
        dedupeKey: "linkedin-token-expired",
      },
      tenantId,
    );
  }

  if (health.state === "misconfigured") {
    return writeAlert(
      {
        ...common,
        type: "integration_credential",
        severity: "medium",
        title: "LinkedIn is not configured in this environment",
        body: `${health.detail}\n\nTo connect it:\n${RENEWAL_STEPS}`,
        dedupeKey: "linkedin-token-missing",
      },
      tenantId,
    );
  }

  return writeAlert(
    {
      ...common,
      type: "integration_credential",
      severity: "medium",
      title: `LinkedIn token expires in ${health.daysRemaining} day${health.daysRemaining === 1 ? "" : "s"}`,
      body:
        `${health.detail}\n\n` +
        "Replacing it before then keeps the monthly report's LinkedIn demographics current.\n\n" +
        `To get a new token:\n${RENEWAL_STEPS}`,
      // Keyed on the expiry date, so a renewed token warns again next cycle.
      dedupeKey: `linkedin-token-expiring-${health.expiresAt}`,
    },
    tenantId,
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const health = await checkLinkedInHealth();
  const alerted = await raiseIfNeeded(health, DEFAULT_TENANT_ID);
  return NextResponse.json({ ...health, alerted });
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const health = await checkLinkedInHealth();
  const alerted = await raiseIfNeeded(health, await resolveTenantId());
  return NextResponse.json({ ...health, alerted });
}
