/**
 * Proof-of-design for tenant-scoped RLS — runs entirely inside ONE transaction
 * that is ROLLED BACK, so nothing persists on the (production) new DB.
 *
 * It creates current_tenant_id() + tenant-scoped policies on seo_opportunities,
 * adds a 2nd test tenant with its own row, then queries as each tenant's user
 * (simulated JWT via request.jwt.claims + the non-superuser `authenticated`
 * role) to confirm each sees ONLY their tenant's rows.
 */
import fs from 'node:fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const c = new pg.Client({ host: env.NEW_DB_HOST, port: 5432, user: 'postgres', password: env.NEW_DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();

const KM = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-0000000000t2'.replace(/t2/, 'a2'); // valid hex
const USER_KM = 'e10daf9c-cdbe-4c9e-b9db-33364b9b82d0'; // drivas@katzmelinger (in app_users, KM)
const USER_T2 = '11111111-1111-1111-1111-111111111111';

const q = async (sql, p) => (await c.query(sql, p)).rows;
async function asUser(uid, label) {
  await c.query(`set local role authenticated`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  const rows = await q(`select tenant_id, count(*)::int n from public.seo_opportunities group by 1 order by 1`);
  await c.query(`reset role`);
  console.log(`  as ${label} (uid ${uid.slice(0,8)}): ` + (rows.map(r => `${r.tenant_id.slice(0,8)}=${r.n}`).join(', ') || 'NO ROWS'));
  return rows;
}

try {
  await c.query('begin');

  // 1. the resolver function (security definer: reads app_users past RLS)
  await c.query(`
    create or replace function public.current_tenant_id()
    returns uuid language sql stable security definer set search_path = public
    as $$ select tenant_id from public.app_users where user_id = auth.uid() $$;`);

  // 2. tenant-scoped policies on the pilot table (replace permissive ones)
  await c.query(`alter table public.seo_opportunities enable row level security`);
  for (const p of ['auth read seo_opportunities','auth write seo_opportunities','tenant rw seo_opportunities'])
    await c.query(`drop policy if exists "${p}" on public.seo_opportunities`);
  await c.query(`
    create policy "tenant rw seo_opportunities" on public.seo_opportunities
      for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())`);

  // 3. a 2nd tenant + user + one opportunity row for it
  await c.query(`insert into public.tenants(id, slug, name) values ($1,'test2','Test Firm 2')`, [T2]);
  // auth.users row for the test user (clone an existing row's NOT NULL cols)
  await c.query(`create temp table _u on commit drop as select * from auth.users limit 1`);
  await c.query(`update _u set id=$1, email='b@test2.com', phone=null, confirmation_token=null, recovery_token=null`, [USER_T2]);
  const ucols = (await q(`select string_agg(quote_ident(column_name),',') s from information_schema.columns where table_schema='auth' and table_name='users' and is_generated='NEVER'`))[0].s;
  await c.query(`insert into auth.users (${ucols}) select ${ucols} from _u`);
  // the on_auth_user_created trigger already inserted app_users (default tenant);
  // move it to the test tenant.
  await c.query(`insert into public.app_users(user_id, email, tenant_id, role) values ($1,'b@test2.com',$2,'user')
                 on conflict (user_id) do update set tenant_id=excluded.tenant_id`, [USER_T2, T2]);
  const cols = (await q(`select string_agg(quote_ident(column_name),',') s from information_schema.columns where table_schema='public' and table_name='seo_opportunities' and column_name in ('keyword','tenant_id')`))[0].s;
  // minimal insert: pick a real existing row, clone it under T2
  await c.query(`insert into public.seo_opportunities (select * from public.seo_opportunities where tenant_id=$1 limit 1)
                 on conflict do nothing`, [KM]).catch(()=>{});
  await c.query(`update public.seo_opportunities set tenant_id=$1 where ctid in (select ctid from public.seo_opportunities where tenant_id=$2 order by ctid desc limit 1)`, [T2, KM]);

  const kmCount = (await q(`select count(*)::int n from public.seo_opportunities where tenant_id=$1`,[KM]))[0].n;
  const t2Count = (await q(`select count(*)::int n from public.seo_opportunities where tenant_id=$1`,[T2]))[0].n;
  console.log(`Setup (as postgres): KM=${kmCount} rows, T2=${t2Count} rows`);

  console.log('RLS-scoped views:');
  const km = await asUser(USER_KM, 'KM user');
  const t2 = await asUser(USER_T2, 'T2 user');

  const kmOnlyKM = km.length === 1 && km[0].tenant_id === KM;
  const t2OnlyT2 = t2.length === 1 && t2[0].tenant_id === T2;
  console.log(`\nKM user sees ONLY KM rows: ${kmOnlyKM ? 'PASS' : 'FAIL'}`);
  console.log(`T2 user sees ONLY T2 rows: ${t2OnlyT2 ? 'PASS' : 'FAIL'}`);
  console.log(kmOnlyKM && t2OnlyT2 ? '\n✅ RLS DESIGN VALIDATED' : '\n❌ DESIGN PROBLEM');
} finally {
  await c.query('rollback');
  console.log('(transaction rolled back — nothing persisted)');
  await c.end();
}
