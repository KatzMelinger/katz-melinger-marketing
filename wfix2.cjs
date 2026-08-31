const fs=require("fs");
const CR=String.fromCharCode(13), LF=String.fromCharCode(10);
const p="scripts/check-linkedin.ts";
const raw=fs.readFileSync(p,"utf8"); const crlf=raw.includes(CR+LF);
let lines=raw.split(CR+LF).join(LF).split(LF);
// Replace lines 132..146 (1-based) i.e. indices 131..145
const startIdx = lines.findIndex(l => l.includes('const { data } = await sb'));
const endIdx = lines.findIndex(l => l.includes('if (error) { console.log("\nWrite failed: "'));
if (startIdx < 0 || endIdx < 0) throw new Error("anchors missing");
const nu = [
'  // social_insights is keyed by tenant_id and has NO id column. Selecting "id"',
'  // made the read fail and report "no row to write into" while a row sat there —',
'  // a wrong-column read that looks exactly like an empty table.',
'  const { data, error: readErr } = await sb',
'    .from("social_insights")',
'    .select("tenant_id, report_audience")',
'    .eq("tenant_id", tenantId)',
'    .maybeSingle();',
'  if (readErr) { console.log("\nCould not read social_insights: " + readErr.message); process.exit(1); }',
'  if (!data) {',
'    console.log("\nNo social_insights row for this tenant — open the monthly report once first.");',
'    return;',
'  }',
'  const current = ((data as Record<string, unknown>).report_audience ?? {}) as Record<string, unknown>;',
'',
'  // Instagram is still hand-entered and stays exactly as it is. Only the',
'  // LinkedIn half has a source to replace it.',
'  const next = { ...current, linkedin: mapped.audience };',
'  const { error } = await sb',
'    .from("social_insights")',
'    .update({ report_audience: next, updated_at: new Date().toISOString() })',
'    .eq("tenant_id", tenantId);',
'  if (error) { console.log("\nWrite failed: " + error.message); process.exit(1); }',
];
lines.splice(startIdx, endIdx - startIdx + 1, ...nu);
const out = lines.join(LF);
fs.writeFileSync(p, crlf?out.split(LF).join(CR+LF):out);
console.log("write path fixed");
