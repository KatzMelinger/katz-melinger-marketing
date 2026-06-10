// Read-only inventory of the OLD (source) project. Lists every public table,
// its live row count, and whether it carries a tenant_id column. No writes.
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

const client = new pg.Client({
  host: env.OLD_DB_HOST, port: 5432, user: 'postgres',
  password: env.OLD_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});

await client.connect();
console.log(`Connected to OLD ${env.OLD_DB_HOST}`);

const tbls = await client.query(
  `select t.table_name,
          exists(select 1 from information_schema.columns c
                 where c.table_schema='public' and c.table_name=t.table_name
                 and c.column_name='tenant_id') as has_tenant
   from information_schema.tables t
   where t.table_schema='public' and t.table_type='BASE TABLE'
   order by t.table_name`
);

let total = 0;
const rows = [];
for (const t of tbls.rows) {
  const c = await client.query(`select count(*)::int as n from public.${t.table_name}`);
  total += c.rows[0].n;
  rows.push({ table: t.table_name, rows: c.rows[0].n, tenant: t.has_tenant ? 'yes' : '—' });
}

console.log(`\nPublic tables: ${tbls.rowCount}   total rows: ${total}\n`);
const w = Math.max(...rows.map(r => r.table.length), 5);
console.log('TABLE'.padEnd(w) + '  ROWS'.padStart(10) + '   TENANT_ID');
for (const r of rows) {
  console.log(r.table.padEnd(w) + String(r.rows).padStart(10) + '       ' + r.tenant);
}
await client.end();
