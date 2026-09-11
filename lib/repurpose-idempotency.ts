/**
 * One repurpose batch per source per day (Diana's item 7).
 *
 * Repurpose produced two identical five-format batches eleven minutes apart.
 * The route had no guard at all — it read the source and generated, so two
 * submissions made two sets, and cleaning them up afterwards became item 20.
 *
 * TWO LAYERS, AND ONLY ONE OF THEM IS THE FIX
 *
 * `findExistingBatch` below is the friendly layer: it catches the ordinary
 * repeat, returns what already exists so the caller can show it instead of an
 * error, and — the part that matters operationally — skips the model call
 * before it is paid for.
 *
 * It cannot be relied on. A double-click fires two requests milliseconds apart;
 * both read nothing and both proceed, which is precisely the failure being
 * fixed. Correctness lives in the unique index on
 * (tenant_id, idempotency_key) from supabase/content_batches_idempotency.sql:
 * the second insert fails however close the two arrive.
 *
 * A CONFLICT IS NOT AN ERROR
 *
 * Someone who clicks Repurpose twice wants the posts, not a lecture. Both
 * layers return the batch that already exists so the caller can open it.
 */

import { getSupabaseAdmin } from "./supabase-server";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postgres unique-violation. The signal that the other request won the race. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === UNIQUE_VIOLATION || /duplicate key value|unique constraint/i.test(e?.message ?? "");
}

/**
 * What identifies "the same source" across two requests.
 *
 * The draft id when the page was authored here, because it is exact. Otherwise
 * the URL, lowercased with the trailing slash and query removed so
 * `/blog/x`, `/blog/x/` and `/blog/x?utm=1` are one source rather than three.
 * Title is the last resort, and a weak one — two different posts can share a
 * title — which is why it is behind both.
 */
export function sourceKey(args: {
  sourceDraftId?: string | null;
  url?: string | null;
  title?: string | null;
}): string | null {
  if (args.sourceDraftId?.trim()) return `draft:${args.sourceDraftId.trim()}`;
  const url = args.url?.trim();
  if (url) {
    const cleaned = url
      .toLowerCase()
      .split("#")[0]
      .split("?")[0]
      .replace(/\/+$/, "");
    if (cleaned) return `url:${cleaned}`;
  }
  const title = args.title?.trim().toLowerCase().replace(/\s+/g, " ");
  return title ? `title:${title}` : null;
}

/** The day bucket, in Eastern time — the firm's day, not UTC's. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The collision key for one repurpose run.
 *
 * `force` appends a nonce, which is how an explicit re-run gets past a
 * constraint whose whole purpose is to stop the accidental one. Returns null
 * when there is nothing stable to key on — an unkeyable request is simply not
 * deduped, rather than being blocked or sharing a bucket with every other
 * unkeyable request.
 */
export function repurposeIdempotencyKey(
  args: { sourceDraftId?: string | null; url?: string | null; title?: string | null },
  force = false,
): string | null {
  const key = sourceKey(args);
  if (!key) return null;
  const base = `repurpose:${key}:${today()}`;
  return force ? `${base}:force-${Date.now().toString(36)}` : base;
}

export type ExistingBatch = {
  batchId: string;
  topic: string | null;
  createdAt: string | null;
  draftCount: number;
};

/**
 * The batch this key already produced, or null.
 *
 * Fail-soft: if the column has not been migrated yet this returns null and
 * generation proceeds as it did before. An unmigrated database should lose the
 * guard, not the feature.
 */
export async function findExistingBatch(
  tenantId: string,
  idempotencyKey: string,
): Promise<ExistingBatch | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("content_batches")
      .select("id, topic, created_at")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error || !data) return null;

    const { count } = await sb
      .from("content_drafts")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", (data as any).id);

    return {
      batchId: (data as any).id as string,
      topic: ((data as any).topic as string | null) ?? null,
      createdAt: ((data as any).created_at as string | null) ?? null,
      draftCount: count ?? 0,
    };
  } catch {
    return null;
  }
}
