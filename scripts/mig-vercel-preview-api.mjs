// Add the 4 Supabase env vars to Vercel PREVIEW (all preview branches) via the
// REST API — bypasses the CLI's per-branch prompt. Reads token from the CLI's
// auth.json and values from .env.migration. Prints no secret values.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const authPath = path.join(os.homedir(), 'AppData', 'Roaming', 'xdg.data', 'com.vercel.cli', 'auth.json');
const token = JSON.parse(fs.readFileSync(authPath, 'utf8')).token;
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const URL = 'https://ijlesksgnfqqpxtaelqs.supabase.co';
const PROJECT = 'katz-melinger-marketing';
const TEAM_SLUG = 'katz-melinger-s-projects';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// resolve teamId
const teams = await (await fetch('https://api.vercel.com/v2/teams', { headers: H })).json();
const team = (teams.teams || []).find(t => t.slug === TEAM_SLUG);
if (!team) { console.log('Could not resolve team. Teams: ' + (teams.teams||[]).map(t=>t.slug).join(', ')); process.exit(1); }
const q = `?teamId=${team.id}&upsert=true`;

const vars = [
  { key: 'SUPABASE_URL', value: URL },
  { key: 'NEXT_PUBLIC_SUPABASE_URL', value: URL },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: env.NEW_ANON_KEY },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', value: env.NEW_SERVICE_ROLE_KEY },
];

for (const v of vars) {
  if (!v.value) { console.log(`  ! ${v.key}: missing value`); continue; }
  const body = { key: v.key, value: v.value, type: 'encrypted', target: ['preview'] };
  const r = await fetch(`https://api.vercel.com/v10/projects/${PROJECT}/env${q}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  console.log(`  ${r.ok ? '✓' : '✗'} ${v.key} @ preview${r.ok ? '' : ' -> ' + (j.error?.message || JSON.stringify(j))}`);
}
console.log('done.');
