/**
 * Apply a supabase/*.sql schema file to the dedicated (NEW) app database.
 *
 *   node scripts/apply-sql.mjs <file.sql>
 *
 * Reads NEW_DB_HOST / NEW_DB_PASSWORD from .env.migration and runs the file as
 * a single batch (simple query protocol, so dollar-quoted DO blocks work).
 * Intended for additive, idempotent schema files.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-sql.mjs <path-to.sql>');
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

const sql = fs.readFileSync(path.resolve(file), 'utf8');
const client = new pg.Client({
  host: env.NEW_DB_HOST,
  port: 5432,
  user: 'postgres',
  password: env.NEW_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

await client.connect();
try {
  await client.query(sql);
  console.log(`✅ applied ${file}`);
} catch (e) {
  console.error(`❌ ${file}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
