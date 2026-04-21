import { getSupabaseServer } from "@/lib/supabase-server";

export type BrandDocumentType = "brand" | "sample";

export type StoredBrandDocument = {
  id: string;
  filename: string;
  document_type: BrandDocumentType;
  text_excerpt: string;
  text_length: number;
  uploaded_at: string;
};

export type BrandVoiceProfile = {
  tone: string[];
  stylePreferences: string[];
  legalTerms: string[];
  commonPhrases: string[];
  disclaimers: string[];
  messagingPatterns: string[];
  guidelinesSummary: string;
  sourceDocumentCount: number;
  updatedAt: string;
};

type WordCount = Record<string, number>;

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "from",
  "this",
  "your",
  "have",
  "will",
  "about",
  "into",
  "they",
  "their",
  "them",
  "were",
  "been",
  "also",
  "more",
  "than",
  "when",
  "where",
  "what",
  "which",
  "while",
  "because",
  "would",
  "could",
  "should",
  "there",
  "here",
  "about",
  "just",
  "over",
  "under",
  "after",
  "before",
  "during",
  "these",
  "those",
  "such",
  "into",
  "onto",
  "only",
  "other",
  "against",
  "through",
  "without",
  "ours",
  "ourselves",
  "ours",
  "ourselves",
  "katz",
  "melinger",
]);

const LEGAL_TERMS = [
  "wage",
  "hour",
  "overtime",
  "retaliation",
  "harassment",
  "discrimination",
  "wrongful termination",
  "settlement",
  "damages",
  "claims",
  "employment law",
  "class action",
  "fmla",
  "flsa",
  "eeoc",
  "nyll",
  "severance",
  "litigation",
  "arbitration",
  "complaint",
];

const DISCLAIMER_PATTERNS = [
  "this is not legal advice",
  "past results do not guarantee",
  "attorney advertising",
  "for informational purposes only",
  "does not create an attorney-client relationship",
  "consult an attorney",
];

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeWhitespace(s))
    .filter(Boolean);
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function countWords(words: string[]): WordCount {
  const out: WordCount = {};
  for (const w of words) {
    out[w] = (out[w] ?? 0) + 1;
  }
  return out;
}

function topKeys(map: WordCount, limit: number): string[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function extractCommonPhrases(text: string, limit: number): string[] {
  const words = tokenizeWords(text);
  const bigrams: WordCount = {};
  for (let i = 0; i < words.length - 1; i += 1) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (phrase.length < 8) continue;
    bigrams[phrase] = (bigrams[phrase] ?? 0) + 1;
  }
  return topKeys(bigrams, limit);
}

function extractLegalTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return LEGAL_TERMS.filter((term) => lower.includes(term));
}

function extractDisclaimers(text: string): string[] {
  const lower = text.toLowerCase();
  return DISCLAIMER_PATTERNS.filter((term) => lower.includes(term));
}

function inferTone(text: string): string[] {
  const lower = text.toLowerCase();
  const tones: string[] = [];
  if (/you\b/.test(lower) || /we\b/.test(lower)) tones.push("direct and client-focused");
  if (/rights|protect|support|help/.test(lower)) tones.push("advocacy-oriented");
  if (/court|claims|litigation|damages|law/.test(lower)) tones.push("authoritative legal");
  if (/understand|clear|step|guide/.test(lower)) tones.push("educational and clear");
  return tones.length ? tones : ["professional and practical"];
}

function inferStylePreferences(text: string): string[] {
  const sentences = splitSentences(text);
  const avgLength =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
      : 0;
  const styles: string[] = [];
  if (avgLength <= 18) styles.push("concise sentence structure");
  else styles.push("detailed explanatory sentence structure");
  if (/\n-|\n\*/.test(text)) styles.push("uses bullet formatting");
  if (/:/.test(text)) styles.push("uses section labels and headings");
  styles.push("avoid guarantees and absolute outcomes");
  return styles;
}

function inferMessagingPatterns(text: string): string[] {
  const patterns: string[] = [];
  if (/contact|call|schedule|consult/.test(text.toLowerCase())) {
    patterns.push("close with a soft call-to-action to contact the firm");
  }
  if (/worker|employee|team member|client/.test(text.toLowerCase())) {
    patterns.push("center messaging on workers and employee protections");
  }
  if (/new york|nyc|new york city/.test(text.toLowerCase())) {
    patterns.push("anchor copy with New York context when relevant");
  }
  return patterns;
}

export function buildBrandProfileFromTexts(texts: string[]): BrandVoiceProfile {
  const combined = normalizeWhitespace(texts.join("\n\n"));
  const words = tokenizeWords(combined);
  const topWords = topKeys(countWords(words), 8);
  const legalTerms = extractLegalTerms(combined);
  const disclaimers = extractDisclaimers(combined);
  const commonPhrases = extractCommonPhrases(combined, 8);
  const tone = inferTone(combined);
  const stylePreferences = inferStylePreferences(combined);
  const messagingPatterns = inferMessagingPatterns(combined);

  const summaryParts = [
    `Voice: ${tone.join(", ")}.`,
    legalTerms.length
      ? `Frequent legal terminology: ${legalTerms.slice(0, 6).join(", ")}.`
      : "Use plain-language legal terminology with selective statutory references.",
    commonPhrases.length
      ? `Repeated messaging phrases: ${commonPhrases.slice(0, 5).join("; ")}.`
      : "Maintain consistent worker-rights centered phrasing.",
    disclaimers.length
      ? `Common disclaimers: ${disclaimers.slice(0, 3).join("; ")}.`
      : "Include legal disclaimer language where appropriate.",
  ];

  return {
    tone,
    stylePreferences: [...stylePreferences, ...topWords.map((w) => `prefer keyword: ${w}`)],
    legalTerms,
    commonPhrases,
    disclaimers,
    messagingPatterns,
    guidelinesSummary: summaryParts.join(" "),
    sourceDocumentCount: texts.length,
    updatedAt: new Date().toISOString(),
  };
}

export async function getBrandVoiceContext(): Promise<string> {
  const sb = getSupabaseServer();
  if (!sb) return "";
  const { data } = await sb
    .from("brand_voice")
    .select("context")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = data as { context?: string | null } | null;
  return typeof c?.context === "string" ? c.context.trim() : "";
}

export async function setBrandVoiceContext(context: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServer();
  if (!sb) return { ok: false, error: "Supabase is not configured" };

  const { data: existing } = await sb
    .from("brand_voice")
    .select("id")
    .limit(1)
    .maybeSingle();

  const id = existing && typeof existing === "object" && "id" in existing
    ? String((existing as { id: string }).id)
    : null;

  if (id) {
    const { error } = await sb
      .from("brand_voice")
      .update({
        context,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await sb.from("brand_voice").insert({ context });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listBrandDocuments(
  docType?: BrandDocumentType,
): Promise<StoredBrandDocument[]> {
  const sb = getSupabaseServer();
  if (!sb) return [];
  let query = sb
    .from("brand_voice_documents")
    .select("id, filename, document_type, text_excerpt, text_length, uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(100);
  if (docType) {
    query = query.eq("document_type", docType);
  }
  const { data } = await query;
  return (Array.isArray(data) ? data : []) as StoredBrandDocument[];
}

export async function listDocumentTexts(): Promise<string[]> {
  const sb = getSupabaseServer();
  if (!sb) return [];
  const { data } = await sb
    .from("brand_voice_documents")
    .select("extracted_text")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (!Array.isArray(data)) return [];
  return data
    .map((row) =>
      row && typeof row === "object"
        ? String((row as { extracted_text?: unknown }).extracted_text ?? "")
        : "",
    )
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function insertBrandDocument(input: {
  filename: string;
  documentType: BrandDocumentType;
  extractedText: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServer();
  if (!sb) return { ok: false, error: "Supabase is not configured" };
  const text = normalizeWhitespace(input.extractedText);
  const { error } = await sb.from("brand_voice_documents").insert({
    filename: input.filename,
    document_type: input.documentType,
    extracted_text: text,
    text_excerpt: text.slice(0, 1200),
    text_length: text.length,
    uploaded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveBrandProfile(profile: BrandVoiceProfile): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServer();
  if (!sb) return { ok: false, error: "Supabase is not configured" };
  const payload = {
    tone: profile.tone,
    style_preferences: profile.stylePreferences,
    legal_terms: profile.legalTerms,
    common_phrases: profile.commonPhrases,
    disclaimers: profile.disclaimers,
    messaging_patterns: profile.messagingPatterns,
    guidelines_summary: profile.guidelinesSummary,
    source_document_count: profile.sourceDocumentCount,
    updated_at: profile.updatedAt,
  };
  const { error } = await sb
    .from("brand_voice_profiles")
    .insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getLatestBrandProfile(): Promise<BrandVoiceProfile | null> {
  const sb = getSupabaseServer();
  if (!sb) return null;
  const { data } = await sb
    .from("brand_voice_profiles")
    .select(
      "tone, style_preferences, legal_terms, common_phrases, disclaimers, messaging_patterns, guidelines_summary, source_document_count, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    tone: Array.isArray(row.tone) ? row.tone.map(String) : [],
    stylePreferences: Array.isArray(row.style_preferences)
      ? row.style_preferences.map(String)
      : [],
    legalTerms: Array.isArray(row.legal_terms) ? row.legal_terms.map(String) : [],
    commonPhrases: Array.isArray(row.common_phrases)
      ? row.common_phrases.map(String)
      : [],
    disclaimers: Array.isArray(row.disclaimers) ? row.disclaimers.map(String) : [],
    messagingPatterns: Array.isArray(row.messaging_patterns)
      ? row.messaging_patterns.map(String)
      : [],
    guidelinesSummary:
      typeof row.guidelines_summary === "string" ? row.guidelines_summary : "",
    sourceDocumentCount:
      typeof row.source_document_count === "number" ? row.source_document_count : 0,
    updatedAt:
      typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
}

export async function recomputeAndSaveBrandProfile(): Promise<{
  ok: boolean;
  profile?: BrandVoiceProfile;
  error?: string;
}> {
  const texts = await listDocumentTexts();
  if (!texts.length) {
    return { ok: false, error: "No uploaded documents available for analysis." };
  }
  const profile = buildBrandProfileFromTexts(texts);
  const saved = await saveBrandProfile(profile);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, profile };
}
