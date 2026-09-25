/**
 * Is the WordPress side of the pipeline actually alive? (Diana item 7.)
 *
 *   node scripts/run.mjs scripts/check-wp-autopilot.ts
 *
 * Read-only. Run this BEFORE spending a real blog on a test publish.
 *
 * Approving a blog does not publish it: it queues the draft
 * (metadata.wp_publish.queued) and the KM AutoPilot plugin pulls
 * /api/wp/content on its own cron, creates the post, then confirms back via
 * /api/wp/content/applied. So "Published = 0" has three possible causes, and
 * this tells them apart:
 *
 *   - nothing is queued        -> nothing has been approved+published yet
 *   - nothing queued is stale  -> the plugin is keeping up
 *   - the token is cold        -> the plugin is not polling at all, and no
 *                                 amount of approving will publish anything
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { getSupabaseAdmin } from "../lib/supabase-server";

const days = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

async function main() {
  const db = getSupabaseAdmin();

  console.log("-- plugin tokens ------------------------------------------------");
  const { data: tokens, error } = await db
    .from("wp_autopilot_tokens")
    .select("domain, label, last_used_at, revoked_at, created_at");
  if (error) {
    console.log(`  could not read tokens: ${error.message}`);
  } else {
    const live = (tokens ?? []).filter((t) => !t.revoked_at);
    if (live.length === 0) console.log("  NO ACTIVE TOKEN — the plugin cannot authenticate at all.");
    for (const t of live) {
      const age = days(t.last_used_at as string | null);
      const state =
        age === null ? "NEVER USED" : age <= 1 ? "polling" : age <= 7 ? `${age}d ago` : `COLD — ${age}d ago`;
      console.log(`  ${String(t.domain).padEnd(22)} ${String(t.label ?? "").padEnd(12)} ${state}`);
    }
    const revoked = (tokens ?? []).length - live.length;
    if (revoked) console.log(`  (${revoked} revoked token${revoked === 1 ? "" : "s"}, ignored)`);
  }

  console.log("\n-- the publish queue --------------------------------------------");
  const { data: drafts } = await db
    .from("content_drafts")
    .select("id, title, status, format, metadata")
    .in("status", ["approved", "published"])
    .limit(200);
  const queued = (drafts ?? []).filter((d) => {
    const wp = ((d.metadata ?? {}) as Record<string, unknown>).wp_publish as
      | Record<string, unknown>
      | undefined;
    return !!wp && !!wp.queued;
  });
  console.log(`  approved or published drafts : ${drafts?.length ?? 0}`);
  console.log(`  queued for the plugin        : ${queued.length}`);
  for (const q of queued.slice(0, 10)) {
    const wp = ((q.metadata ?? {}) as Record<string, unknown>).wp_publish as Record<string, unknown>;
    console.log(`     ${String(q.title ?? "(untitled)").slice(0, 46)}  ${JSON.stringify(wp)}`);
  }

  console.log("\n-- reading ------------------------------------------------------");
  if (queued.length === 0) {
    console.log("  Nothing queued. Approve and publish one blog to put it in the queue.");
  }
  console.log("  A COLD token means the plugin is not polling — check it is active on the");
  console.log("  site, that WP-Cron is firing, and that the token is still configured there.");
}
main();
