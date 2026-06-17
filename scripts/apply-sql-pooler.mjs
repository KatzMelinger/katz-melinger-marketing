/**
 * Apply a supabase/*.sql file via the Supabase connection POOLER.
 *
 *   node scripts/apply-sql-pooler.mjs <file.sql>
 *
 * The direct NEW_DB_HOST is IPv6-only and fails from this network, so we go
 * through NEW_POOLER_HOST on port 6543 with user postgres.<project-ref> (the
 * ref is derived from NEW_DB_HOST). Reads creds from .env.migration.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-sql-pooler.mjs <path-to.sql>');
  process.exit(1);
}

function loadEnv(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}
const env = loadEnv('.env.migration');

const refMatch = (env.NEW_DB_HOST || '').match(/db\.([a-z0-9]+)\.supabase/i);
if (!refMatch) {
  console.error('could not derive project ref from NEW_DB_HOST');
  process.exit(1);
}
const ref = refMatch[1];

const sql = fs.readFileSync(path.resolve(file), 'utf8');
const client = new pg.Client({
  host: env.NEW_POOLER_HOST,
  port: 6543,
  user: `postgres.${ref}`,
  password: env.NEW_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

await client.connect();
console.log(`connected via pooler ${env.NEW_POOLER_HOST} as postgres.${ref}`);
try {
  await client.query(sql);
  console.log(`✅ applied ${file}`);
} catch (e) {
  console.error(`❌ ${file}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
