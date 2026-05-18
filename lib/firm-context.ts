/**
 * Builds the "firm context" string that gets injected into the system prompt
 * of every keyword research AI call. The original Replit version pulled this
 * from Drizzle tables (`brandVoiceSettings`, `brandVoiceAvatars`); here we
 * read from the equivalent Supabase tables created in
 * supabase/keyword_research_schema.sql.
 *
 * If the tables are empty or unreachable, we fall back to a hardcoded baseline
 * so the AI routes still produce useful results out of the box.
 *
 * Contact fields (address, phone, email, website) are injected verbatim and
 * the system prompt explicitly tells the model NOT to fabricate any of them
 * — that's how we got a wrong NYC address and a generic contact@ email in
 * the very first generated email draft. Edit the values on /brand-voice.
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

/**
 * Canonical Katz Melinger contact info — used as the default if the
 * corresponding brand_voice_settings rows are blank. Editing the values
 * on /brand-voice overrides these. Keep these in sync with the firm's
 * actual public-facing info; the AI is instructed not to invent
 * alternatives.
 */
const DEFAULT_CONTACT = {
  firmName: "Katz Melinger PLLC",
  firmAddress: "370 Lexington Avenue, Suite 1512, New York, NY 10017",
  firmPhone: "(212) 460-0047",
  firmEmail: "info@katzmelinger.com",
  firmWebsite: "www.KatzMelinger.com",
} as const;

const FALLBACK_CONTEXT =
  `${DEFAULT_CONTACT.firmName} is a plaintiff-side employment law firm based in ` +
  `New York City, serving clients in NY and NJ. Practice areas: ` +
  `${PRACTICE_AREAS.filter((p) => p !== "All").join(", ")}.\n\n` +
  `CONTACT INFO (use these verbatim — never fabricate):\n` +
  `- Address: ${DEFAULT_CONTACT.firmAddress}\n` +
  `- Phone: ${DEFAULT_CONTACT.firmPhone}\n` +
  `- Email: ${DEFAULT_CONTACT.firmEmail}\n` +
  `- Website: ${DEFAULT_CONTACT.firmWebsite}\n`;

export async function getFirmContext(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();

    const [{ data: settingsRows }, { data: avatarRows }, sampleRes] = await Promise.all([
      supabase.from("brand_voice_settings").select("key, value"),
      supabase.from("brand_voice_avatars").select("*"),
      // brand_voice_samples may not exist on instances that haven't run the
      // v2 migration. Tolerate the failure.
      supabase
        .from("brand_voice_samples")
        .select("title, content, content_type, notes")
        .order("created_at", { ascending: false }),
    ]);

    const settings: Record<string, string> = {};
    for (const row of settingsRows ?? []) {
      if (row?.key && typeof row.value === "string") {
        settings[row.key] = row.value;
      }
    }

    const firmName = settings.firmName || DEFAULT_CONTACT.firmName;
    const geography = settings.targetGeography || "New York and New Jersey";
    const firmAddress = settings.firmAddress || DEFAULT_CONTACT.firmAddress;
    const firmPhone = settings.firmPhone || DEFAULT_CONTACT.firmPhone;
    const firmEmail = settings.firmEmail || DEFAULT_CONTACT.firmEmail;
    const firmWebsite = settings.firmWebsite || DEFAULT_CONTACT.firmWebsite;

    let context =
      `${firmName} is an employment law firm in ${geography}. ` +
      `Practice areas: ${PRACTICE_AREAS.filter((p) => p !== "All").join(", ")}.\n`;

    context +=
      `\nCONTACT INFO (use these verbatim in any CTA, signature, or contact ` +
      `section — never fabricate an address, phone number, email, or website):\n` +
      `- Address: ${firmAddress}\n` +
      `- Phone: ${firmPhone}\n` +
      `- Email: ${firmEmail}\n` +
      `- Website: ${firmWebsite}\n`;

    if (avatarRows && avatarRows.length > 0) {
      type AvatarRow = {
        name?: string | null;
        role?: string | null;
        description?: string | null;
        demographics?: string | null;
        pain_points?: string | null;
        goals?: string | null;
        channels?: string | null;
      };
      const list = avatarRows as AvatarRow[];
      const audiences = list
        .map((a) => `${a.name}${a.role ? ` (${a.role})` : ""}`)
        .join(", ");
      context += `\nTarget audiences: ${audiences}.\n`;

      const detailed = list.filter(
        (a) =>
          a.description || a.demographics || a.pain_points || a.goals || a.channels,
      );
      if (detailed.length > 0) {
        context += `\nAudience details:\n`;
        for (const a of detailed) {
          context += `- ${a.name}${a.role ? ` (${a.role})` : ""}:\n`;
          if (a.description) context += `    Description: ${a.description}\n`;
          if (a.demographics) context += `    Demographics: ${a.demographics}\n`;
          if (a.pain_points) context += `    Pain points: ${a.pain_points}\n`;
          if (a.goals) context += `    Goals: ${a.goals}\n`;
          if (a.channels) context += `    Channels: ${a.channels}\n`;
        }
      }
    }

    if (settings.brandVoice) {
      context += `\nBrand voice guide:\n${settings.brandVoice}\n`;
    }
    if (settings.keyMessages) {
      context += `Key messages: ${settings.keyMessages}\n`;
    }
    if (settings.toneOfVoice) {
      context += `Tone of voice: ${settings.toneOfVoice}\n`;
    }

    // Writing samples — surface one excerpt per content type for tone reference.
    const SAMPLE_EXCERPT_CHARS = 1500;
    type SampleRow = {
      title?: string | null;
      content?: string | null;
      content_type?: string | null;
    };
    const samples = (sampleRes?.data ?? []) as SampleRow[];
    if (samples.length > 0) {
      const byType = new Map<string, SampleRow>();
      for (const s of samples) {
        if (!s.content_type || !s.content) continue;
        if (!byType.has(s.content_type)) byType.set(s.content_type, s);
      }
      if (byType.size > 0) {
        context += `\nWriting samples (tone reference per format):\n`;
        for (const [type, s] of byType) {
          const c = s.content ?? "";
          const excerpt =
            c.length > SAMPLE_EXCERPT_CHARS
              ? c.slice(0, SAMPLE_EXCERPT_CHARS) + "…"
              : c;
          context += `\n[${type}] ${s.title ?? ""}\n${excerpt}\n`;
        }
      }
    }

    return context;
  } catch {
    // Table missing, network error, or env var problem — fall back gracefully
    // so the AI routes still produce useful output before brand voice is set up.
    return FALLBACK_CONTEXT;
  }
}
