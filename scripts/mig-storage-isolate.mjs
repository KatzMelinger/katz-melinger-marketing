// Finish storage isolation on the NEW project:
//  1. Copy existing generated_images files old->new under the tenant folder,
//     update storage_path + public_url (signed).
//  2. Make both buckets PRIVATE.
//  3. Add storage.objects RLS policies (tenant folder = current_tenant_id()).
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const ref='ijlesksgnfqqpxtaelqs', URL=`https://${ref}.supabase.co`;
const KM='00000000-0000-0000-0000-000000000001';
const TTL=60*60*24*365;
const sb=createClient(URL, env.NEW_SERVICE_ROLE_KEY);
const pgc=new pg.Client({host:env.NEW_POOLER_HOST,port:5432,user:`postgres.${ref}`,password:env.NEW_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await pgc.connect();

// ---- 1. migrate existing generated_images files ----
const rows=(await pgc.query(`select id, storage_path, public_url, tenant_id from public.generated_images where storage_path is not null`)).rows;
console.log(`generated_images files to migrate: ${rows.length}`);
let moved=0;
for (const r of rows) {
  const already = r.storage_path.startsWith(r.tenant_id + '/');
  const newPath = already ? r.storage_path : `${r.tenant_id}/${r.storage_path}`;
  try {
    // already in new bucket under tenant folder? skip download
    let bytes=null;
    const head=await sb.storage.from('generated-images').download(newPath);
    if (head.data) { bytes=null; /* exists */ }
    else if (r.public_url) {
      const res=await fetch(r.public_url);
      if (res.ok) bytes=new Uint8Array(await res.arrayBuffer());
    }
    if (bytes) {
      const up=await sb.storage.from('generated-images').upload(newPath, bytes, { contentType:'image/png', upsert:true });
      if (up.error) { console.log(`  ! ${r.id}: upload ${up.error.message}`); continue; }
    }
    const { data: signed }=await sb.storage.from('generated-images').createSignedUrl(newPath, TTL);
    await pgc.query(`update public.generated_images set storage_path=$1, public_url=$2 where id=$3`, [newPath, signed?.signedUrl ?? '', r.id]);
    moved++;
  } catch(e){ console.log(`  ! ${r.id}: ${e.message}`); }
}
console.log(`migrated/repointed: ${moved}/${rows.length}`);

// ---- 2. make buckets private ----
for (const b of ['generated-images','video-renders']) {
  const { error }=await sb.storage.updateBucket(b, { public:false });
  console.log(`bucket ${b} -> private: ${error?('ERR '+error.message):'OK'}`);
}

// ---- 3. storage.objects RLS policies (tenant folder match) ----
const buckets = `'generated-images','video-renders'`;
const cond = `bucket_id in (${buckets}) and (storage.foldername(name))[1] = public.current_tenant_id()::text`;
const stmts = [
  `drop policy if exists "tenant storage select" on storage.objects`,
  `drop policy if exists "tenant storage insert" on storage.objects`,
  `drop policy if exists "tenant storage update" on storage.objects`,
  `drop policy if exists "tenant storage delete" on storage.objects`,
  `create policy "tenant storage select" on storage.objects for select to authenticated using (${cond})`,
  `create policy "tenant storage insert" on storage.objects for insert to authenticated with check (${cond})`,
  `create policy "tenant storage update" on storage.objects for update to authenticated using (${cond}) with check (${cond})`,
  `create policy "tenant storage delete" on storage.objects for delete to authenticated using (${cond})`,
];
let polOk=0, polErr=null;
for (const s of stmts) { try { await pgc.query(s); polOk++; } catch(e){ polErr=e.message; } }
console.log(`storage RLS policies: ${polOk}/${stmts.length} statements ok` + (polErr?` (last err: ${polErr})`:''));

await pgc.end();
console.log('storage isolation done.');
