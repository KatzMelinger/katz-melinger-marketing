const fs=require("fs");
const CR=String.fromCharCode(13), LF=String.fromCharCode(10);
const p="scripts/check-linkedin.ts";
const raw=fs.readFileSync(p,"utf8"); const crlf=raw.includes(CR+LF);
let s=raw.split(CR+LF).join(LF);
const start=s.indexOf("  const { data } = await sb\n    .from(\"social_insights\")");
const end=s.indexOf("  console.log(\"\nWritten.");
if(start<0||end<0) throw new Error("write anchors missing");
const nu=[
'  // social_insights is keyed by tenant_id; there is no id column. Selecting one',
'  // reported "no row to write into" while a row sat there — a wrong-column read',
'  // that reads as an empty table.',
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
'',
].join(LF);
s = s.slice(0,start) + nu + s.slice(end);
fs.writeFileSync(p, crlf?s.split(LF).join(CR+LF):s);
console.log("write path fixed");
