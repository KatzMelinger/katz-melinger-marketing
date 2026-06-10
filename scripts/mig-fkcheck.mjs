// Read-only: find foreign keys that cross the marketing<->CMS boundary.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2];}return o;}
const env = loadEnv('.env.migration');

const sqlText = fs.readdirSync('supabase').filter(f=>f.endsWith('.sql')).map(f=>fs.readFileSync(path.join('supabase',f),'utf8')).join('\n');
const schema = new Set([...sqlText.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi)].map(m=>m[1].toLowerCase()));
const code = new Set(`calls call_scores keyword_research_jobs marketing_spend prospects reviews social_posts sales_activities sales_rubric sales_training_materials constant_contact_automation constant_contact_sync_log oauth_tokens brand_voice recommendation_items`.split(/\s+/));
const MARKETING = new Set([...schema, ...code]); // A + B + C candidates

const client = new pg.Client({host:env.OLD_DB_HOST,port:5432,user:'postgres',password:env.OLD_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await client.connect();
const fks = (await client.query(`
  select tc.table_name as src, ccu.table_name as tgt, tc.constraint_name as name
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
  order by 1,2`)).rows;
await client.end();

const inMkt = t => MARKETING.has(t);
const crossing = fks.filter(f => inMkt(f.src) && !inMkt(f.tgt));   // marketing -> CMS  (must drop)
const internal = fks.filter(f => inMkt(f.src) && inMkt(f.tgt));    // marketing -> marketing (keep, ordering)
console.log(`Total FKs: ${fks.length}`);
console.log(`\nCROSS-BOUNDARY (marketing -> CMS, must DROP on migrate) [${crossing.length}]:`);
for (const f of crossing) console.log(`  ${f.src}  ->  ${f.tgt}   (${f.name})`);
console.log(`\nINTERNAL (marketing -> marketing, keep; defines load order) [${internal.length}]:`);
for (const f of internal) console.log(`  ${f.src}  ->  ${f.tgt}`);
