/**
 * Oct 6 spec, Task 5: the knowledge base items still missing on 2026-10-12,
 * as approved by Kenneth Katz (reviewing attorney) that day, with his
 * corrections: the judgment lien is CPLR 5203(a), extendable under 5203(b);
 * Judiciary Law § 519 and N.J.S.A. 2B:20-17 are the NY and NJ jury duty
 * protections. The other 15 of Diana's 18 entries were already live.
 *
 *   node scripts/run.mjs scripts/apply-task5-approved.ts           dry run + self-test
 *   node scripts/run.mjs scripts/apply-task5-approved.ts --apply   write
 *
 * Idempotent: upserts on (tenant_id, entry_type, key) and the trap label.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { matchTrap, rowToTrap } from "../lib/known-traps";
import { checkValuesAgainst } from "../lib/legal-value-check";
import { unverifiedActsAgainst } from "../lib/legal-named-acts";
import type { KbActEntry, KbThresholdEntry } from "../lib/legal-knowledge-base";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = "00000000-0000-0000-0000-000000000001";
const BY = "kenneth-2026-10-12";
const TODAY = "2026-10-12";
const APPLY = process.argv.includes("--apply");

const base = {
  tenant_id: TENANT,
  region: null,
  prior_value: null,
  prior_effective_date: null,
  enforcement_path: null,
  required_qualifier: null,
  never_pair_with: null,
  updated_by: BY,
};

const THRESHOLDS = [
  {
    ...base,
    practice_area: "judgment_enforcement",
    jurisdiction: "NY",
    entry_type: "threshold",
    key: "ny_judgment_lien_real_property",
    label: "NY judgment lien on real property",
    aliases: [],
    canonical_citation: "CPLR 5203(a); extension under CPLR 5203(b)",
    citation_says: "A docketed judgment is a lien on the debtor's real property in that county for 10 years from docketing, extendable under CPLR 5203(b).",
    unit: "years",
    current_value: 10,
    effective_date: null,
    match_keywords: ["judgment lien|lien on real property|lien against real property|lien on the property|real property lien"],
    source_url: "https://www.nysenate.gov/legislation/laws/CVP/5203",
    notes: "Approved by Kenneth Katz 2026-10-12 (Oct 6 spec, Task 5, kb_judgment_lien): 10 years from docketing in that county under CPLR 5203(a), extendable under 5203(b). The money judgment itself is enforceable for 20 years (ny_money_judgment_enforceable).",
  },
  {
    ...base,
    practice_area: "judgment_enforcement",
    jurisdiction: "NY",
    entry_type: "threshold",
    key: "ny_money_judgment_enforceable",
    label: "NY money judgment enforcement period",
    aliases: [],
    canonical_citation: "CPLR 211(b)",
    citation_says: "An action on a money judgment may be commenced within 20 years.",
    unit: "years",
    current_value: 20,
    effective_date: null,
    match_keywords: ["money judgment|judgment is enforceable|judgment remains enforceable|enforce the judgment|enforce a judgment", "enforceable|enforce|valid|good for|lasts"],
    source_url: "https://www.nysenate.gov/legislation/laws/CVP/211",
    notes: "Approved by Kenneth Katz 2026-10-12 (Oct 6 spec, Task 5, kb_judgment_lien): the money judgment is enforceable for 20 years (CPLR 211(b)).",
  },
];

const ACTS = [
  {
    key: "sox_whistleblower",
    label: "Sarbanes-Oxley Act",
    aliases: ["Sarbanes Oxley Act", "Sarbanes-Oxley", "SOX"],
    jurisdiction: "federal",
    practice_area: "employment",
    canonical_citation: "18 U.S.C. § 1514A",
    citation_says: "Whistleblower protection for employees of publicly traded companies.",
    source_url: "https://www.law.cornell.edu/uscode/text/18/1514A",
  },
  {
    key: "dodd_frank_whistleblower",
    label: "Dodd-Frank Act whistleblower protection",
    aliases: ["Dodd-Frank Act", "Dodd Frank Act", "Dodd-Frank Wall Street Reform and Consumer Protection Act", "Dodd-Frank"],
    jurisdiction: "federal",
    practice_area: "employment",
    canonical_citation: "15 U.S.C. § 78u-6(h)",
    citation_says: "Protects SEC whistleblowers from retaliation.",
    source_url: "https://www.law.cornell.edu/uscode/text/15/78u-6",
  },
  {
    key: "ny_judiciary_law_519",
    label: "New York Judiciary Law § 519",
    aliases: ["Judiciary Law § 519", "Judiciary Law 519", "Judiciary Law", "Section 519 of the Judiciary Law"],
    jurisdiction: "NY",
    practice_area: "employment",
    canonical_citation: "N.Y. Judiciary Law § 519",
    citation_says: "Protects employees from being penalized for being summoned to jury duty in New York.",
    source_url: "https://www.nysenate.gov/legislation/laws/JUD/519",
  },
  {
    key: "njsa_2b_20_17",
    label: "N.J.S.A. 2B:20-17",
    aliases: ["2B:20-17", "N.J.S.A. 2B:20-17"],
    jurisdiction: "NJ",
    practice_area: "employment",
    canonical_citation: "N.J.S.A. 2B:20-17",
    citation_says: "Protects employees from being penalized for being summoned to jury duty in New Jersey.",
    source_url: "https://lis.njleg.state.nj.us/",
  },
].map((a) => ({
  ...base,
  ...a,
  entry_type: "named_act",
  unit: null,
  current_value: null,
  effective_date: null,
  match_keywords: [],
  notes: `Approved by Kenneth Katz ${TODAY} (Oct 6 spec, Task 5, named acts list).`,
}));

const TRAP = {
  tenant_id: TENANT,
  label: "NJ settlement nondisclosure described as enforceable",
  match_type: "regex",
  match_on: "sentences",
  pattern: "(?=.*\\b(?:New Jersey|NJ)\\b)(?=.*\\bsettlement)(?=.*\\b(?:non-?disclosure|NDA|confidential(?:ity)?|keep (?:it|the terms) (?:secret|private))\\b)",
  unless: ["unenforceable", "not enforceable", "cannot be enforced", "can't be enforced", "10:5-12.8", "void", "barred"],
  severity: "important",
  note: "Approved by Kenneth Katz 2026-10-12 (Task 5, kb_nj_nda): under N.J.S.A. 10:5-12.8, settlement terms that conceal details of discrimination, retaliation or harassment claims are unenforceable against the employee.",
  enabled: true,
  case_sensitive: false,
  regex_flags: null,
  scope: null,
  applies_to: "all",
};

// ---------------------------------------------------------------- self-test
let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};
const kb: KbThresholdEntry[] = THRESHOLDS.map((t) => ({
  key: t.key, label: t.label, practiceArea: t.practice_area, jurisdiction: "NY", region: null, unit: "years",
  currentValue: t.current_value, effectiveDate: null, priorValue: null, priorEffectiveDate: null,
  scheduledValue: null, scheduledEffectiveDate: null, matchKeywords: t.match_keywords,
  enforcementPath: null, sourceUrl: t.source_url, notes: t.notes,
}));
expect(checkValuesAgainst("In New York, a judgment lien on real property lasts 5 years.", kb).length === 1, "wrong lien period flagged");
expect(checkValuesAgainst("A judgment lien on real property lasts 10 years and can be extended.", kb).length === 0, "correct lien period passes");
expect(checkValuesAgainst("A money judgment is enforceable for 10 years in New York.", kb).length === 1, "wrong judgment period flagged");
expect(checkValuesAgainst("The lien on real property lasts 10 years, while the money judgment is enforceable for 20 years.", kb).length === 0,
  "both correct periods in one sentence pass");
const acts: KbActEntry[] = ACTS.map((a) => ({ key: a.key, label: a.label, aliases: a.aliases, jurisdiction: a.jurisdiction as KbActEntry["jurisdiction"], canonicalCitation: a.canonical_citation }));
expect(unverifiedActsAgainst("The Sarbanes-Oxley Act and the Dodd-Frank Act protect whistleblowers. New York Judiciary Law protects jurors.", acts).length === 0,
  "new law names recognized");
const trap = rowToTrap({ id: "t", ...TRAP });
expect(matchTrap(trap, "In New Jersey, a settlement can include a nondisclosure agreement covering harassment claims.").length === 1, "NJ NDA trap fires");
expect(matchTrap(trap, "In New Jersey, a settlement nondisclosure term concealing harassment details is unenforceable against the employee.").length === 0,
  "correct NJ statement passes");
expect(matchTrap(trap, "In New York, a settlement can include a confidentiality clause at the employee's preference.").length === 0, "NY sentence ignored");
if (failed) {
  console.log(`${failed} self-test failure(s); nothing written.`);
  process.exit(1);
}
console.log("self-test passed");

// ---------------------------------------------------------------- write
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const keys = [...THRESHOLDS, ...ACTS].map((r) => r.key);
  const { data: existing } = await sb.from("legal_knowledge_base").select("key, version").eq("tenant_id", TENANT).in("key", keys);
  const { data: trapRow } = await sb.from("content_known_traps").select("id").eq("tenant_id", TENANT).ilike("label", TRAP.label).maybeSingle();
  for (const r of [...THRESHOLDS, ...ACTS]) {
    const prev = existing?.find((e) => e.key === r.key);
    console.log(`${prev ? "update" : "insert"} ${r.entry_type} ${r.key}`);
  }
  console.log(`${trapRow ? "update" : "insert"} trap "${TRAP.label}"`);
  if (!APPLY) {
    console.log("dry run: nothing written (add --apply)");
    return;
  }
  for (const r of [...THRESHOLDS, ...ACTS]) {
    const prev = existing?.find((e) => e.key === r.key);
    const { error } = await sb
      .from("legal_knowledge_base")
      .upsert({ ...r, version: ((prev?.version as number | undefined) ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,entry_type,key" });
    console.log(error ? `ERROR ${r.key}: ${error.message}` : `ok ${r.key}`);
  }
  const { error } = trapRow
    ? await sb.from("content_known_traps").update({ ...TRAP, updated_at: new Date().toISOString() }).eq("id", trapRow.id)
    : await sb.from("content_known_traps").insert(TRAP);
  console.log(error ? `ERROR trap: ${error.message}` : "ok trap");
}
main();
