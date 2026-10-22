/**
 * Oct 20 spec, Task A13: Spanish content is checked in Spanish. The fee rule
 * and the source check's claim patterns read Spanish, the stored English
 * reading maps findings back to the Spanish sentence, Spanish Search Console
 * queries are recognised, and paired versions carry hreflang.
 *
 *   node scripts/run.mjs scripts/check-spanish.ts
 */
import { findFeeLanguage } from "../lib/fee-language";
import { extractSourceClaims } from "../lib/source-check";
import { englishFor, parseTranslation, spanishCheckStatus, spanishFor, spanishTextHash } from "../lib/spanish-check-status";
import { isSpanishQuery, spanishQueriesFor } from "../lib/keyword-selection-data";
import { hreflangFields } from "../lib/wp-content-publish";
import { spanishClosingCta } from "../lib/legal-disclaimers";
import type { DraftContent } from "../lib/draft-frame";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// Fee rule, in Spanish.
const fee = (s: string) => findFeeLanguage(s).map((h) => h.rule);
check("contingencia is fee language", fee("Trabajamos con honorarios de contingencia.").includes("Contingency fee"));
check("no cobramos a menos que ganemos", fee("No cobramos nada a menos que ganemos su caso.").length > 0);
check("consulta gratuita is banned", fee("Ofrecemos una consulta gratuita.").includes("Free consultation"));
check("porcentaje de su indemnización", fee("Cobramos un porcentaje de su indemnización.").includes("Percentage of recovery"));
check("sin costo por adelantado", fee("Sin costo por adelantado para usted.").includes("No upfront cost"));
check("the Spanish offer in the CTA is allowed", fee(spanishClosingCta("212-460-0047", "Evaluación Gratuita y Confidencial de su Caso")).length === 0, spanishClosingCta("212-460-0047", "Evaluación Gratuita y Confidencial de su Caso"));
check("fee recovery as a remedy is not fee language", fee("La ley permite recuperar los honorarios de abogados del empleador.").length === 0);

// Claims, in Spanish.
const claims = extractSourceClaims(
  "Usted tiene 300 días para presentar un cargo ante la EEOC. La ley se aplica a empleadores con 15 o más empleados. El salario mínimo en la ciudad de Nueva York es $16.50 por hora. Muchos casos tardan dos años en resolverse.",
);
const types = claims.map((c) => c.type);
check("Spanish deadline claim found", types.includes("deadline"), JSON.stringify(claims));
check("Spanish employee-count claim found", types.includes("employee_count"));
check("Spanish dollar claim found", types.includes("dollar"));
check("how long a case takes is not a claim", !claims.some((c) => c.sentence.startsWith("Muchos casos")));

// The English reading.
check("numbered translation parsed", JSON.stringify(parseTranslation("1. One.\n2) Two.\n3. Three.", 3)) === JSON.stringify(["One.", "Two.", "Three."]));
check("an incomplete translation is refused", parseTranslation("1. One.", 3) === null);
const pairs = [
  { es: "Usted tiene 300 días para presentar un cargo.", en: "You have 300 days to file a charge." },
  { es: "Llame hoy.", en: "Call today." },
];
check("a finding maps back to its Spanish sentence", spanishFor(pairs, "300 days to file a charge")?.es === pairs[0].es);
check("a claim's English is found", englishFor(pairs, "Usted tiene 300 días para presentar un cargo.") === pairs[0].en);
const content = { direct_answer: "Respuesta.", intro: "Intro.", sections: [], faq: [], case_result: { text: "" } } as unknown as DraftContent;
check("no stored check is not current", !spanishCheckStatus({}, content).current);
check("a check for this text is current", spanishCheckStatus({ spanish_check: { version: 1, hash: spanishTextHash(content), checked_at: "", pairs: [], findings: [] } }, content).current);
check("a check for older text is not current", !spanishCheckStatus({ spanish_check: { version: 1, hash: "old", checked_at: "", pairs: [], findings: [] } }, content).current);

// Spanish keywords.
check("Spanish query recognised", isSpanishQuery("abogado de despido injustificado"));
check("English query not Spanish", !isSpanishQuery("wrongful termination lawyer nyc"));
check(
  "Spanish queries for a seed",
  JSON.stringify(spanishQueriesFor("despido injustificado", [{ query: "abogado de despido injustificado" }, { query: "wrongful termination" }, { query: "salario mínimo" }])) ===
    JSON.stringify(["abogado de despido injustificado"]),
);

// hreflang on publish.
const pm = new Map([["b", { wp_publish: { wp_post_id: 42, url: "https://katzmelinger.com/es/despido/" } }]]);
const h = hreflangFields({ language: "es", language_pair: { draft_id: "b" } }, pm);
check("paired Spanish draft names its English post", h.language === "es" && h.hreflang_pair?.language === "en" && h.hreflang_pair.wp_post_id === 42);
check("unpaired draft has no pair", hreflangFields({}, pm).hreflang_pair === null && hreflangFields({}, pm).language === "en");

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
