// Diff (and optionally apply) Supabase Auth config OLD -> NEW via Management API.
//   node scripts/mig-auth-config.mjs          -> diff only (no changes)
//   node scripts/mig-auth-config.mjs --apply  -> PATCH new with old's URL config
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.migration','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const OLD = 'yijrpbdctzrgfpwdezqn';
const NEW = 'ijlesksgnfqqpxtaelqs';
const API = 'https://api.supabase.com';
const apply = process.argv.includes('--apply');

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const mask = (k, v) => (/secret|pass|token|key|client_secret/i.test(k) && v ? '••••(set)' : v);

async function getAuth(ref) {
  const r = await fetch(`${API}/v1/projects/${ref}/config/auth`, { headers: H });
  if (!r.ok) throw new Error(`${ref}: ${r.status} ${await r.text()}`);
  return r.json();
}

const oldCfg = await getAuth(OLD);
const newCfg = await getAuth(NEW);

// Fields that govern "where do auth emails/redirects point" + email/SMTP behavior.
const FOCUS = ['site_url','uri_allow_list','jwt_exp','mailer_autoconfirm','external_email_enabled',
  'external_anonymous_users_enabled','smtp_admin_email','smtp_host','smtp_port','smtp_user',
  'smtp_sender_name','mailer_otp_exp','external_phone_enabled','disable_signup'];

console.log('=== AUTH CONFIG DIFF (old -> new) ===\n');
let diffs = 0;
for (const k of FOCUS) {
  const o = oldCfg[k], n = newCfg[k];
  const same = JSON.stringify(o) === JSON.stringify(n);
  if (!same) diffs++;
  console.log(`${same ? '  ' : '~ '}${k}:`);
  console.log(`    old: ${JSON.stringify(mask(k, o))}`);
  if (!same) console.log(`    new: ${JSON.stringify(mask(k, n))}`);
}
console.log(`\n${diffs} focus field(s) differ.`);

if (apply) {
  // Copy URL-routing fields (safe, no secrets). For the allow-list, UNION old +
  // new so the production domain is added WITHOUT dropping localhost (dev).
  const merged = [...new Set([...(oldCfg.uri_allow_list||'').split(','), ...(newCfg.uri_allow_list||'').split(',')].map(s=>s.trim()).filter(Boolean))].join(',');
  const body = { site_url: oldCfg.site_url, uri_allow_list: merged };
  console.log('\nApplying to NEW:', JSON.stringify(body));
  const r = await fetch(`${API}/v1/projects/${NEW}/config/auth`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  console.log(r.ok ? '✅ applied' : `❌ ${r.status} ${await r.text()}`);
} else {
  console.log('\n(diff only — re-run with --apply to copy site_url + uri_allow_list to new)');
}
