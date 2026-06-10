// Apply + verify the Ads and Brand Voice migrations, run isolation tests, via pooler.
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const ref = 'ijlesksgnfqqpxtaelqs';
const URL = `https://${ref}.supabase.co`;
const pgc = new pg.Client({ host: env.NEW_POOLER_HOST, port: 5432, user: `postgres.${ref}`, password: env.NEW_DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
const admin = createClient(URL, env.NEW_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
await pgc.connect();
const KM = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-0000000000c9';
const emailT2 = 'batch-t2@example.com', pw = 'Temp!batch-7Qx92kf';
const ok = b => b ? 'PASS' : 'FAIL';
let uT2;

async function isolationTest(table, makeRow) {
  // insert a KM row + a T2 row (service role / postgres)
  const kmRow = await pgc.query(`insert into ${table} ${makeRow(KM)} returning id`);
  const t2Row = await pgc.query(`insert into ${table} ${makeRow(T2)} returning id`);
  const kmId = kmRow.rows[0].id, t2Id = t2Row.rows[0].id;
  const t2c = createClient(URL, env.NEW_ANON_KEY, { auth:{persistSession:false} });
  await t2c.auth.signInWithPassword({ email: emailT2, password: pw });
  const { data: visible } = await t2c.from(table).select('id');
  const ids = new Set((visible||[]).map(r=>r.id));
  const seesOwn = ids.has(t2Id), seesKM = ids.has(kmId);
  const { data: upd } = await t2c.from(table).update({}).eq('id', kmId).select();
  // cleanup these rows
  await pgc.query(`delete from ${table} where id = any($1)`, [[kmId, t2Id]]);
  return { seesOwn, seesKM, cannotUpdateKM: (upd?.length ?? 0) === 0 };
}

try {
  // apply migrations
  await pgc.query(fs.readFileSync('supabase/multitenancy_phase4_ads.sql','utf8'));
  await pgc.query(fs.readFileSync('supabase/multitenancy_phase4_brand_voice.sql','utf8'));
  console.log('migrations applied.\n');

  // verify tenant-scoped policies on all 7 tables
  const tables = ['ad_creatives','negative_keywords','ad_compliance_checks','ad_platform_accounts','brand_voice_settings','brand_voice_avatars','brand_voice_samples'];
  for (const t of tables) {
    const pol = (await pgc.query(`select qual from pg_policies where tablename=$1`, [t])).rows;
    const scoped = pol.length>0 && pol.every(p => (p.qual||'').includes('current_tenant_id'));
    console.log(`  RLS tenant-scoped ${t.padEnd(22)} ${ok(scoped)}`);
  }

  // test tenant + user
  await pgc.query(`insert into tenants(id,slug,name) values ($1,'batchtest','Batch Test') on conflict (id) do nothing`, [T2]);
  const { data: list } = await admin.auth.admin.listUsers();
  const ex = list.users.find(u=>u.email===emailT2); if (ex) await admin.auth.admin.deleteUser(ex.id);
  const { data: c } = await admin.auth.admin.createUser({ email: emailT2, password: pw, email_confirm: true });
  uT2 = c.user.id;
  await pgc.query(`update app_users set tenant_id=$1 where user_id=$2`, [T2, uT2]);

  console.log('\nisolation tests:');
  const ad = await isolationTest('ad_creatives', t => `(name, platform, status, tenant_id) values ('zz-test', 'google', 'draft', '${t}')`);
  console.log(`  ad_creatives: T2 sees own=${ad.seesOwn} sees_KM=${ad.seesKM} cant_update_KM=${ad.cannotUpdateKM} -> ${ok(ad.seesOwn && !ad.seesKM && ad.cannotUpdateKM)}`);
  const bv = await isolationTest('brand_voice_settings', t => `(key, value, tenant_id) values ('zz-test-key', 'v', '${t}')`);
  console.log(`  brand_voice_settings: T2 sees own=${bv.seesOwn} sees_KM=${bv.seesKM} cant_update_KM=${bv.cannotUpdateKM} -> ${ok(bv.seesOwn && !bv.seesKM && bv.cannotUpdateKM)}`);

  const pass = ad.seesOwn && !ad.seesKM && ad.cannotUpdateKM && bv.seesOwn && !bv.seesKM && bv.cannotUpdateKM;
  console.log(`\n${pass ? '✅ ADS + BRAND VOICE ISOLATION VERIFIED' : '❌ PROBLEM'}`);
} catch (e) { console.log('ERROR: ' + e.message); }
finally {
  if (uT2) await admin.auth.admin.deleteUser(uT2).catch(()=>{});
  await pgc.query(`delete from tenants where id=$1`, [T2]).catch(()=>{});
  await pgc.end();
}
