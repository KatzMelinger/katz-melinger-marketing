/**
 * The pure half of the Spanish checks (Oct 20 spec, Task A13): the stored
 * record, whether it is for the current article, and the translation parsing.
 * lib/spanish-checks.ts runs them.
 */
import { createHash } from "node:crypto";
import { articleText } from "./source-check";
import type { DraftContent } from "./draft-frame";

export type SpanishPair = { es: string; en: string };
export type SpanishFinding = { title: string; severity: string; es: string; en: string };
export type SpanishCheckRecord = { version: 1; hash: string; checked_at: string; pairs: SpanishPair[]; findings: SpanishFinding[] };

export function spanishTextHash(content: DraftContent): string {
  return createHash("sha256").update(articleText(content)).digest("hex").slice(0, 16);
}

export function readSpanishCheck(meta: Record<string, unknown> | null | undefined): SpanishCheckRecord | null {
  const r = meta?.spanish_check as SpanishCheckRecord | undefined;
  return r && r.version === 1 && Array.isArray(r.pairs) ? r : null;
}

/** Is the stored check for this version of the article, and what did it find? */
export function spanishCheckStatus(meta: Record<string, unknown> | null | undefined, content: DraftContent | null): { current: boolean; findings: SpanishFinding[] } {
  const r = readSpanishCheck(meta);
  if (!r || !content) return { current: false, findings: [] };
  return { current: r.hash === spanishTextHash(content), findings: r.findings };
}

/** Parse the model's numbered lines back into one English line per Spanish sentence. */
export function parseTranslation(raw: string, count: number): string[] | null {
  const out: string[] = new Array(count).fill("");
  for (const line of raw.split("\n")) {
    const m = /^\s*(\d+)[.)]\s*(.*)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < count) out[i] = m[2].trim();
  }
  return out.filter(Boolean).length >= Math.ceil(count * 0.9) ? out : null;
}

/** Which Spanish sentence a finding's English excerpt came from. */
export function spanishFor(pairs: SpanishPair[], excerpt: string | null): SpanishPair | null {
  if (!excerpt) return null;
  const e = excerpt.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  return pairs.find((p) => p.en.toLowerCase().includes(e)) ?? pairs.find((p) => e.includes(p.en.toLowerCase().slice(0, 40))) ?? null;
}

/** The English of a Spanish claim sentence, from the stored translation. */
export function englishFor(pairs: SpanishPair[], sentence: string): string | null {
  const s = sentence.replace(/\s+/g, " ").trim();
  return pairs.find((p) => p.es === s)?.en ?? pairs.find((p) => p.es.includes(s) || s.includes(p.es))?.en ?? null;
}
