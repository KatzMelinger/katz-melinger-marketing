/**
 * Loads what isReady() needs (Oct 20 spec, Task A4): Brand settings and each
 * draft's open findings. A finding quoting text that is no longer in the body
 * is ignored (Task 21), so an edit that fixed a sentence is not still held
 * by its old finding.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { getOperatingBrief } from "./social-operating-brief";
import { quoteStillPresent } from "./finding-currency";
import { isReady, type Readiness, type ReadinessFinding } from "./draft-readiness";
import { isFramedFormat, readContent } from "./draft-frame";
import { qualityForDraft, qualityNotes } from "./quality-checks";
import { readQualitySerp } from "./quality-checks-serp";
import { loadSourceCheckInputs } from "./source-check-server";
import type { DraftForFrame } from "./draft-frame-server";

export async function readinessFor(
  tenantId: string,
  drafts: (DraftForFrame & { id: string })[],
): Promise<Map<string, Readiness>> {
  const out = new Map<string, Readiness>();
  const framed = drafts.filter((d) => isFramedFormat(d.format));
  if (framed.length === 0) return out;
  const [brief, sources] = await Promise.all([getOperatingBrief(tenantId), loadSourceCheckInputs(tenantId).catch(() => undefined)]);
  const sb = getSupabaseAdmin();
  const byDraft = new Map<string, (ReadinessFinding & { draftId: string })[]>();
  const ids = framed.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from("content_findings")
      .select("draft_id, severity, source, rule_id, title, excerpt")
      .in("draft_id", ids.slice(i, i + 200))
      .in("status", ["open", "in_progress"])
      .range(0, 4999);
    if (error && !/content_findings|does not exist|schema cache/i.test(error.message)) {
      // Cannot read findings: no draft may look ready on a check that could not run.
      for (const d of framed) {
        out.set(d.id, {
          applicable: true,
          ready: false,
          failing: ["checks"],
          items: [{ key: "checks", label: "No open critical finding", pass: false, reasons: [`Could not read the findings (${error.message}).`] }],
        });
      }
      return out;
    }
    for (const r of data ?? []) {
      const list = byDraft.get(r.draft_id as string) ?? [];
      list.push({
        draftId: r.draft_id as string,
        severity: r.severity as string,
        source: r.source as string,
        ruleId: (r.rule_id as string | null) ?? null,
        title: (r.title as string) ?? "",
        excerpt: (r.excerpt as string | null) ?? null,
      });
      byDraft.set(r.draft_id as string, list);
    }
  }
  for (const d of framed) {
    const current = (byDraft.get(d.id) ?? []).filter((f) => quoteStillPresent(f, d.body ?? "") !== false);
    // Task A8: the quality checks, information only until calibrated.
    const content = readContent(d.metadata);
    const quality = content ? qualityNotes([...qualityForDraft(d, content), ...(readQualitySerp(d.metadata)?.checks ?? [])]) : [];
    out.set(d.id, isReady(d, brief, current, sources, quality));
  }
  return out;
}

export async function readinessForDraft(tenantId: string, d: DraftForFrame & { id: string }): Promise<Readiness | null> {
  return (await readinessFor(tenantId, [d])).get(d.id) ?? null;
}
