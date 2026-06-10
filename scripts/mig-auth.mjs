// Migrate Supabase Auth (auth.users + auth.identities) OLD -> NEW.
// Copies only columns present in BOTH projects (handles auth-schema drift).
// Preserves encrypted_password so existing logins keep working.
import fs from 'node:fs';
import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2];}return o;}
const env=loadEnv('.env.migration');
const cfg=(h,pw)=>({host:h,port:5432,user:'postgres',password:pw,database:'postgres',ssl:{rejectUnauthorized:false}});
const oldDb=new pg.Client(cfg(env.OLD_DB_HOST,env.OLD_DB_PASSWORD));
const newDb=new pg.Client(cfg(env.NEW_DB_HOST,env.NEW_DB_PASSWORD));
await oldDb.connect();await newDb.connect();

async function commonCols(table){
  const q=`select a.attname, a.attnum from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='auth' and c.relname=$1 and a.attnum>0 and not a.attisdropped and a.attgenerated='' order by a.attnum`;
  const o=(await oldDb.query(q,[table])).rows.map(r=>r.attname);
  const nw=new Set((await newDb.query(q,[table])).rows.map(r=>r.attname));
  return o.filter(c=>nw.has(c));
}

async function copyTable(table){
  const cols=await commonCols(table);
  const list=cols.map(c=>`"${c}"`).join(', ');
  const src=oldDb.query(copyStreams.to(`copy (select ${list} from auth."${table}") to stdout`));
  const dst=newDb.query(copyStreams.from(`copy auth."${table}" (${list}) from stdin`));
  await pipeline(src,dst);
  const n=(await newDb.query(`select count(*)::int n from auth."${table}"`)).rows[0].n;
  console.log(`  auth.${table}: ${n} rows (cols: ${cols.length})`);
}

// order matters: users before identities (FK)
await copyTable('users');
await copyTable('identities');

// now add the app_users FK that previously failed
try {
  await newDb.query(`do $$ begin if not exists (select 1 from pg_constraint where conname='app_users_user_id_fkey') then
    alter table public.app_users add constraint app_users_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade; end if; end $$;`);
  console.log('  app_users_user_id_fkey: added');
} catch(e){ console.log('  ! app_users_user_id_fkey: '+e.message.split('\n')[0]); }

await oldDb.end();await newDb.end();
console.log('AUTH migration done.');
