import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const ref='ijlesksgnfqqpxtaelqs', URL=`https://${ref}.supabase.co`;
const pgc=new pg.Client({host:env.NEW_POOLER_HOST,port:5432,user:`postgres.${ref}`,password:env.NEW_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
const admin=createClient(URL,env.NEW_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
await pgc.connect();
const KM='00000000-0000-0000-0000-000000000001', T2='00000000-0000-0000-0000-0000000000d4';
const email='qw-t2@example.com', pw='Temp!qw-7Qx92kf'; let uT2;
const ok=b=>b?'PASS':'FAIL';
try {
  await pgc.query(fs.readFileSync('supabase/multitenancy_phase4_seo_disavow.sql','utf8'));
  await pgc.query(fs.readFileSync('supabase/multitenancy_phase4_research_libraries.sql','utf8'));
  console.log('migrations applied.\n');
  for (const t of ['seo_disavow_actions','legal_authority_sources','people_ask_sources','research_packets']) {
    const pol=(await pgc.query('select qual from pg_policies where tablename=$1',[t])).rows;
    const scoped=pol.length>0 && pol.every(p=>(p.qual||'').includes('current_tenant_id'));
    console.log(`  RLS tenant-scoped ${t.padEnd(24)} ${ok(scoped)}`);
  }
  await pgc.query("insert into tenants(id,slug,name) values ($1,'qwtest','QW Test') on conflict (id) do nothing",[T2]);
  const {data:list}=await admin.auth.admin.listUsers(); const ex=list.users.find(u=>u.email===email); if(ex)await admin.auth.admin.deleteUser(ex.id);
  const {data:c}=await admin.auth.admin.createUser({email,password:pw,email_confirm:true}); uT2=c.user.id;
  await pgc.query('update app_users set tenant_id=$1 where user_id=$2',[T2,uT2]);
  const t2c=createClient(URL,env.NEW_ANON_KEY,{auth:{persistSession:false}}); await t2c.auth.signInWithPassword({email,password:pw});

  // seo_disavow_actions: same domain in both firms (composite PK), isolation
  await pgc.query("insert into seo_disavow_actions(domain,status,tenant_id) values ('zz-test.com','disavowed',$1)",[KM]);
  await pgc.query("insert into seo_disavow_actions(domain,status,tenant_id) values ('zz-test.com','safe',$1)",[T2]);
  const {data:dis}=await t2c.from('seo_disavow_actions').select('domain,status').eq('domain','zz-test.com');
  const disOk = dis && dis.length===1 && dis[0].status==='safe';
  console.log(`\n  seo_disavow_actions: shared domain, T2 sees only own (${dis?.length} row, status=${dis?.[0]?.status}) -> ${ok(disOk)}`);

  // people_ask_sources: id PK, isolation
  await pgc.query("insert into people_ask_sources(content,source_type,tenant_id) values ('zz-km-content','manual',$1)",[KM]);
  await pgc.query("insert into people_ask_sources(content,source_type,tenant_id) values ('zz-t2-content','manual',$1)",[T2]);
  const {data:pa}=await t2c.from('people_ask_sources').select('content').ilike('content','zz-%');
  const paOk = pa && pa.length===1 && pa[0].content==='zz-t2-content';
  console.log(`  people_ask_sources: T2 sees only own (${pa?.length} row, "${pa?.[0]?.content}") -> ${ok(paOk)}`);

  console.log(`\n${disOk && paOk ? '✅ DISAVOW + RESEARCH ISOLATION VERIFIED' : '❌ PROBLEM'}`);
} catch(e){ console.log('ERROR: '+e.message); }
finally {
  await pgc.query("delete from seo_disavow_actions where domain='zz-test.com'").catch(()=>{});
  await pgc.query("delete from people_ask_sources where content like 'zz-%'").catch(()=>{});
  if(uT2) await admin.auth.admin.deleteUser(uT2).catch(()=>{});
  await pgc.query('delete from tenants where id=$1',[T2]).catch(()=>{});
  await pgc.end();
}
