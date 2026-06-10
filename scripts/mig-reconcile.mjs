// Reconcile: live OLD tables vs marketing schema files vs code .from() refs.
// Read-only. Categorizes every table to define the migration allowlist.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function loadEnv(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnv('.env.migration');

// schema-file tables
const sqlText = fs.readdirSync('supabase').filter(f => f.endsWith('.sql'))
  .map(f => fs.readFileSync(path.join('supabase', f), 'utf8')).join('\n');
const schema = new Set([...sqlText.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()));
// code-referenced tables (from `git grep .from('table')`)
const code = new Set(`ad_compliance_checks ad_creatives ad_platform_accounts aeo_prompts aeo_responses
aeo_runs aeo_targets ai_bot_hits ai_projects ai_prompt_runs ai_prompts ai_search_scans app_users
brand_voice brand_voice_avatars brand_voice_documents brand_voice_profiles brand_voice_samples
brand_voice_settings brief_suggestions call_scores calls cannibalization_snapshots community_post_status
constant_contact_automation constant_contact_sync_log constant_contact_tokens content_analyses
content_batches content_drafts content_pipeline content_skills content_sources generated_images
google_oauth_tokens image_style_assets image_style_channels image_style_settings internal_link_audits
keyword_research_jobs legal_authority_sources llms_txt_versions marketing_alert_rules marketing_alerts
marketing_spend negative_keywords oauth_tokens people_ask_sources practice_areas prospects
recommendation_items recommendations_history research_packets reviews sales_activities sales_rubric
sales_training_materials semrush_cache seo_disavow_actions seo_keywords seo_opportunities
seo_target_keywords seo_tracked_competitors site_pages social_posts technical_seo_runs tenant_settings
video_renders wp_autopilot_recommendations wp_autopilot_tokens`.split(/\s+/).filter(Boolean));

const client = new pg.Client({ host: env.OLD_DB_HOST, port: 5432, user: 'postgres', password: env.OLD_DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await client.connect();
const live = new Map();
for (const r of (await client.query(
  `select t.table_name,
     coalesce((select reltuples::bigint from pg_class where oid = ('public.'||t.table_name)::regclass),0) as est
   from information_schema.tables t
   where t.table_schema='public' and t.table_type='BASE TABLE'`)).rows) {
  live.set(r.table_name, Number(r.est));
}
await client.end();

const A = [], B = [], C = [], D = [];
for (const t of new Set([...schema, ...code, ...live.keys()])) {
  const inS = schema.has(t), inC = code.has(t), inL = live.has(t);
  if (inS && inL) A.push(t);                 // owned + present -> migrate
  else if (inS && !inL) B.push(t);           // owned but never applied
  else if (!inS && inC && inL) C.push(t);    // code reads it, we don't own it -> AMBIGUOUS
  else if (inL) D.push(t);                    // pure CMS -> stays behind
}
const fmt = a => a.sort().map(t => `${t}${live.has(t)?` (${live.get(t)})`:''}`).join(', ');
console.log(`\nA. OWNED + PRESENT  -> MIGRATE  (${A.length}):\n  ${fmt(A)}`);
console.log(`\nB. OWNED, NOT IN LIVE (never applied) -> create empty  (${B.length}):\n  ${fmt(B)}`);
console.log(`\nC. CODE READS, NOT OWNED -> DECIDE  (${C.length}):\n  ${fmt(C)}`);
console.log(`\nD. PURE CMS -> STAYS BEHIND  (${D.length}):\n  ${fmt(D)}`);
