// Restore the 4 Supabase vars to the Preview environment (all preview branches),
// using --value/--yes so the CLI doesn't prompt for a git branch.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const NEW_URL = 'https://ijlesksgnfqqpxtaelqs.supabase.co';
const targets = [
  ['SUPABASE_URL', NEW_URL],
  ['NEXT_PUBLIC_SUPABASE_URL', NEW_URL],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEW_ANON_KEY],
  ['SUPABASE_SERVICE_ROLE_KEY', env.NEW_SERVICE_ROLE_KEY],
];
for (const [name, value] of targets) {
  spawnSync('vercel', ['env','rm', name, 'preview', '--yes'], { shell:true, encoding:'utf8' }); // ensure clean
  const r = spawnSync('vercel', ['env','add', name, 'preview', '--value', value, '--yes'], { shell:true, encoding:'utf8' });
  console.log(`  ${r.status===0?'✓':'✗'} ${name} @ preview`);
  if (r.status !== 0) console.log('    ' + (r.stdout||r.stderr||'').split('\n').filter(Boolean).slice(-2).join(' | '));
}
console.log('Preview restore done.');
