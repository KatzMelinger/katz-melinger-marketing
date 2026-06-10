// Live isolation test for the SEO Opportunities pilot, against the NEW DB.
// Exercises the REAL enforcement path: authenticated client + tenant RLS.
// Creates a 2nd tenant+user+row, verifies isolation both ways, then cleans up.
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const URL = 'https://ijlesksgnfqqpxtaelqs.supabase.co';
const admin = createClient(URL, env.NEW_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const pgc = new pg.Client({ host: env.NEW_DB_HOST, port:5432, user:'postgres', password:env.NEW_DB_PASSWORD, database:'postgres', ssl:{rejectUnauthorized:false} });
await pgc.connect();

const KM = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-0000000000a2';
const emailKM = 'pilot-km@example.com', emailT2 = 'pilot-t2@example.com';
const pw = 'Temp!pilot-7Qx92kf';
const ok = b => b ? 'PASS' : 'FAIL';
let uKM, uT2, t2RowId, kmRowId;

async function signIn(email) {
  const c = createClient(URL, env.NEW_ANON_KEY, { auth:{persistSession:false} });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error('signin ' + email + ': ' + error.message);
  return c;
}

try {
  // --- setup (service role / postgres) ---
  await pgc.query(`insert into tenants(id,slug,name) values ($1,'pilot-t2','Pilot Firm 2') on conflict (id) do nothing`, [T2]);
  for (const [email, tid] of [[emailKM, KM], [emailT2, T2]]) {
    const { data: list } = await admin.auth.admin.listUsers();
    const ex = list.users.find(u => u.email === email);
    if (ex) await admin.auth.admin.deleteUser(ex.id);
    const { data: c } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    await pgc.query(`update app_users set tenant_id=$1 where user_id=$2`, [tid, c.user.id]);
    if (tid === KM) uKM = c.user.id; else uT2 = c.user.id;
  }
  // a T2 opportunity row (clone a KM row, new keyword + tenant)
  await pgc.query(`insert into seo_opportunities (id, keyword, source, relevance_score, excluded, status, tenant_id, created_at, updated_at)
                   values (gen_random_uuid(), 'zz-pilot-test-keyword', 'imported', 50, false, 'new', $1, now(), now())`, [T2]);
  t2RowId = (await pgc.query(`select id from seo_opportunities where tenant_id=$1 limit 1`, [T2])).rows[0].id;
  kmRowId = (await pgc.query(`select id from seo_opportunities where tenant_id=$1 limit 1`, [KM])).rows[0].id;
  const kmTotal = (await pgc.query(`select count(*)::int n from seo_opportunities where tenant_id=$1`, [KM])).rows[0].n;
  console.log(`setup: KM rows=${kmTotal}, T2 rows=1\n`);

  // --- the actual enforcement path: authenticated client + RLS ---
  const km = await signIn(emailKM);
  const t2 = await signIn(emailT2);

  const { count: kmSees } = await km.from('seo_opportunities').select('*', { count:'exact', head:true });
  const { count: t2Sees } = await t2.from('seo_opportunities').select('*', { count:'exact', head:true });
  console.log(`1. KM user sees only KM rows ......... ${ok(kmSees === kmTotal)} (sees ${kmSees}, expected ${kmTotal})`);
  console.log(`2. T2 user sees only its 1 row ....... ${ok(t2Sees === 1)} (sees ${t2Sees}, expected 1)`);

  // 3. T2 user must NOT see a specific KM row by id
  const { data: leak } = await t2.from('seo_opportunities').select('id').eq('id', kmRowId).maybeSingle();
  console.log(`3. T2 cannot read a KM row by id ..... ${ok(!leak)}`);

  // 4. T2 user cannot UPDATE a KM row (RLS using-clause -> 0 rows affected)
  const { data: upd } = await t2.from('seo_opportunities').update({ status:'dismissed' }).eq('id', kmRowId).select();
  console.log(`4. T2 cannot update a KM row ......... ${ok((upd?.length ?? 0) === 0)}`);

  // 5. T2 user cannot INSERT a row spoofing KM's tenant_id (with-check)
  const { error: insErr } = await t2.from('seo_opportunities').insert({ keyword:'spoof-kw', source:'imported', relevance_score:1, excluded:false, status:'new', tenant_id: KM });
  console.log(`5. T2 cannot write into KM tenant .... ${ok(!!insErr)} (${insErr ? 'rejected' : 'ALLOWED — BAD'})`);

  const allPass = kmSees === kmTotal && t2Sees === 1 && !leak && (upd?.length ?? 0) === 0 && !!insErr;
  console.log(`\n${allPass ? '✅ PILOT ISOLATION VERIFIED' : '❌ ISOLATION PROBLEM'}`);
} catch (e) {
  console.log('ERROR: ' + e.message);
} finally {
  // cleanup
  await pgc.query(`delete from seo_opportunities where tenant_id=$1 or keyword='spoof-kw'`, [T2]);
  for (const id of [uKM, uT2]) if (id) await admin.auth.admin.deleteUser(id);
  await pgc.query(`delete from tenants where id=$1`, [T2]);
  await pgc.end();
  console.log('cleanup done.');
}
