/**
 * Content output language — shared across every content-creation surface so the
 * firm can produce Spanish versions of any piece (the NYC/NJ employment market
 * is heavily Spanish-speaking, and the keyword data confirms real demand, e.g.
 * "abogado de despido injustificado").
 *
 * `languageDirective` returns a prompt instruction appended to the generation
 * prompt; English returns an empty string (no behavior change).
 */

export type ContentLanguage = "en" | "es";

export const CONTENT_LANGUAGES: { id: ContentLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
];

export function normalizeLanguage(v: unknown): ContentLanguage {
  return v === "es" ? "es" : "en";
}

export function languageLabel(lang: ContentLanguage): string {
  return lang === "es" ? "Spanish" : "English";
}

/**
 * Instruction block appended to a generation prompt when the target language is
 * Spanish. Keeps statutes, court names, and the firm name intact while
 * translating everything else — including headings and meta fields.
 */
export function languageDirective(lang: ContentLanguage): string {
  if (lang !== "es") return "";
  return [
    "OUTPUT LANGUAGE: Write the ENTIRE piece in natural, professional Spanish (es-US) for a New York / New Jersey audience.",
    "- Use the formal register (usted), not informal tú.",
    "- Translate all headings, body text, FAQs, the meta title, and the meta description into Spanish.",
    "- Keep proper nouns unchanged: the firm name (Katz Melinger PLLC), statute names and citations (e.g. NYLL, NYCHRL, CPLR 5222, Title VII), court and agency names (SDNY, EEOC, NYSDHR).",
    "- On first use of an English legal term, give the Spanish explanation followed by the English term in parentheses, e.g. \"salario mínimo (minimum wage)\".",
    "- Do not mix English and Spanish sentences; write fluent Spanish throughout.",
  ].join("\n");
}
