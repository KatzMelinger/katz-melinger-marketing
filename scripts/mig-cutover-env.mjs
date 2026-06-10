// Repoint the 4 Supabase env vars in Vercel to the NEW project, preserving each
// var's existing environment footprint. Reads secret values from .env.migration
// (never prints them). Vercel has no in-place update, so rm + re-add per env.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const NEW_URL = 'https://ijlesksgnfqqpxtaelqs.supabase.co';

const targets = [
  { name:'SUPABASE_URL',                  value:NEW_URL,                  envs:['development','preview','production'] },
  { name:'NEXT_PUBLIC_SUPABASE_URL',      value:NEW_URL,                  envs:['development','preview','production'] },
  { name:'NEXT_PUBLIC_SUPABASE_ANON_KEY', value:env.NEW_ANON_KEY,         envs:['preview','production'] },
  { name:'SUPABASE_SERVICE_ROLE_KEY',     value:env.NEW_SERVICE_ROLE_KEY, envs:['development','preview','production'] },
];

const vercel = (args, input) => spawnSync('vercel', args, { shell:true, input, encoding:'utf8' });

for (const t of targets) {
  if (!t.value) { console.log(`! ${t.name}: missing value, skipped`); continue; }
  for (const e of t.envs) {
    vercel(['env','rm', t.name, e, '-y']); // ignore if absent
    const r = vercel(['env','add', t.name, e], t.value + '\n');
    const ok = r.status === 0;
    console.log(`  ${ok?'✓':'✗'} ${t.name} @ ${e}${ok?'':' -> '+(r.stderr||'').split('\n').find(Boolean)}`);
  }
}
console.log('ENV cutover done.');
