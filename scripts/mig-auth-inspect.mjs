// Read-only: inspect auth users in OLD and NEW, and FKs into auth.users.
import fs from 'node:fs';
import pg from 'pg';
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2];}return o;}
const env=loadEnv('.env.migration');
const cfg=(h,pw)=>({host:h,port:5432,user:'postgres',password:pw,database:'postgres',ssl:{rejectUnauthorized:false}});
const oldDb=new pg.Client(cfg(env.OLD_DB_HOST,env.OLD_DB_PASSWORD));
const newDb=new pg.Client(cfg(env.NEW_DB_HOST,env.NEW_DB_PASSWORD));
await oldDb.connect();await newDb.connect();

const ou=(await oldDb.query(`select id, email, created_at, last_sign_in_at, role, raw_user_meta_data->>'name' as name from auth.users order by created_at`)).rows;
console.log(`OLD auth.users: ${ou.length}`);
for(const u of ou) console.log(`  ${u.email}  (${u.id})  last_sign_in=${u.last_sign_in_at?String(u.last_sign_in_at).slice(0,10):'never'}`);

const nu=(await newDb.query(`select count(*)::int n from auth.users`)).rows[0].n;
console.log(`NEW auth.users: ${nu}`);

const oi=(await oldDb.query(`select provider, count(*)::int n from auth.identities group by provider`)).rows;
console.log(`OLD auth.identities by provider: ${oi.map(r=>`${r.provider}=${r.n}`).join(', ')||'(none)'}`);

// public tables referencing auth.users
const fks=(await oldDb.query(`
  select c.relname as src, a.attname as col
  from pg_constraint con
  join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  join pg_class rc on rc.oid=con.confrelid
  join pg_namespace rn on rn.oid=rc.relnamespace
  join pg_attribute a on a.attrelid=con.conrelid and a.attnum=any(con.conkey)
  where con.contype='f' and rn.nspname='auth' and rc.relname='users' and n.nspname='public'`)).rows;
console.log(`public FKs -> auth.users: ${fks.map(f=>`${f.src}.${f.col}`).join(', ')||'(none)'}`);

// app_users rows + whether their user_id exists in old auth.users
const au=(await oldDb.query(`select au.user_id, au.email, (u.id is not null) as has_auth from app_users au left join auth.users u on u.id=au.user_id`)).rows;
console.log(`app_users (${au.length}): ` + au.map(r=>`${r.email||'?'} auth=${r.has_auth}`).join(' | '));

await oldDb.end();await newDb.end();
