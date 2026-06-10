/**
 * Marketing-slice migration: OLD (shared CMS Supabase) -> NEW (dedicated).
 *
 * Faithful, repo-independent: reconstructs DDL from the live OLD catalog using
 * Postgres's own pg_get_*def emitters, copies data via COPY (text format), then
 * adds FKs/triggers and resyncs sequences. Reads OLD, writes NEW only.
 *
 * Phases (run in order):  schema  ->  data  ->  final  ->  verify
 *   node scripts/mig-run.mjs <phase>
 *
 * Idempotent-ish: safe to re-run a phase; uses IF NOT EXISTS / drop-if-exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';

const phase = process.argv[2];
if (!['schema', 'data', 'final', 'verify'].includes(phase)) {
  console.error('usage: node scripts/mig-run.mjs <schema|data|final|verify>');
  process.exit(1);
}

function loadEnv(p) { const o = {}; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2]; } return o; }
const env = loadEnv('.env.migration');
const cfg = (host, pw) => ({ host, port: 5432, user: 'postgres', password: pw, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });

// ---- allowlist: marketing tables present in OLD live (A + C) -----------------
const sqlText = fs.readdirSync('supabase').filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.join('supabase', f), 'utf8')).join('\n');
const schemaTables = new Set([...sqlText.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()));
const codeC = `calls call_scores keyword_research_jobs marketing_spend prospects reviews social_posts sales_activities sales_rubric sales_training_materials constant_contact_automation constant_contact_sync_log oauth_tokens brand_voice`.split(/\s+/);
const MARKETING = new Set([...schemaTables, ...codeC]);

async function liveTables(client) {
  const r = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  return r.rows.map(x => x.table_name).filter(t => MARKETING.has(t)).sort();
}

const log = (...a) => console.log(...a);
async function run(client, label, sql) {
  try { await client.query(sql); return true; }
  catch (e) { log(`  ! ${label}: ${e.message.split('\n')[0]}`); return false; }
}

// =============================================================================
async function doSchema() {
  const oldDb = new pg.Client(cfg(env.OLD_DB_HOST, env.OLD_DB_PASSWORD));
  const newDb = new pg.Client(cfg(env.NEW_DB_HOST, env.NEW_DB_PASSWORD));
  await oldDb.connect(); await newDb.connect();
  const tables = await liveTables(oldDb);
  log(`Tables to build: ${tables.length}`);

  // 1. enum types used by these tables
  const enums = (await oldDb.query(`
    select distinct t.typname,
      (select string_agg(quote_literal(e.enumlabel), ',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) as labels
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_type t on t.oid=a.atttypid
    where n.nspname='public' and c.relname=any($1) and t.typtype='e'`, [tables])).rows;
  for (const e of enums) await run(newDb, `type ${e.typname}`, `do $$ begin if not exists (select 1 from pg_type where typname='${e.typname}') then create type public.${e.typname} as enum (${e.labels}); end if; end $$;`);
  log(`Enums: ${enums.length}`);

  // 2. columns
  const cols = (await oldDb.query(`
    select c.relname as tbl, a.attname as col, format_type(a.atttypid,a.atttypmod) as type,
           a.attnotnull as notnull, a.attgenerated as gen,
           pg_get_expr(ad.adbin, ad.adrelid) as def, a.attnum
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1) and a.attnum>0 and not a.attisdropped
    order by c.relname, a.attnum`, [tables])).rows;
  const byTable = {};
  for (const c of cols) (byTable[c.tbl] ??= []).push(c);

  // 2a. pre-create sequences referenced by serial-column defaults (nextval).
  const seqNames = new Set();
  for (const c of cols) { const m = c.def && c.def.match(/nextval\('([^']+?)'(?:::regclass)?\)/i); if (m) seqNames.add(m[1].replace(/^public\./, '')); }
  for (const s of seqNames) await run(newDb, `seq ${s}`, `create sequence if not exists public."${s}";`);
  if (seqNames.size) log(`Sequences pre-created: ${seqNames.size}`);

  for (const t of tables) {
    const defs = byTable[t].map(c => {
      let s = `"${c.col}" ${c.type}`;
      if (c.gen === 's') s += ` generated always as (${c.def}) stored`;
      else if (c.def != null) s += ` default ${c.def}`;
      if (c.notnull) s += ' not null';
      return s;
    });
    await run(newDb, `table ${t}`, `create table if not exists public."${t}" (\n  ${defs.join(',\n  ')}\n);`);
  }

  // 3. PK / unique / check constraints (NOT fks — those go in 'final')
  const cons = (await oldDb.query(`
    select c.relname as tbl, con.conname as name, con.contype as type, pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and con.contype in ('p','u','c')`, [tables])).rows;
  for (const c of cons) await run(newDb, `con ${c.name}`, `do $$ begin if not exists (select 1 from pg_constraint where conname='${c.name}') then alter table public."${c.tbl}" add constraint "${c.name}" ${c.def}; end if; end $$;`);
  log(`Constraints (pk/uniq/check): ${cons.length}`);

  // 4. secondary indexes (skip those backing a constraint)
  const idx = (await oldDb.query(`
    select c.relname as tbl, ic.relname as iname, pg_get_indexdef(i.indexrelid) as def
    from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_class c on c.oid=i.indrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1)
      and not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid)`, [tables])).rows;
  for (const i of idx) await run(newDb, `idx ${i.iname}`, i.def.replace(/^create (unique )?index /i, (m, u) => `create ${u || ''}index if not exists `));
  log(`Indexes: ${idx.length}`);

  // 5. RLS enable + policies
  for (const t of tables) await run(newDb, `rls ${t}`, `alter table public."${t}" enable row level security;`);
  const pols = (await oldDb.query(`select tablename, policyname, permissive, array_to_string(roles, ', ') as roles, cmd, qual, with_check from pg_policies where schemaname='public' and tablename=any($1)`, [tables])).rows;
  for (const p of pols) {
    const roles = p.roles;
    let s = `create policy "${p.policyname}" on public."${p.tablename}" as ${p.permissive} for ${p.cmd.toLowerCase()} to ${roles}`;
    if (p.qual) s += ` using (${p.qual})`;
    if (p.with_check) s += ` with check (${p.with_check})`;
    await run(newDb, `pol ${p.tablename}/${p.policyname}`, `drop policy if exists "${p.policyname}" on public."${p.tablename}"; ${s};`);
  }
  log(`Policies: ${pols.length}`);

  await oldDb.end(); await newDb.end();
  log('SCHEMA phase done.');
}

// =============================================================================
async function doData() {
  const oldDb = new pg.Client(cfg(env.OLD_DB_HOST, env.OLD_DB_PASSWORD));
  const newDb = new pg.Client(cfg(env.NEW_DB_HOST, env.NEW_DB_PASSWORD));
  await oldDb.connect(); await newDb.connect();
  const tables = await liveTables(oldDb);
  // non-generated columns, in order, per table
  const cols = (await oldDb.query(`
    select c.relname as tbl, a.attname as col
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and a.attnum>0 and not a.attisdropped and a.attgenerated=''
    order by c.relname, a.attnum`, [tables])).rows;
  const colsByTable = {};
  for (const c of cols) (colsByTable[c.tbl] ??= []).push(`"${c.col}"`);

  // Drop FK constraints first so COPY order can't violate them (re-add in
  // 'final'). On a fresh DB there are none; on a re-sync this is essential.
  const fks = (await newDb.query(`
    select c.relname as tbl, con.conname as name
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and con.contype='f'`, [tables])).rows;
  for (const f of fks) await newDb.query(`alter table public."${f.tbl}" drop constraint if exists "${f.name}"`);
  if (fks.length) log(`Dropped ${fks.length} FKs (will be re-added in 'final').`);

  // Truncate ALL target tables once, up front, so a CASCADE can't wipe a
  // sibling that was already copied earlier in this same run (re-sync safety).
  await newDb.query(`truncate ${tables.map(t => `public."${t}"`).join(', ')} restart identity cascade`);

  for (const t of tables) {
    const list = colsByTable[t].join(', ');
    try {
      const src = oldDb.query(copyStreams.to(`copy (select ${list} from public."${t}") to stdout`));
      const dst = newDb.query(copyStreams.from(`copy public."${t}" (${list}) from stdin`));
      await pipeline(src, dst);
      const n = (await newDb.query(`select count(*)::int n from public."${t}"`)).rows[0].n;
      log(`  ${t}: ${n}`);
    } catch (e) { log(`  ! ${t}: ${e.message.split('\n')[0]}`); }
  }
  await oldDb.end(); await newDb.end();
  log('DATA phase done.');
}

// =============================================================================
async function doFinal() {
  const oldDb = new pg.Client(cfg(env.OLD_DB_HOST, env.OLD_DB_PASSWORD));
  const newDb = new pg.Client(cfg(env.NEW_DB_HOST, env.NEW_DB_PASSWORD));
  await oldDb.connect(); await newDb.connect();
  const tables = await liveTables(oldDb);

  // FKs
  const fks = (await oldDb.query(`
    select c.relname as tbl, con.conname as name, pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and con.contype='f'`, [tables])).rows;
  let fkOk = 0;
  for (const f of fks) if (await run(newDb, `fk ${f.name}`, `do $$ begin if not exists (select 1 from pg_constraint where conname='${f.name}') then alter table public."${f.tbl}" add constraint "${f.name}" ${f.def}; end if; end $$;`)) fkOk++;
  log(`FKs: ${fkOk}/${fks.length}`);

  // trigger functions, then triggers
  const fns = (await oldDb.query(`
    select distinct pg_get_functiondef(t.tgfoid) as def
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and not t.tgisinternal`, [tables])).rows;
  for (const f of fns) await run(newDb, 'fn', f.def.replace(/^create (or replace )?function/i, 'create or replace function'));
  const trg = (await oldDb.query(`
    select t.tgname, c.relname as tbl, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and not t.tgisinternal`, [tables])).rows;
  for (const t of trg) await run(newDb, `trg ${t.tgname}`, `drop trigger if exists "${t.tgname}" on public."${t.tbl}"; ${t.def};`);
  log(`Trigger fns: ${fns.length}  triggers: ${trg.length}`);

  // resync sequences for serial/identity columns
  const seqs = (await oldDb.query(`
    select c.relname as tbl, a.attname as col, pg_get_serial_sequence('public.'||c.relname, a.attname) as seq
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1) and a.attnum>0 and not a.attisdropped`, [tables])).rows;
  let sc = 0;
  for (const s of seqs.filter(s => s.seq)) {
    if (await run(newDb, `seq ${s.tbl}.${s.col}`, `select setval('${s.seq}', coalesce((select max("${s.col}") from public."${s.tbl}"), 1), true)`)) sc++;
  }
  log(`Sequences resynced: ${sc}`);
  await oldDb.end(); await newDb.end();
  log('FINAL phase done.');
}

// =============================================================================
async function doVerify() {
  const oldDb = new pg.Client(cfg(env.OLD_DB_HOST, env.OLD_DB_PASSWORD));
  const newDb = new pg.Client(cfg(env.NEW_DB_HOST, env.NEW_DB_PASSWORD));
  await oldDb.connect(); await newDb.connect();
  const tables = await liveTables(oldDb);
  let okAll = true, totalOld = 0, totalNew = 0;
  const mismatches = [];
  for (const t of tables) {
    const o = (await oldDb.query(`select count(*)::int n from public."${t}"`)).rows[0].n;
    const n = (await newDb.query(`select count(*)::int n from public."${t}"`)).rows[0].n;
    totalOld += o; totalNew += n;
    if (o !== n) { okAll = false; mismatches.push(`${t}: old=${o} new=${n}`); }
  }
  log(`Tables: ${tables.length}   old rows: ${totalOld}   new rows: ${totalNew}`);
  if (okAll) log('✅ ALL ROW COUNTS MATCH');
  else { log('❌ MISMATCHES:'); mismatches.forEach(m => log('  ' + m)); }
  await oldDb.end(); await newDb.end();
}

const fn = { schema: doSchema, data: doData, final: doFinal, verify: doVerify }[phase];
await fn();
