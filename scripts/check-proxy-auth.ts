/**
 * Auth-proxy regression tests.
 *
 *   node scripts/run.mjs scripts/check-proxy-auth.ts
 *
 * Exercises proxy() directly. This change can take the whole site down if the
 * fail-closed branch fires when it should not, so it gets tested rather than
 * reasoned about.
 */
import { readFileSync } from "node:fs";
// The runner does not load .env.local, so without this the "env present" cases
// would silently test the missing-env path and look like a code failure.
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

let pass = 0, fail = 0;
const t = (n: string, c: boolean) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };

const REAL = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  vercel: process.env.VERCEL,
  node: process.env.NODE_ENV,
};

function setEnv(e: { url?: string; anon?: string; vercel?: string; node?: string }) {
  if (e.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = e.url;
  if (e.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = e.anon;
  if (e.vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = e.vercel;
  // NODE_ENV is typed readonly but is a plain env var at runtime.
  (process.env as Record<string, string | undefined>).NODE_ENV = e.node;
}

const req = (path: string) => new NextRequest(new URL(path, "https://app.example.test"));

async function main() {
  console.log("Auth env MISSING — the branch that used to let everything through:");

  setEnv({ node: "development" });
  let res = await proxy(req("/api/content/site-inventory/ingest-url"));
  t("local dev, API      -> passes through (app still boots)", res.status === 200);

  setEnv({ node: "production" });
  res = await proxy(req("/api/content/site-inventory/ingest-url"));
  t("NODE_ENV=production, API  -> 503, NOT open", res.status === 503);
  const body = await res.json().catch(() => ({}));
  t("  and the 503 names the missing variables",
    typeof body?.detail === "string" && body.detail.includes("NEXT_PUBLIC_SUPABASE_URL"));

  setEnv({ node: "development", vercel: "1" });
  res = await proxy(req("/api/content/drafts"));
  t("VERCEL preview, API       -> 503 (a broken preview is not a free pass)", res.status === 503);

  setEnv({ node: "production" });
  res = await proxy(req("/dashboard"));
  t("production, PAGE          -> 503 rather than a redirect loop to /login", res.status === 503);

  setEnv({ node: "production" });
  res = await proxy(req("/login"));
  t("production, /login        -> 503 too (login cannot work without Supabase)", res.status === 503);

  console.log("\nOnly one variable missing is still misconfigured:");
  setEnv({ url: "https://x.supabase.co", node: "production" });
  res = await proxy(req("/api/content/drafts"));
  t("URL set, anon key missing -> 503", res.status === 503);

  console.log("\nEnv PRESENT — existing behaviour must be untouched:");
  setEnv({ url: REAL.url, anon: REAL.anon, node: "production" });
  res = await proxy(req("/api/content/drafts"));
  t("no session, private API   -> 401 (default-deny still works)", res.status === 401);

  res = await proxy(req("/api/auth/signin"));
  t("no session, public API    -> allowed", res.status === 200);

  res = await proxy(req("/dashboard"));
  t("no session, private page  -> redirect to /login",
    res.status === 307 && (res.headers.get("location") ?? "").includes("/login"));

  res = await proxy(req("/login"));
  t("no session, /login        -> allowed", res.status === 200);

  setEnv({ url: REAL.url, anon: REAL.anon, vercel: REAL.vercel, node: REAL.node });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
