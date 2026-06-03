/**
 * The three top-level content types that drive the /content section's
 * Website / Social Media / Email tabs.
 *
 * Each maps to one or more low-level `format` values used by content_drafts
 * (FormatKey in lib/content-multiformat.ts) and to the content_type values
 * the legacy /api/content/draft endpoint accepts ("blog" | "social" | "email").
 *
 * Keep this file as the single source of truth — UI, drafts filtering, and
 * pipeline scoping all read from here.
 */

export const CONTENT_TYPES = ["website", "social", "email"] as const;
export type ContentTypeKey = (typeof CONTENT_TYPES)[number];

export const DEFAULT_CONTENT_TYPE: ContentTypeKey = "website";

export type FormatKey =
  | "blog"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "instagram"
  | "email"
  | "podcast"
  | "video_short"
  | "video_long";

export const CONTENT_TYPE_LABEL: Record<ContentTypeKey, string> = {
  website: "Website",
  social: "Social Media",
  email: "Email",
};

/**
 * Which draft `format` values belong to each top-level content type.
 * Podcast and video scripts live under Social Media (audio/video are treated
 * as social/distribution content here, not website content).
 */
export const CONTENT_TYPE_FORMATS: Record<ContentTypeKey, FormatKey[]> = {
  website: ["blog"],
  social: [
    "linkedin",
    "twitter",
    "facebook",
    "instagram",
    "podcast",
    "video_short",
    "video_long",
  ],
  email: ["email"],
};

export function formatBelongsToType(
  format: string,
  type: ContentTypeKey,
): boolean {
  return (CONTENT_TYPE_FORMATS[type] as readonly string[]).includes(format);
}

export function typeForFormat(format: string): ContentTypeKey | null {
  for (const type of CONTENT_TYPES) {
    if (formatBelongsToType(format, type)) return type;
  }
  return null;
}

export function isContentType(value: string | null | undefined): value is ContentTypeKey {
  return !!value && (CONTENT_TYPES as readonly string[]).includes(value);
}

export function readContentType(searchParams: URLSearchParams | null | undefined): ContentTypeKey {
  const raw = searchParams?.get("type");
  return isContentType(raw) ? raw : DEFAULT_CONTENT_TYPE;
}
