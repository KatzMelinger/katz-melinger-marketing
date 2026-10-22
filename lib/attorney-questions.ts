/**
 * Attorney review that does not stall (Oct 20 spec, Task A14).
 *
 * A question is a legal claim the source check (Task A7) could not settle:
 * no knowledge base entry, a source that does not address it, or a
 * contradiction Improve to Ready could not fix. Each goes to the practice
 * area's reviewing attorney (Brand settings reviewersByPractice), who sees
 * only their questions: the sentence, the source passage, and two answers.
 *
 *   Approve as is   the sentence is right: saved, and accepted in every draft.
 *   Replace with    the attorney's sentence replaces it in the draft (logged in
 *                   Changes made), is approved, and the fixer applies the same
 *                   correction wherever the old sentence appears.
 *
 * The attorney is emailed when a question is assigned (questions only, with a
 * direct link), reminded after 2 business days, and after 4 business days the
 * question is shown to Kenneth as overdue. When a draft's last question is
 * answered and the draft is Ready, Diana and the publishers are told.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { getOperatingBrief, type OperatingBrief } from "./social-operating-brief";
import { readContent, type DraftContent } from "./draft-frame";
import { frameDraftWith, reviewAreaForDraft, type DraftForFrame } from "./draft-frame-server";
import { readSourceCheck, sourceStatus, decisionQuestion, type SourceCheckEntry, type SourceCheckRecord } from "./source-check";
import { loadSourceCheckInputs, type SourceCheckInputs } from "./source-check-server";
import { learnApproval, learnCorrection, sentenceKey } from "./legal-learned";
import { appendRun, changeId, readFixLog } from "./legal-fix-log";
import { AUTHORS } from "./authors";
import { adminEmails, sendEmails } from "./notify-shared";
import { loadPublishers } from "./publish-permission";
import { readinessForDraft } from "./draft-readiness-server";
import { recordAuditEvent } from "./content-findings-store";
import type { ReviewArea } from "./legal-reviewers";
import { saveVersion } from "./draft-versions";

export type AttorneyQuestion = {
  draftId: string;
  draftTitle: string;
  area: ReviewArea | null;
  attorney: string | null;
  attorneyEmail: string | null;
  hash: string;
  sentence: string;
  verdict: SourceCheckEntry["verdict"];
  question: string;
  passage: string | null;
  sourceUrl: string | null;
  kbLabel: string | null;
  askedAt: string;
  businessDaysOpen: number;
  overdue: boolean;
  remindedAt: string | null;
};

const KENNETH = "kjkatz@katzmelinger.com";

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://katz-melinger-marketing.vercel.app"
  );
}

/** Weekdays elapsed between two instants, in New York time (holidays not counted). */
export function businessDaysBetween(fromIso: string, now: Date = new Date()): number {
  const day = (d: Date) =>
    new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d) + "T12:00:00Z");
  let d = day(new Date(fromIso));
  const end = day(now);
  let n = 0;
  while (d < end) {
    d = new Date(d.getTime() + 864e5);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

function emailFor(name: string | null): string | null {
  if (!name) return null;
  const key = (s: string) => s.toLowerCase().replace(/\s+[a-z]\.\s+/, " ").trim();
  return AUTHORS.find((a) => key(a.name.replace(/\s+[A-Z]\.\s+/, " ")) === key(name))?.email ?? null;
}

type DraftRow = DraftForFrame & { id: string; status: string };

function questionsFor(d: DraftRow, content: DraftContent, record: SourceCheckRecord | null, inputs: SourceCheckInputs, brief: OperatingBrief, now: Date): AttorneyQuestion[] {
  const st = sourceStatus(content, record, inputs.thresholds, inputs.statutes, inputs.approved, sentenceKey);
  const area = reviewAreaForDraft(d);
  const attorney = area ? brief.reviewersByPractice[area].name : null;
  return st.current
    .filter((e) => e.verdict === "not_found" || e.verdict === "no_entry" || e.verdict === "contradicted")
    .map((e) => {
      const days = businessDaysBetween(e.checked_at || new Date().toISOString(), now);
      return {
        draftId: d.id,
        draftTitle: d.title ?? "(untitled)",
        area,
        attorney,
        attorneyEmail: emailFor(attorney),
        hash: e.hash,
        sentence: e.sentence,
        verdict: e.verdict,
        question:
          e.verdict === "contradicted"
            ? `The source says otherwise (${e.reason}). Is the sentence correct as written? If not, give the correct sentence.`
            : decisionQuestion(e),
        passage: e.quote ?? e.closest ?? null,
        sourceUrl: e.source_url,
        kbLabel: e.kb_label,
        askedAt: e.checked_at,
        businessDaysOpen: days,
        overdue: days >= 4,
        remindedAt: (e as SourceCheckEntry & { reminded_at?: string }).reminded_at ?? null,
      };
    });
}

async function openDrafts(tenantId: string, draftId?: string): Promise<DraftRow[]> {
  let q = getSupabaseAdmin()
    .from("content_drafts")
    .select("id, status, body, title, topic, format, practice_area, metadata")
    .eq("tenant_id", tenantId)
    .not("status", "in", "(archived,published)");
  if (draftId) q = q.eq("id", draftId);
  const { data, error } = await q.range(0, 1999);
  if (error) throw new Error(error.message);
  return (data ?? []) as DraftRow[];
}

export async function listQuestions(tenantId: string, opts: { draftId?: string; attorneyEmail?: string | null } = {}): Promise<AttorneyQuestion[]> {
  const [drafts, inputs, brief] = await Promise.all([openDrafts(tenantId, opts.draftId), loadSourceCheckInputs(tenantId), getOperatingBrief(tenantId)]);
  const now = new Date();
  const out: AttorneyQuestion[] = [];
  for (const d of drafts) {
    const content = readContent(d.metadata);
    const record = readSourceCheck(d.metadata);
    if (!content || !record) continue;
    out.push(...questionsFor(d, content, record, inputs, brief, now));
  }
  const mine = opts.attorneyEmail ? out.filter((q) => q.attorneyEmail?.toLowerCase() === opts.attorneyEmail!.toLowerCase()) : out;
  return mine.sort((a, b) => b.businessDaysOpen - a.businessDaysOpen || a.draftTitle.localeCompare(b.draftTitle));
}

/** Replace the first occurrence of a sentence in the article. Null when it is not there. */
export function replaceInContent(content: DraftContent, from: string, to: string): DraftContent | null {
  const swap = (t: string) => (t.includes(from) ? t.replace(from, to) : null);
  const c: DraftContent = JSON.parse(JSON.stringify(content));
  for (const k of ["direct_answer", "intro"] as const) {
    const r = swap(c[k]);
    if (r !== null) {
      c[k] = r;
      return c;
    }
  }
  for (const s of c.sections) {
    const r = swap(s.body);
    if (r !== null) {
      s.body = r;
      return c;
    }
  }
  for (const f of c.faq) {
    const r = swap(f.a);
    if (r !== null) {
      f.a = r;
      return c;
    }
  }
  return null;
}

export async function answerQuestion(args: {
  tenantId: string;
  draftId: string;
  hash: string;
  action: "approve" | "replace";
  replacement?: string | null;
  by: { id: string | null; email: string };
}): Promise<{ remaining: number; ready: boolean }> {
  const sb = getSupabaseAdmin();
  const [d] = await openDrafts(args.tenantId, args.draftId);
  if (!d) throw new Error("Draft not found or not open.");
  const meta = { ...(d.metadata ?? {}) };
  const record = readSourceCheck(meta);
  const entry = record?.entries.find((e) => e.hash === args.hash);
  if (!record || !entry) throw new Error("That question is no longer open (the sentence changed).");
  const now = new Date().toISOString();

  if (args.action === "approve") {
    await learnApproval({ tenantId: args.tenantId, sentence: entry.sentence, by: args.by.email, draftId: d.id, rule: "source_check" });
    const entries = record.entries.map((e) => (e.hash === args.hash ? { ...e, verdict: "answered" as const, reason: `Approved as is by ${args.by.email}.`, checked_at: now } : e));
    await sb.from("content_drafts").update({ metadata: { ...meta, source_check: { ...record, entries } } }).eq("tenant_id", args.tenantId).eq("id", d.id);
  } else {
    const to = (args.replacement ?? "").trim();
    if (to.length < 10) throw new Error("Write the correct sentence.");
    const content = readContent(meta);
    if (!content) throw new Error("This draft is not in the frame.");
    const next = replaceInContent(content, entry.sentence, to);
    if (!next) throw new Error("The sentence is no longer in the article.");
    const brief = await getOperatingBrief(args.tenantId);
    const framed = frameDraftWith({ ...d, metadata: { ...meta, content: next } }, brief, { fromContent: true });
    if (!framed) throw new Error("Could not rebuild the draft.");
    const at = framed.body.indexOf(to);
    const log = appendRun(readFixLog(meta), {
      previousTitle: d.title,
      previousBody: d.body,
      changes: [
        {
          id: changeId(),
          where: "Body",
          from: entry.sentence,
          to,
          reason: `Replaced by ${args.by.email} in attorney review (Oct 20 spec, Task A14).`,
          source: "attorney decision",
          source_ref: "attorney_question",
          anchor_before: at > 0 ? framed.body.slice(Math.max(0, at - 60), at) : "",
          at: now,
        },
      ],
    });
    // The attorney's own sentence is approved; the old one is corrected wherever it appears.
    await learnCorrection({ tenantId: args.tenantId, from: entry.sentence, to, by: args.by.email, draftId: d.id, rule: "source_check" });
    await learnApproval({ tenantId: args.tenantId, sentence: to, by: args.by.email, draftId: d.id, rule: "source_check" });
    const entries = record.entries.filter((e) => e.hash !== args.hash);
    // Task A17: the version before the attorney's replacement is kept.
    await saveVersion({ tenantId: args.tenantId, draftId: d.id, title: d.title, body: d.body, content: meta.content, reason: "before an attorney's replacement", by: args.by.email });
    await sb
      .from("content_drafts")
      .update({ body: framed.body, metadata: { ...framed.metadata, legal_fix_log: log, source_check: { ...record, entries } }, updated_at: now })
      .eq("tenant_id", args.tenantId)
      .eq("id", d.id);
  }
  await recordAuditEvent({
    tenantId: args.tenantId,
    draftId: d.id,
    event: args.action === "approve" ? "attorney_question_approved" : "attorney_question_replaced",
    actorUserId: args.by.id,
    actorEmail: args.by.email,
    detail: { sentence: entry.sentence.slice(0, 200) },
  });

  const remaining = (await listQuestions(args.tenantId, { draftId: d.id })).length;
  let ready = false;
  if (remaining === 0) {
    const [fresh] = await openDrafts(args.tenantId, d.id);
    ready = !!fresh && !!(await readinessForDraft(args.tenantId, fresh))?.ready;
    if (ready) {
      const to = [...new Set([...(await loadPublishers(args.tenantId)), ...adminEmails()])];
      await sendEmails(to, `Ready for Diana: ${d.title ?? "a draft"}`, `Every legal question on "${d.title}" is answered and the draft passes its checklist.\n\nOpen it: ${appUrl()}/content/drafts?id=${d.id}`).catch(() => 0);
    }
  }
  return { remaining, ready };
}

/** Email each attorney the questions newly assigned to them (called after a source check). */
export async function notifyNewQuestions(tenantId: string, draftId: string, newHashes: string[]): Promise<number> {
  if (!newHashes.length) return 0;
  const qs = (await listQuestions(tenantId, { draftId })).filter((q) => newHashes.includes(q.hash));
  const byEmail = new Map<string, AttorneyQuestion[]>();
  for (const q of qs) if (q.attorneyEmail) byEmail.set(q.attorneyEmail, [...(byEmail.get(q.attorneyEmail) ?? []), q]);
  let sent = 0;
  for (const [email, list] of byEmail) {
    sent += await sendEmails(
      [email],
      `${list.length} legal question${list.length === 1 ? "" : "s"} for you: ${list[0].draftTitle}`,
      `Please answer ${list.length === 1 ? "this question" : "these questions"} in Huraqan (Approve as is, or Replace with the correct sentence):\n\n` +
        list.map((q, i) => `${i + 1}. "${q.sentence}"\n   ${q.question}${q.passage ? `\n   Source passage: "${q.passage.slice(0, 300)}"` : ""}`).join("\n\n") +
        `\n\nAnswer here: ${appUrl()}/content/attorney-questions`,
    ).catch(() => 0);
  }
  return sent;
}

/**
 * Daily: remind an attorney about questions open 2+ business days (at most
 * every 2 business days), and show Kenneth every question open 4+ days.
 */
export async function sendReminders(tenantId: string): Promise<{ reminded: number; overdue: number }> {
  const qs = await listQuestions(tenantId);
  const due = qs.filter((q) => q.businessDaysOpen >= 2 && (!q.remindedAt || businessDaysBetween(q.remindedAt) >= 2));
  const byEmail = new Map<string, AttorneyQuestion[]>();
  for (const q of due) if (q.attorneyEmail) byEmail.set(q.attorneyEmail, [...(byEmail.get(q.attorneyEmail) ?? []), q]);
  let reminded = 0;
  for (const [email, list] of byEmail) {
    reminded += await sendEmails(
      [email],
      `Reminder: ${list.length} legal question${list.length === 1 ? "" : "s"} waiting for you`,
      `These have been waiting 2 or more business days:\n\n` +
        list.map((q) => `- ${q.draftTitle}: "${q.sentence}" (${q.businessDaysOpen} business days)`).join("\n") +
        `\n\nAnswer here: ${appUrl()}/content/attorney-questions`,
    ).catch(() => 0);
  }
  // Stamp the reminder on each entry so the next one waits 2 business days.
  const stamp = new Date().toISOString();
  const byDraft = new Map<string, Set<string>>();
  for (const q of due) byDraft.set(q.draftId, new Set([...(byDraft.get(q.draftId) ?? []), q.hash]));
  for (const [draftId, hashes] of byDraft) {
    const [d] = await openDrafts(tenantId, draftId);
    const record = d ? readSourceCheck(d.metadata) : null;
    if (!d || !record) continue;
    const entries = record.entries.map((e) => (hashes.has(e.hash) ? { ...e, reminded_at: stamp } : e));
    await getSupabaseAdmin().from("content_drafts").update({ metadata: { ...(d.metadata ?? {}), source_check: { ...record, entries } } }).eq("tenant_id", tenantId).eq("id", draftId);
  }
  const overdue = qs.filter((q) => q.overdue);
  if (overdue.length) {
    await sendEmails(
      [KENNETH],
      `Overdue legal questions: ${overdue.length}`,
      `Open 4 or more business days:\n\n` +
        overdue.map((q) => `- ${q.attorney ?? "No attorney (practice area not set)"}: ${q.draftTitle}: "${q.sentence}" (${q.businessDaysOpen} business days)`).join("\n") +
        `\n\n${appUrl()}/content/attorney-questions`,
    ).catch(() => 0);
  }
  return { reminded, overdue: overdue.length };
}
