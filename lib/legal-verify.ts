/**
 * Rule 3, closed: does the authority actually say what the draft says it says?
 *
 * classify -> retrieve -> COMPARE -> finding. This is the compare, and the
 * whole feature's credibility rests on it refusing to guess.
 *
 * THREE VERDICTS, AND ONLY ONE OF THEM IS AN ACCUSATION
 *
 *   supported     the retrieved text states the claim
 *   contradicted  the retrieved text states something different
 *   inconclusive  the text does not settle it either way
 *
 * `inconclusive` is the default and carries no shame. A regulation that simply
 * does not address the point is not evidence against the draft, and reporting
 * it as one would train reviewers to dismiss the layer — the failure mode that
 * makes a checker worthless faster than missing things does.
 *
 * GROUNDING IS ENFORCED, NOT REQUESTED
 *
 * The model sees the retrieved authority text and is told to answer from it
 * alone. That instruction is not trusted on its own: a `contradicted` verdict
 * must quote the passage it relies on, and the quote is checked against the
 * retrieved text before the verdict is accepted. A quote that is not actually
 * in the source demotes the verdict to `inconclusive`. A model asserting a
 * contradiction it cannot point to is exactly the confident-wrong-answer this
 * layer exists to prevent, and asking it nicely is not a control.
 *
 * Contradictions are also checked twice, independently. They are the only
 * verdict that blocks a draft and puts an attorney's time on the clock, so one
 * sampling is not enough to spend either.
 */

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { classifyLegalClaims, type LegalClaim } from "./legal-classifier";
import { retrieveAuthority } from "./legal-retrieval";
import { formatCitation } from "./legal-citation";

export type Verdict = "supported" | "contradicted" | "inconclusive";

export type ClaimVerdict = {
  claim: LegalClaim;
  verdict: Verdict;
  /** The passage relied on. Verified to exist in the retrieved text. */
  quote: string | null;
  reason: string;
  /** The authority consulted, or null when nothing could be retrieved. */
  sourceUrl: string | null;
};

const SYSTEM = `You compare one legal claim against the text of the authority it cites.

You will be given the claim and the authority's own words. Answer ONLY from the authority text provided. You have no other knowledge for this task — if the text does not settle the question, say so.

Return one of:
- "supported": the authority text states what the claim says.
- "contradicted": the authority text states something DIFFERENT from the claim. Only use this when the text directly conflicts.
- "inconclusive": the text does not address the point, is about something else, or is too partial to tell.

Rules:
1. "inconclusive" is the right answer far more often than people expect. A regulation that does not mention the point does not contradict it.
2. For "contradicted" you MUST quote the exact passage from the authority text that conflicts. Copy it verbatim. If you cannot quote it, the answer is "inconclusive".
3. Do not reason from what you know about the law. Only from the text given.
4. A claim that is broadly consistent but adds detail the text does not cover is "inconclusive", not "contradicted".

Return JSON only:
{"verdict":"supported|contradicted|inconclusive","quote":"<verbatim passage, or empty>","reason":"<one sentence>"}`;

/** Normalise for quote-checking: whitespace and case must not defeat it. */
function canon(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[“”"'’]/g, "").trim();
}

async function askOnce(
  claim: string,
  authorityText: string,
): Promise<{ verdict: Verdict; quote: string; reason: string }> {
  const res = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `CLAIM:\n"""\n${claim}\n"""\n\nAUTHORITY TEXT:\n"""\n${authorityText.slice(0, 12_000)}\n"""`,
      },
    ],
  });
  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  const parsed = extractJSON<{ verdict?: string; quote?: string; reason?: string }>(text);
  const v = parsed?.verdict;
  const verdict: Verdict =
    v === "supported" || v === "contradicted" ? v : "inconclusive";
  return {
    verdict,
    quote: typeof parsed?.quote === "string" ? parsed.quote : "",
    reason: parsed?.reason || "No reason given.",
  };
}

/**
 * Compare one claim against retrieved authority text.
 *
 * Any failure — a model error, an unparseable answer, a quote that is not in
 * the source — resolves to `inconclusive`. The layer never converts its own
 * malfunction into a finding against the content.
 */
export async function verifyClaimAgainst(
  claimSentence: string,
  authorityText: string,
): Promise<{ verdict: Verdict; quote: string | null; reason: string }> {
  let first: Awaited<ReturnType<typeof askOnce>>;
  try {
    first = await askOnce(claimSentence, authorityText);
  } catch (e) {
    return {
      verdict: "inconclusive",
      quote: null,
      reason: `Could not be checked: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (first.verdict !== "contradicted") {
    return { verdict: first.verdict, quote: null, reason: first.reason };
  }

  // A contradiction must be anchored in the source. An unquotable one is a
  // model assertion, not a finding.
  const haystack = canon(authorityText);
  if (!first.quote.trim() || !haystack.includes(canon(first.quote))) {
    return {
      verdict: "inconclusive",
      quote: null,
      reason:
        "A conflict was suggested but the supporting passage could not be found in the authority text, so it was not accepted.",
    };
  }

  // Second, independent pass. This verdict blocks a draft and costs an
  // attorney's attention; one sampling is not enough to spend either.
  let second: Awaited<ReturnType<typeof askOnce>>;
  try {
    second = await askOnce(claimSentence, authorityText);
  } catch {
    return {
      verdict: "inconclusive",
      quote: null,
      reason: "A conflict was suggested but could not be confirmed on a second check.",
    };
  }
  if (second.verdict !== "contradicted") {
    return {
      verdict: "inconclusive",
      quote: null,
      reason: `A conflict was suggested but not reproduced on a second check (${second.verdict}), so it was not accepted.`,
    };
  }

  return { verdict: "contradicted", quote: first.quote.trim(), reason: first.reason };
}

/** Turn a verdict into the finding a reviewer sees. */
function toFinding(v: ClaimVerdict): NormalizedFinding | null {
  const { claim } = v;

  // A verified claim is not a finding. Recording every correct sentence would
  // bury the handful that are not.
  if (v.verdict === "supported") return null;

  const contradicted = v.verdict === "contradicted";
  const title = contradicted
    ? `Contradicted by ${
        claim.citations[0] ? formatCitation(claim.citations[0]) : "the cited authority"
      }`
    : claimNeedsReviewTitle(claim);

  return {
    fingerprint: fingerprintFinding("legal", claim.claimType, claim.sentence),
    source: "legal",
    ruleId: claim.claimType,
    // A contradiction is critical; everything else needs a person but is not
    // itself evidence of an error.
    severity: contradicted ? "critical" : "important",
    title,
    detail: v.quote ? `Authority says: "${v.quote}"` : v.reason,
    excerpt: claim.sentence,
    fix: contradicted
      ? "Correct the claim to match the cited authority, or cite the provision that actually supports it."
      : "An attorney needs to confirm this claim — it cannot be settled by looking a source up.",
    claimType: claim.claimType,
    sourceChecked: v.sourceUrl,
    jurisdiction: claim.jurisdiction,
  };
}

function claimNeedsReviewTitle(claim: LegalClaim): string {
  switch (claim.claimType) {
    case "negative_statement":
      return "Negative legal statement — no lookup can confirm this";
    case "interpretation":
      return "Legal interpretation — needs an attorney";
    case "firm_claim":
      return "Claim about the firm — no authority can confirm this";
    case "unclassified":
      return "Unclassified legal claim — routed for review";
    default:
      return "Legal claim needs review";
  }
}

export type LegalCheckResult = {
  verdicts: ClaimVerdict[];
  findings: NormalizedFinding[];
  stats: {
    claims: number;
    autoChecked: number;
    supported: number;
    contradicted: number;
    inconclusive: number;
    routedToHuman: number;
  };
};

/**
 * Run the whole legal check over a draft body.
 *
 * Claims that cannot be auto-checked are not skipped — they become findings
 * routed to an attorney, which is the point. A draft where nothing was
 * checkable should show a reviewer six things to read, not an empty panel that
 * reads as a pass.
 */
export async function runLegalCheck(
  body: string,
  opts: { tenantId: string },
): Promise<LegalCheckResult> {
  const claims = await classifyLegalClaims(body);
  const verdicts: ClaimVerdict[] = [];

  for (const claim of claims) {
    if (!claim.autoCheckable) {
      verdicts.push({
        claim,
        verdict: "inconclusive",
        quote: null,
        reason: claim.reason,
        sourceUrl: null,
      });
      continue;
    }

    const citation = claim.citations[0];
    const retrieved = await retrieveAuthority(citation, { tenantId: opts.tenantId });
    if (!retrieved.ok) {
      verdicts.push({
        claim,
        verdict: "inconclusive",
        quote: null,
        reason: `Could not read the authority: ${retrieved.failure.reason}`,
        sourceUrl: citation.url,
      });
      continue;
    }

    const checked = await verifyClaimAgainst(claim.sentence, retrieved.value.text);
    verdicts.push({
      claim,
      verdict: checked.verdict,
      quote: checked.quote,
      reason: checked.reason,
      sourceUrl: retrieved.value.sourceUrl,
    });
  }

  const findings = verdicts
    .map(toFinding)
    .filter((f): f is NormalizedFinding => f !== null);

  return {
    verdicts,
    findings,
    stats: {
      claims: claims.length,
      autoChecked: claims.filter((c) => c.autoCheckable).length,
      supported: verdicts.filter((v) => v.verdict === "supported").length,
      contradicted: verdicts.filter((v) => v.verdict === "contradicted").length,
      inconclusive: verdicts.filter((v) => v.verdict === "inconclusive").length,
      routedToHuman: verdicts.filter((v) => v.verdict !== "supported").length,
    },
  };
}
