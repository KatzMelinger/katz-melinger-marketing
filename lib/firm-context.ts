/**
 * Builds the "firm context" string that gets injected into the system prompt
 * of every keyword research AI call. The original Replit version pulled this
 * from Drizzle tables (`brandVoiceSettings`, `brandVoiceAvatars`); here we
 * read from the equivalent Supabase tables created in
 * supabase/keyword_research_schema.sql.
 *
 * If the tables are empty or unreachable, we fall back to a hardcoded baseline
 * so the AI routes still produce useful results out of the box.
 */

import { getSupabaseAdmin } from "./supabase-server";

export const PRACTICE_AREAS = [
  "All",
  "Employment Discrimination",
  "FMLA (Family and Medical Leave Act)",
  "Wage & Hour Claims (overtime, class actions)",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement & Domestication of Judgments",
] as const;

export const VALID_INTENTS = [
  "all",
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;

const FALLBACK_CONTEXT =
  `Katz Melinger PLLC is a plaintiff-side employment law firm based in ` +
  `New York City, serving clients in NY and NJ. Practice areas: ` +
  `${PRACTICE_AREAS.filter((p) => p !== "All").join(", ")}.`;

export async function getFirmContext(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();

    const [{ data: settingsRows }, { data: avatarRows }] = await Promise.all([
      supabase.from("brand_voice_settings").select("key, value"),
      supabase.from("brand_voice_avatars").select("name, role, description"),
    ]);

    const settings: Record<string, string> = {};
    for (const row of settingsRows ?? []) {
      if (row?.key && typeof row.value === "string") {
        settings[row.key] = row.value;
      }
    }

    const firmName = settings.firmName ?? "Katz Melinger PLLC";
    const geography = settings.targetGeography ?? "New York and New Jersey";

    let context =
      `${firmName} is an employment law firm in ${geography}. ` +
      `Practice areas: ${PRACTICE_AREAS.filter((p) => p !== "All").join(", ")}.\n`;

    if (avatarRows && avatarRows.length > 0) {
      const audiences = avatarRows
        .map((a) => {
          const role = a.role ? ` (${a.role})` : "";
          return `${a.name}${role}`;
        })
        .join(", ");
      context += `Target audiences: ${audiences}.\n`;
    }

    if (settings.keyMessages) {
      context += `Key messages: ${settings.keyMessages}\n`;
    }
    if (settings.toneOfVoice) {
      context += `Tone of voice: ${settings.toneOfVoice}\n`;
    }

    return context;
  } catch {
    // Table missing, network error, or env var problem — fall back gracefully
    // so the AI routes still produce useful output before brand voice is set up.
    return FALLBACK_CONTEXT;
  }
}
