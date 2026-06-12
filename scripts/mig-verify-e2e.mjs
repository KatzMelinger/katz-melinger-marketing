// End-to-end check against the NEW project: create a temp user, sign in,
// read data through the authenticated (user-JWT) path, then delete the user.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const URL = 'https://ijlesksgnfqqpxtaelqs.supabase.co';
const admin = createClient(URL, env.NEW_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const email = 'mig-verify-20260607@example.com';
const password = 'Temp!verify-9f3kQ72x';
let userId = null;
const ok = (b) => b ? 'PASS' : 'FAIL';

try {
  // clean any leftover from a prior run
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find(u => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  // 1. create + auto-confirm a temp user (triggers app_users row insert)
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  userId = created.user.id;
  console.log(`1. create temp user .......... ${ok(!!userId)}`);

  // 2. on_auth_user_created trigger should have made an app_users row
  const { data: au } = await admin.from('app_users').select('user_id,tenant_id,role').eq('user_id', userId).maybeSingle();
  console.log(`2. app_users row auto-created .. ${ok(!!au)}  (tenant=${au?.tenant_id?.slice(0,8)}, role=${au?.role})`);

  // 3. sign in via the auth stack (proves password verify + JWT issuance work)
  const userClient = createClient(URL, env.NEW_ANON_KEY, { auth: { persistSession: false } });
  const { data: signin, error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  console.log(`3. sign in (JWT issued) ....... ${ok(!sErr && !!signin?.session?.access_token)}${sErr ? ' -> ' + sErr.message : ''}`);

  // 4. authenticated read through PostgREST (user JWT, RLS applies)
  const { data: ownRow, error: oErr } = await userClient.from('app_users').select('user_id').eq('user_id', userId).maybeSingle();
  console.log(`4. authed read own app_users ... ${ok(!oErr && !!ownRow)}${oErr ? ' -> ' + oErr.message : ''}`);
  const { count, error: dErr } = await userClient.from('seo_opportunities').select('*', { count: 'exact', head: true });
  console.log(`5. authed read data table ...... ${ok(!dErr)}  (seo_opportunities visible to user: ${count ?? 'err'})`);

  // 6. service-role read still works
  const { count: sc } = await admin.from('seo_opportunities').select('*', { count: 'exact', head: true });
  console.log(`6. service-role read .......... ${ok(sc != null)}  (${sc} rows)`);
} catch (e) {
  console.log('ERROR: ' + e.message);
} finally {
  if (userId) { await admin.auth.admin.deleteUser(userId); console.log('cleanup: temp user deleted'); }
}
