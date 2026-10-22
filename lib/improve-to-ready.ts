/**
 * Improve to Ready (Oct 20 spec, Task A9): Huraqan analyzes a draft, plans
 * what it can fix itself, improves it, and checks again, until only human
 * decisions remain. Diana never receives a draft with a fix the system could
 * have made.
 *
 * One pass:
 *   1. Fix known errors (lib/auto-fix-draft.ts): knowledge base values,
 *      statute table, fee language, dashes, internal links, traps; and the
 *      frame.
 *   2. Keyword: when the stored keyword fails the guard or was never chosen
 *      with volume, run keyword selection and use the chosen keyword.
 *   3. The offer phrase outside the CTA is removed (the CTA carries it).
 *   4. The article gaps the quality checks name (lib/quality-checks.ts): a
 *      direct answer, FAQ questions, the "signs you may have a case"
 *      section. The model writes ONLY those pieces, under the brand rules.
 *      A piece is kept only if it passes the fee rule, the ad rules and the
 *      dash rule, and states no legal claim the source check cannot support
 *      (otherwise it is discarded and noted for the attorney).
 *   5. The source check (Task A7) on every claim not yet checked.
 * Then the Ready checklist again. At most 3 passes; it stops as soon as a
 * pass changes nothing. Running it again on an unchanged draft changes
 * nothing.
 *
 * Guards: the frame is rebuilt from Brand settings, never written by the
 * model; attorney-approved sentences are never touched (the model edits only
 * the pieces above, and Fix known errors skips learned approvals). Every
 * change goes to Changes made with the section, the text, the reason and
 * the data source, and can be undone.
 *
 * The result is stored as metadata.improvement and shown in the Improvement
 * summary card at the top of the review screen.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { getAnthropic, CONTENT_LONG_FORM_MODEL } from "./anthropic";
import { fixDraft } from "./auto-fix-draft";
import { assembleDraft, readContent, isFramedFormat, type DraftContent } from "./draft-frame";
import { bylineForDraft, draftLanguage, frameBrandFrom, reviewAreaForDraft, type DraftForFrame } from "./draft-frame-server";
import { getOperatingBrief, type OperatingBrief } from "./social-operating-brief";
import { practiceSigns, qualityForDraft as qualityFor } from "./quality-checks";
import { readQualitySerp, serpQualityChecks } from "./quality-checks-serp";
import { getSerpOverview } from "./dataforseo";
import { draftPrimaryKeyword, findLiveDraftFor } from "./draft-uniqueness";
import { keywordProblem } from "./keyword-guard";
import { selectKeyword } from "./keyword-selection-data";
import { findFeeLanguage } from "./fee-language";
import { blockingAdHits, findAdTerms } from "./ad-terms";
import { articleText, extractSourceClaims } from "./source-check";
import { checkClaims, loadSourceCheckInputs, runSourceCheck } from "./source-check-server";
import { readinessForDraft } from "./draft-readiness-server";
import { notifyNewQuestions } from "./attorney-questions";
import { appendRun, changeId, readFixLog, type FixChange } from "./legal-fix-log";
import { clearTextCertifications } from "./draft-certifications";
import { recordAuditEvent } from "./content-findings-store";
import type { Readiness } from "./draft-readiness";

const MAX_PASSES = 3;

import type { Improvement, ImprovementRecord } from "./improve-to-ready-shared";
export { readImprovement, type Improvement, type ImprovementRecord } from "./improve-to-ready-shared";

type Row = DraftForFrame & { id: string; status: string; seo_brief?: Record<string, unknown> | null };

async function load(tenantId: string, id: string): Promise<Row> {
  const { data, error } = await getSupabaseAdmin()
    .from("content_drafts")
    .select("id, body, title, topic, format, practice_area, metadata, status, seo_brief")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Draft not found");
  return data as Row;
}

function practiceOf(d: Row): "employment" | "collections" | null {
  const a = reviewAreaForDraft(d);
  return a === "employment" ? "employment" : a ? "collections" : null;
}

/* ------------------------------------------------------------------------- */
/* The writer                                                                */
/* ------------------------------------------------------------------------- */

const WRITER = `You improve one part of a law firm article. Katz Melinger PLLC represents employees (employment law) and creditors and businesses (commercial collections and judgment enforcement) in New York and New Jersey.

Write ONLY the pieces asked for, as JSON. Rules:
- Write as "we" and "our firm". Spell out New York and New Jersey.
- No em dashes or en dashes.
- Never say how lawyers charge, what the reader pays, or "free consultation". No call to action and no phone number.
- No guarantees, no "best", "expert", "specialize", "aggressive".
- Do not state a deadline, dollar figure, employee count, statute section or case name unless the article already states it in those words. Prefer plain explanation over figures.
- Helpful, concrete, plain English.

Return JSON only, with only the keys asked for:
{"direct_answer":"<60 words or fewer; the first sentence answers the H1 question>",
 "faq":[{"q":"<question>","a":"<answer of 80 words or fewer that opens with the direct answer>"}],
 "signs":{"h2":"<heading>","items":["<one concrete sign per item>"]}}`;

type Pieces = { direct_answer?: string; faq?: { q: string; a: string }[]; signs?: { h2: string; items: string[] } };

export async function writePieces(
  content: DraftContent,
  keyword: string | null,
  practice: "employment" | "collections" | null,
  want: { directAnswer: boolean; faq: number; signs: boolean },
  paa: string[] = [],
): Promise<Pieces> {
  const article = [
    `# ${content.h1}`,
    content.intro,
    ...content.sections.map((s) => `## ${s.h2}\n${s.body}`),
    content.faq.length ? `## FAQ\n${content.faq.map((f) => `### ${f.q}\n${f.a}`).join("\n")}` : "",
  ]
    .join("\n\n")
    .slice(0, 14_000);
  const asks: string[] = [];
  if (want.directAnswer) asks.push(`"direct_answer": a direct answer to the H1 question, 60 words or fewer${keyword ? `, using "${keyword}" naturally` : ""}.`);
  if (want.faq > 0) {
    asks.push(
      `"faq": ${want.faq} new questions a reader would ask about this topic that the FAQ does not already answer, each answered in 80 words or fewer.` +
        (paa.length ? ` Use these People Also Ask questions first, worded as asked: ${paa.map((q) => `"${q}"`).join("; ")}.` : ""),
    );
  }
  if (want.signs) {
    asks.push(
      `"signs": a section titled "${practiceSigns(practice)}" with 5 to 7 concrete signs ${practice === "collections" ? "that a business debt is worth pursuing in court" : "that the reader's situation may be unlawful"}, one per item.`,
    );
  }
  const res = await getAnthropic().messages.create({
    model: CONTENT_LONG_FORM_MODEL,
    max_tokens: 2500,
    system: WRITER,
    messages: [{ role: "user", content: `ARTICLE:\n"""\n${article}\n"""\n\nWrite these pieces:\n- ${asks.join("\n- ")}` }],
  });
  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Pieces;
  } catch {
    return {};
  }
}

const NUMBER_WORD = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|thirty|forty|fifty|sixty|ninety|hundred)";
const FIGURE = new RegExp(
  `\\$\\s?\\d[\\d,.]*|\\b\\d[\\d,.]*\\s*(?:%|percent\\b)|\\b${NUMBER_WORD}\\s+percent\\b|\\b(?:\\d[\\d,]*|${NUMBER_WORD})(?:[\\s-]+${NUMBER_WORD})?\\s+(?:calendar\\s+|business\\s+)?(?:years?|months?|weeks?|days?|employees?|workers?)\\b|§\\s?\\d|\\b\\d{3,}\\b`,
  "gi",
);

/**
 * Figures in a written piece that the article does not already state. The
 * writer is told not to add any; a test run added "twenty years" and "nine
 * percent" anyway, which the claim detector did not count as claims. A new
 * figure is a legal claim nobody has checked, so the piece is not kept.
 */
export function newFigures(piece: string, article: string): string[] {
  const have = article.toLowerCase().replace(/\s+/g, " ");
  return [...new Set((piece.match(FIGURE) ?? []).map((f) => f.toLowerCase().replace(/\s+/g, " ").trim()))].filter((f) => !have.includes(f));
}

/** Why a written piece cannot be kept, or null. */
export function pieceProblem(text: string): string | null {
  if (/[–—]/.test(text)) return "an em or en dash";
  if (findFeeLanguage(text).length) return "fee language";
  if (blockingAdHits(findAdTerms(text)).length) return "advertising-rule language";
  if (/\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b|\bcall (?:us|today)\b/i.test(text)) return "a phone number or call to action";
  return null;
}

/* ------------------------------------------------------------------------- */
/* One draft                                                                 */
/* ------------------------------------------------------------------------- */

function applyKeywordMeta(meta: Record<string, unknown>, keyword: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta, primaryKeyword: keyword, primary_keyword: keyword };
  const km = (meta.km_brief as Record<string, unknown> | undefined) ?? null;
  if (km) out.km_brief = { ...km, primaryKeyword: keyword };
  return out;
}

async function save(tenantId: string, d: Row, content: DraftContent, meta: Record<string, unknown>, changes: FixChange[], brief: OperatingBrief, previousBody: string) {
  const body = assembleDraft(content, frameBrandFrom(brief, draftLanguage(meta)), { format: d.format, byline: bylineForDraft({ ...d, metadata: meta }, brief) });
  let next: Record<string, unknown> = { ...meta, content };
  if (changes.length) {
    next = { ...next, legal_fix_log: appendRun(readFixLog(meta), { previousTitle: d.title, previousBody, changes }) };
    next = clearTextCertifications(next).meta;
  }
  const { error } = await getSupabaseAdmin()
    .from("content_drafts")
    .update({ body, metadata: next, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", d.id);
  if (error) throw new Error(error.message);
}

const ANCHOR = (body: string, text: string) => {
  const at = body.indexOf(text);
  return at > 0 ? body.slice(Math.max(0, at - 60), at) : "";
};

export async function improveToReady(args: {
  tenantId: string;
  draftId: string;
  actor?: { id: string | null; email: string | null };
}): Promise<ImprovementRecord> {
  const { tenantId, draftId } = args;
  const improved: Improvement[] = [];
  const human = new Set<string>();
  let passes = 0;
  let readiness: Readiness | null = null;
  const brief = await getOperatingBrief(tenantId);
  const sourceInputs = await loadSourceCheckInputs(tenantId);

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    passes = pass;
    let changedThisPass = false;
    let d = await load(tenantId, draftId);
    if (!isFramedFormat(d.format)) throw new Error("Improve to Ready works on website drafts.");
    if (["archived", "published", "approved"].includes(d.status)) throw new Error(`This draft is ${d.status}.`);

    // 1. Fix known errors (and the frame).
    const fix = await fixDraft({ draftId, tenantId, actor: args.actor, websiteFormatsOnly: true });
    if (fix.changes > 0) {
      changedThisPass = true;
      improved.push({ what: `Fixed ${fix.changes} known error${fix.changes === 1 ? "" : "s"}`, source: "knowledge base, statute table, traps, brand rules" });
    }
    for (const a of fix.attorneyReview) human.add(`Attorney: ${a}`);
    d = await load(tenantId, draftId);
    let meta = { ...(d.metadata ?? {}) };
    const content = readContent(meta);
    if (!content) throw new Error("The draft could not be put in the frame.");
    const before = d.body;
    const changes: FixChange[] = [];
    const now = () => new Date().toISOString();

    // 2. Keyword.
    const kw = draftPrimaryKeyword(meta);
    const sel = meta.keyword_selection as { status?: string; chosen?: { keyword?: string; volume?: number | null } | null } | undefined;
    const kwOk = kw && !keywordProblem(kw) && sel?.status === "selected" && sel.chosen?.volume != null && sel.chosen.keyword?.toLowerCase() === kw.toLowerCase();
    if (!kwOk && pass === 1) {
      try {
        const decision = await selectKeyword({ tenantId, title: d.title ?? d.topic ?? kw ?? "", incoming: kw, excludeDraftId: draftId });
        meta = { ...meta, keyword_selection: decision };
        const chosen = decision.status === "selected" ? decision.chosen : null;
        if (chosen?.keyword && chosen.volume != null) {
          const clash = await findLiveDraftFor({ tenantId, keyword: chosen.keyword, excludeId: draftId });
          if (clash) human.add(`Diana: the selected keyword "${chosen.keyword}" is already the target of "${clash.title ?? clash.draftId.slice(0, 8)}". Choose which draft keeps it.`);
          else {
            meta = applyKeywordMeta(meta, chosen.keyword);
            changedThisPass = true;
            improved.push({ what: `Chose the keyword "${chosen.keyword}" (${chosen.volume} searches a month)`, source: `DataForSEO, ${chosen.fetchedAt?.slice(0, 10) ?? "today"}` });
          }
        } else {
          human.add(`Diana: no keyword with search volume was found for this topic. Choose one in Keyword selection.`);
        }
      } catch (e) {
        human.add(`Keyword selection could not run (${e instanceof Error ? e.message : String(e)}). Choose a keyword in Keyword selection.`);
      }
    }

    // 3. The offer outside the CTA.
    const offer = draftLanguage(meta) === "es" ? brief.offerPhraseEs : brief.offerPhrase;
    const strip = (t: string) =>
      t
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !s.toLowerCase().includes(offer.toLowerCase()))
        .join(" ");
    const sectionsWithOffer = content.sections.filter((s) => s.body.toLowerCase().includes(offer.toLowerCase()));
    for (const s of sectionsWithOffer) {
      const nextBody = strip(s.body);
      if (nextBody !== s.body) {
        changes.push({ id: changeId(), where: s.h2, from: s.body, to: nextBody, reason: `"${offer}" belongs in the CTA only (Oct 20 spec, Part 2 item 2).`, source: "improvement", source_ref: "offer_outside_cta", at: now() });
        s.body = nextBody;
      }
    }
    if (content.intro.toLowerCase().includes(offer.toLowerCase())) {
      const next = strip(content.intro);
      changes.push({ id: changeId(), where: "Top", from: content.intro, to: next, reason: `"${offer}" belongs in the CTA only.`, source: "improvement", source_ref: "offer_outside_cta", at: now() });
      content.intro = next;
    }
    if (changes.length) improved.push({ what: `Removed the offer phrase from ${changes.length} place${changes.length === 1 ? "" : "s"} outside the CTA`, source: "fee rule" });

    // 4a. Search data for the keyword (Task A8): search intent and the People
    //     Also Ask questions, one cached DataForSEO call, kept on the draft.
    const keywordNow = draftPrimaryKeyword(meta);
    let uncoveredPaa: string[] = [];
    if (keywordNow && pass === 1) {
      try {
        const serp = await getSerpOverview(keywordNow);
        const r = serpQualityChecks({ keyword: keywordNow, content, format: d.format, serp: { ...serp, fetchedAt: new Date().toISOString() } });
        meta = { ...meta, quality_serp: { keyword: keywordNow, checked_at: new Date().toISOString(), checks: r.checks, uncoveredQuestions: r.uncoveredQuestions } };
        uncoveredPaa = r.uncoveredQuestions;
      } catch (e) {
        human.add(`Search data for "${keywordNow}" could not be read (${e instanceof Error ? e.message : String(e)}); search intent and topic coverage were not checked.`);
      }
    } else {
      uncoveredPaa = readQualitySerp(meta)?.uncoveredQuestions ?? [];
    }

    // 4b. Article gaps.
    const checks = qualityFor({ ...d, metadata: meta }, content);
    const failing = new Set(checks.filter((c) => !c.pass && c.systemFixable).map((c) => c.key));
    const paaToAnswer = uncoveredPaa.filter((q) => !content.faq.some((f) => f.q.toLowerCase() === q.toLowerCase())).slice(0, 3);
    const want = {
      directAnswer: failing.has("direct_answer"),
      faq: Math.max(failing.has("faq") && content.faq.length < 5 ? 5 - content.faq.length : 0, paaToAnswer.length),
      signs: failing.has("signs") && !content.sections.some((s) => s.kind === "signs_you_may_have_a_case"),
    };
    if (want.directAnswer || want.faq || want.signs) {
      const practice = practiceOf(d);
      const pieces = await writePieces(content, draftPrimaryKeyword(meta), practice, want, paaToAnswer).catch(() => ({}) as Pieces);
      // A piece that states a legal claim keeps it only if the source check supports it.
      const verified = async (text: string, label: string): Promise<boolean> => {
        const problem = pieceProblem(text);
        if (problem) {
          human.add(`The new ${label} was not kept: it contained ${problem}.`);
          return false;
        }
        const added = newFigures(text, articleText(content));
        if (added.length) {
          human.add(`The new ${label} was not kept: it stated ${added.slice(0, 2).map((f) => `"${f}"`).join(" and ")}, which the article does not, and no rule has checked it.`);
          return false;
        }
        const claims = extractSourceClaims(text);
        if (!claims.length) return true;
        const results = await checkClaims(tenantId, claims, sourceInputs);
        const bad = results.filter((r) => r.verdict !== "supported");
        if (bad.length) {
          human.add(`Attorney: the new ${label} stated "${bad[0].sentence}", which no source supports, so it was not kept.`);
          return false;
        }
        return true;
      };
      if (want.directAnswer && pieces.direct_answer && (await verified(pieces.direct_answer, "direct answer"))) {
        const text = pieces.direct_answer.trim();
        if (text.split(/\s+/).length <= 60) {
          changes.push({ id: changeId(), where: "Top", from: content.direct_answer, to: text, reason: "A direct answer of 60 words or fewer under the H1 (Task A8).", source: "improvement", source_ref: "direct_answer", at: now() });
          content.direct_answer = text;
          improved.push({ what: "Added a direct answer under the H1", source: "the article" });
        }
      }
      if (want.faq && Array.isArray(pieces.faq)) {
        let added = 0;
        for (const f of pieces.faq.slice(0, want.faq)) {
          if (!f?.q || !f?.a || f.a.split(/\s+/).length > 80) continue;
          if (content.faq.some((x) => x.q.toLowerCase() === f.q.toLowerCase())) continue;
          if (!(await verified(`${f.q} ${f.a}`, "FAQ answer"))) continue;
          content.faq.push({ q: f.q.trim(), a: f.a.trim() });
          changes.push({ id: changeId(), where: "Frequently Asked Questions", from: "", to: `### ${f.q.trim()}\n\n${f.a.trim()}`, reason: "At least five FAQ questions (Task A8).", source: "improvement", source_ref: "faq", at: now() });
          added++;
        }
        if (added) improved.push({ what: `Added ${added} FAQ question${added === 1 ? "" : "s"}`, source: paaToAnswer.length ? "People Also Ask (DataForSEO) and the article" : "the article" });
      }
      if (want.signs && pieces.signs?.items?.length && pieces.signs.items.length >= 5) {
        const bodyText = pieces.signs.items.map((i) => `- ${i.trim()}`).join("\n");
        if (await verified(bodyText, "signs section")) {
          const h2 = (pieces.signs.h2 || practiceSigns(practiceOf(d))).trim();
          content.sections.splice(Math.min(2, content.sections.length), 0, { h2, body: bodyText, kind: "signs_you_may_have_a_case" });
          changes.push({ id: changeId(), where: h2, from: "", to: `## ${h2}\n\n${bodyText}`, reason: "A section with at least five signs the reader may have a case (brand rule, 2026-10-15).", source: "improvement", source_ref: "signs", at: now() });
          improved.push({ what: `Added "${h2}" with ${pieces.signs.items.length} signs`, source: "the article" });
        }
      }
    }

    if (changes.length || meta !== d.metadata) {
      // Anchors for Undo of insertions, against the body as it will read.
      const draftBody = assembleDraft(content, frameBrandFrom(brief, draftLanguage(meta)), { format: d.format, byline: bylineForDraft({ ...d, metadata: meta }, brief) });
      for (const c of changes) if (!c.from) c.anchor_before = ANCHOR(draftBody, c.to);
      await save(tenantId, d, content, meta, changes, brief, before);
      if (changes.length) changedThisPass = true;
    }

    // 5. The source check on every claim not yet checked.
    const sc = await runSourceCheck(tenantId, draftId, { inputs: sourceInputs }).catch((e) => {
      human.add(`The source check could not run (${e instanceof Error ? e.message : String(e)}).`);
      return null;
    });
    if (sc?.checked) improved.push({ what: `Checked ${sc.checked} legal claim${sc.checked === 1 ? "" : "s"} against their primary sources`, source: "knowledge base sources" });
    // Task A14: each new question goes to its attorney by email.
    if (sc?.newQuestionHashes.length) await notifyNewQuestions(tenantId, draftId, sc.newQuestionHashes).catch(() => 0);

    d = await load(tenantId, draftId);
    readiness = await readinessForDraft(tenantId, d);
    if (readiness?.ready || !changedThisPass) break;
  }

  // What only a person can do, from the checklist.
  for (const i of readiness?.items ?? []) {
    if (i.pass) continue;
    if (i.key === "clearance" || i.key === "legal_facts" || i.key === "sources_quality" || i.key === "checks") for (const r of i.reasons) human.add(r);
    else if (i.key === "keyword") for (const r of i.reasons) human.add(`Diana: ${r}`);
    else for (const r of i.reasons) human.add(r);
  }

  const record: ImprovementRecord = { at: new Date().toISOString(), passes, improved, human: [...human], ready: !!readiness?.ready };
  const latest = await load(tenantId, draftId);
  await getSupabaseAdmin()
    .from("content_drafts")
    .update({ metadata: { ...(latest.metadata ?? {}), improvement: record } })
    .eq("tenant_id", tenantId)
    .eq("id", draftId);
  await recordAuditEvent({
    tenantId,
    draftId,
    event: "improve_to_ready",
    actorUserId: args.actor?.id ?? null,
    actorEmail: args.actor?.email ?? null,
    detail: { passes, improved: improved.length, human: record.human.length, ready: record.ready },
  });
  return record;
}
