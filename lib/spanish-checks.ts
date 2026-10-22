/**
 * Every check runs on Spanish content (Oct 20 spec, Task A13): "A Spanish
 * draft never passes because the checks only read English."
 *
 * The fee rule and the source check's claim patterns read Spanish directly
 * (lib/fee-language.ts, lib/source-check.ts). The traps and the knowledge
 * base's match keywords are written in English, so a Spanish article is also
 * read through an English translation, sentence by sentence: the traps run on
 * the translation, each finding is shown with the Spanish sentence it came
 * from, and the source check matches a Spanish claim to its knowledge base
 * entry through its English sentence.
 *
 * The translation is kept in metadata.spanish_check for the article version
 * it was made from (by a hash of the text), so it is made once per version.
 * Until it exists for the current version, the readiness checklist does not
 * pass a Spanish draft.
 */
import { getAnthropic, CONTENT_SHORT_FORM_MODEL } from "./anthropic";
import { recordAiCost } from "./ai-cost";
import { splitSentences } from "./legal-classifier";
import { articleText } from "./source-check";
import { runTrapCheck } from "./trap-gate";
import { findFeeLanguage } from "./fee-language";
import type { DraftContent } from "./draft-frame";
import { parseTranslation, spanishFor, spanishTextHash, type SpanishCheckRecord, type SpanishFinding, type SpanishPair } from "./spanish-check-status";

export * from "./spanish-check-status";

export function sentencesForTranslation(content: DraftContent): string[] {
  return splitSentences(articleText(content))
    .map((s) => s.text.replace(/\s+/g, " ").trim())
    .filter((s) => s && /[a-záéíóúñ]/i.test(s));
}

async function translate(tenantId: string, draftId: string, sentences: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 60) {
    const chunk = sentences.slice(i, i + 60);
    const res = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 6000,
      system:
        "Translate each numbered Spanish sentence into plain, literal English. Keep every number, dollar figure, date, deadline, statute and name exactly. Do not fix, soften or add anything: the translation is used to check what the Spanish says. Answer with the same numbered lines and nothing else.",
      messages: [{ role: "user", content: chunk.map((s, j) => `${j + 1}. ${s}`).join("\n") }],
    });
    void recordAiCost({ tenantId, draftId, endpoint: "spanish-check", model: CONTENT_SHORT_FORM_MODEL, usage: res.usage });
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const lines = parseTranslation(text, chunk.length);
    if (!lines) throw new Error("The Spanish translation for the checks came back incomplete. Run it again.");
    out.push(...lines);
  }
  return out;
}

/**
 * Translate (when the article changed) and run the English-only checks on the
 * translation. Returns the record to store in metadata.spanish_check.
 */
export async function runSpanishChecks(tenantId: string, draftId: string, content: DraftContent, previous: SpanishCheckRecord | null): Promise<SpanishCheckRecord> {
  const hash = spanishTextHash(content);
  let pairs: SpanishPair[];
  if (previous && previous.hash === hash) pairs = previous.pairs;
  else {
    const es = sentencesForTranslation(content);
    // Reuse the translation of sentences that did not change.
    const known = new Map((previous?.pairs ?? []).map((p) => [p.es, p.en]));
    const todo = es.filter((s) => !known.has(s));
    const fresh = todo.length ? await translate(tenantId, draftId, todo) : [];
    todo.forEach((s, i) => known.set(s, fresh[i]));
    pairs = es.map((s) => ({ es: s, en: known.get(s) ?? "" }));
  }
  const english = pairs.map((p) => p.en).join("\n");
  const findings: SpanishFinding[] = [];
  const traps = await runTrapCheck(english, { tenantId });
  for (const f of traps.findings) {
    const p = spanishFor(pairs, f.excerpt);
    findings.push({ title: f.title, severity: f.severity, es: p?.es ?? "", en: p?.en ?? f.excerpt ?? "" });
  }
  // The fee rule reads the Spanish itself; the translation catches a
  // paraphrase its Spanish patterns miss.
  const seen = new Set<string>();
  for (const h of findFeeLanguage(english)) {
    const p = spanishFor(pairs, h.sentence);
    const key = p?.es ?? h.sentence;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ title: `Fee rule (read in English): ${h.rule}`, severity: "critical", es: p?.es ?? "", en: h.sentence });
  }
  return { version: 1, hash, checked_at: new Date().toISOString(), pairs, findings };
}
