/**
 * Small pieces shared by every "tell a human" notifier in the app —
 * lib/content-notifications.ts (drafts, findings, legal review) and
 * lib/alerts-engine.ts's SEO tracker freshness evaluator.
 *
 * Split into its own module rather than living in content-notifications.ts,
 * because alerts-engine.ts's writeAlert() is called BY content-notifications
 * — content-notifications importing FROM alerts-engine and alerts-engine
 * importing back would be a cycle.
 */

import { dispatch } from "./messaging";

/**
 * The firm's standing admin list — who hears about anything with no more
 * specific owner (an unowned draft, a system-level alert like the SEO
 * tracker going stale).
 */
export function adminEmails(): string[] {
  const emails = new Set<string>();
  for (const raw of (process.env.ADMIN_EMAILS ?? "").split(",")) {
    const email = raw.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

/** Best-effort fan-out; a failed send to one address never blocks the rest. */
export async function sendEmails(to: string[], subject: string, body: string): Promise<number> {
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
