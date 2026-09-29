/**
 * Reviewer certifications and the other server-owned draft metadata.
 *
 * Two rules from Diana's Sept 28 spec live here so every write path shares them:
 *
 *  11.5  A certification describes the text it was given on. When the body or
 *        title changes, proofread and legal_review no longer describe anything,
 *        so they are cleared.
 *  11.9  `wp_publish` and `certifications` are written only by the routes that
 *        own them (publish, certify). A generic metadata PATCH must not be able
 *        to set `wp_publish.queued = true` or forge a certification.
 */

export const DRAFT_CERTIFICATION_KEYS = [
  "legal_review",
  "proofread",
  "schema",
  "internal_links",
  "citations",
] as const;

/** Certifications that describe the TEXT, and so die with an edit. */
const TEXT_BOUND: readonly string[] = ["legal_review", "proofread"];

/** Metadata keys a generic PATCH may not write. */
const SERVER_OWNED = ["wp_publish", "certifications"] as const;

type Meta = Record<string, unknown>;

/**
 * Merge a client-supplied metadata object over the stored one, keeping the
 * server-owned keys exactly as stored.
 */
export function mergeClientMetadata(stored: Meta | null, incoming: Meta | null): Meta {
  const out: Meta = { ...(stored ?? {}), ...(incoming ?? {}) };
  for (const k of SERVER_OWNED) {
    if (stored && k in stored) out[k] = stored[k];
    else delete out[k];
  }
  return out;
}

/** Drop the text-bound certifications. Returns the keys that were removed. */
export function clearTextCertifications(meta: Meta): { meta: Meta; cleared: string[] } {
  const certs = (meta.certifications as Record<string, unknown> | undefined) ?? {};
  const cleared = TEXT_BOUND.filter((k) => k in certs);
  if (cleared.length === 0) return { meta, cleared };
  const next = { ...certs };
  for (const k of cleared) delete next[k];
  return { meta: { ...meta, certifications: next }, cleared };
}

/** Take a draft out of the WordPress queue. */
export function dequeueWp(meta: Meta, reason: string): { meta: Meta; changed: boolean } {
  const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? undefined;
  if (!wp || wp.queued !== true) return { meta, changed: false };
  return {
    meta: {
      ...meta,
      wp_publish: { ...wp, queued: false, dequeued_at: new Date().toISOString(), dequeued_reason: reason },
    },
    changed: true,
  };
}
