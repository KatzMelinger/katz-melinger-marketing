/**
 * Generates a firm-specific content-writing SYSTEM PROMPT from a tenant's
 * configured profile (firm identity, practice areas, geography, brand voice).
 *
 * This is the engine behind Workstream E: instead of every firm inheriting the
 * Katz Melinger employment-law prompt, a new firm generates its own once during
 * onboarding (or from /brand-voice → System Prompt), reviews/edits it, and saves
 * it to tenant_settings.system_prompt. After that it's a plain saved string —
 * stable and editable, not re-derived on every call.
 *
 * The default Katz Melinger tenant keeps its hand-written KM_SYSTEM_PROMPT
 * (Option A) and never needs to run this.
 */

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { resolveTenantId } from "@/lib/tenant-context";

const META_PROMPT = `You write the SYSTEM PROMPT that another AI will use to draft marketing and SEO
content for a specific law firm. Using the FIRM PROFILE below, produce a complete, ready-to-use
system prompt for that firm's content writer.

The system prompt you produce MUST:
- Establish the writer's role (a legal content writer for this firm) and the firm's practice
  areas, target audience, and geography — taken ONLY from the profile, never invented.
- Instruct the writer to use the firm's real contact details verbatim and NEVER fabricate any firm
  detail (name, address, phone, email, website, attorney names, statutes, or case results).
- Give clear writing guidance: plain language over legalese, accurate and compliant (never
  guarantee outcomes; recommend speaking with an attorney), appropriate attorney-advertising
  caution, a clear H1 + scannable structure, and a relevant CTA using the firm's real contact info.
- Reflect the firm's tone / brand voice if the profile provides one.
- Be self-contained and firm-specific, but practice-area-agnostic in structure (do NOT assume a
  practice area the profile doesn't list).

Output ONLY the system prompt text itself — no preamble, no commentary, no markdown code fences.

FIRM PROFILE:
`;

/**
 * Returns a generated system prompt string for the given tenant (defaults to the
 * current request's tenant). Throws if ANTHROPIC_API_KEY is missing or the call
 * fails — callers should surface the error to the user.
 */
export async function generateSystemPrompt(tenantId?: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const tid = tenantId ?? (await resolveTenantId());
  const firmProfile = await getFirmContext(tid);

  const msg = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: `${META_PROMPT}${firmProfile}` }],
  });

  const block = msg.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text.trim() : "";
  if (!text) throw new Error("The model returned an empty system prompt");
  return text;
}
