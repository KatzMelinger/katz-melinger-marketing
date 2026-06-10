// Read-only migration probe. Tests connectivity to the NEW project and lists
// its public tables. Prints NO secrets. Run: node scripts/mig-probe.mjs
import fs from 'node:fs';
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

async function tryConnect(label, cfg) {
  const client = new pg.Client({ ...cfg, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const v = await client.query('select version()');
    const tbls = await client.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'
       order by table_name`
    );
    console.log(`\n[${label}] CONNECTED via ${cfg.host}:${cfg.port} as ${cfg.user}`);
    console.log(`  ${v.rows[0].version.split(',')[0]}`);
    console.log(`  public tables (${tbls.rowCount}): ${tbls.rows.map(r => r.table_name).join(', ') || '(none)'}`);
    await client.end();
    return true;
  } catch (e) {
    console.log(`[${label}] FAILED via ${cfg.host}:${cfg.port} as ${cfg.user} -> ${e.code || ''} ${e.message}`);
    try { await client.end(); } catch {}
    return false;
  }
}

const ref = env.NEW_DB_HOST?.match(/db\.([a-z0-9]+)\.supabase/)?.[1];
// Attempt 1: direct connection (user 'postgres', host db.<ref>.supabase.co)
let ok = await tryConnect('NEW direct', { host: env.NEW_DB_HOST, port: 5432, user: 'postgres', password: env.NEW_DB_PASSWORD });
// Attempt 2: session pooler if provided (user 'postgres.<ref>')
if (!ok && env.NEW_POOLER_HOST) {
  ok = await tryConnect('NEW pooler', { host: env.NEW_POOLER_HOST, port: 5432, user: `postgres.${ref}`, password: env.NEW_DB_PASSWORD });
}
if (!ok) {
  console.log('\nCould not connect to NEW project. If the error is a timeout/ENETUNREACH, this machine likely has no IPv6 route to the direct host — grab the Session pooler host from the dashboard (Connect -> Session pooler) and put it in NEW_POOLER_HOST.');
  process.exit(1);
}
