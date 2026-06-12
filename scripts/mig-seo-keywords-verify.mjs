// Verify the seo_keywords migration + live 2-tenant isolation test (via pooler).
// Then drop the legacy (keyword) unique (step B) since the code is deployed.
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
const T2 = '00000000-0000-0000-0000-0000000000b7';
const emailT2 = 'kwtest-t2@example.com', pw = 'Temp!kw-7Qx92kf';
const ok = b => b ? 'PASS' : 'FAIL';
let uT2, t2RowId, kmRowId;

try {
  // --- verify migration A ---
  const cons = (await pgc.query(`select conname from pg_constraint con join pg_class cl on cl.oid=con.conrelid where cl.relname='seo_keywords' and con.contype='u' order by 1`)).rows.map(r=>r.conname);
  const pols = (await pgc.query(`select policyname, qual from pg_policies where tablename='seo_keywords'`)).rows;
  const tenantScoped = pols.some(p => (p.qual||'').includes('current_tenant_id'));
  console.log(`migration: unique=[${cons.join(', ')}]`);
  console.log(`migration: RLS tenant-scoped policy present .. ${ok(tenantScoped)} (${pols.map(p=>p.policyname).join(', ')})`);

  // --- isolation test ---
  await pgc.query(`insert into tenants(id,slug,name) values ($1,'kwtest','KW Test Firm') on conflict (id) do nothing`, [T2]);
  const { data: list } = await admin.auth.admin.listUsers();
  const ex = list.users.find(u => u.email === emailT2); if (ex) await admin.auth.admin.deleteUser(ex.id);
  const { data: c } = await admin.auth.admin.createUser({ email: emailT2, password: pw, email_confirm: true });
  uT2 = c.user.id;
  await pgc.query(`update app_users set tenant_id=$1 where user_id=$2`, [T2, uT2]);
  await pgc.query(`insert into seo_keywords (id, keyword, tenant_id, created_at) values (gen_random_uuid(), 'zz-kwtest-keyword', $1, now())`, [T2]);
  t2RowId = (await pgc.query(`select id from seo_keywords where tenant_id=$1 limit 1`, [T2])).rows[0].id;
  kmRowId = (await pgc.query(`select id from seo_keywords where tenant_id=$1 limit 1`, [KM])).rows[0].id;
  const kmTotal = (await pgc.query(`select count(*)::int n from seo_keywords where tenant_id=$1`, [KM])).rows[0].n;

  const t2c = createClient(URL, env.NEW_ANON_KEY, { auth:{persistSession:false} });
  await t2c.auth.signInWithPassword({ email: emailT2, password: pw });

  const { count: t2Sees } = await t2c.from('seo_keywords').select('*', { count:'exact', head:true });
  const { data: leak } = await t2c.from('seo_keywords').select('id').eq('id', kmRowId).maybeSingle();
  const { data: upd } = await t2c.from('seo_keywords').update({ notes:'x' }).eq('id', kmRowId).select();
  const { error: insErr } = await t2c.from('seo_keywords').insert({ keyword:'kw-spoof', tenant_id: KM });

  console.log(`\nisolation (KM total=${kmTotal}):`);
  console.log(`  T2 sees only its 1 row ......... ${ok(t2Sees === 1)} (sees ${t2Sees})`);
  console.log(`  T2 cannot read a KM row ........ ${ok(!leak)}`);
  console.log(`  T2 cannot update a KM row ...... ${ok((upd?.length ?? 0) === 0)}`);
  console.log(`  T2 cannot write into KM tenant . ${ok(!!insErr)}`);
  const pass = tenantScoped && t2Sees===1 && !leak && (upd?.length??0)===0 && !!insErr;
  console.log(`\n${pass ? '✅ SEO KEYWORDS ISOLATION VERIFIED' : '❌ PROBLEM'}`);
} catch (e) { console.log('ERROR: ' + e.message); }
finally {
  await pgc.query(`delete from seo_keywords where tenant_id=$1 or keyword in ('kw-spoof')`, [T2]).catch(()=>{});
  if (uT2) await admin.auth.admin.deleteUser(uT2).catch(()=>{});
  await pgc.query(`delete from tenants where id=$1`, [T2]).catch(()=>{});
  // step B: drop legacy unique now that tenant-aware code is deployed
  await pgc.query(`alter table public.seo_keywords drop constraint if exists seo_keywords_keyword_key`);
  const after = (await pgc.query(`select conname from pg_constraint con join pg_class cl on cl.oid=con.conrelid where cl.relname='seo_keywords' and con.contype='u'`)).rows.map(r=>r.conname);
  console.log(`cleanup done. seo_keywords unique now: ${after.join(', ')}`);
  await pgc.end();
}
