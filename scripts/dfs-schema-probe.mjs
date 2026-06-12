/**
 * DataForSEO schema/balance probe — run from a network that can reach
 * api.dataforseo.com (the deployed app's environment can; some networks block
 * the Hetzner-hosted API IPs).
 *
 *   node scripts/dfs-schema-probe.mjs
 *
 * Prints the live account balance (free call) and, if funded, the response
 * shape of every endpoint the Semrush→DataForSEO migration depends on, so the
 * field mappings in lib/dataforseo.ts + lib/dataforseo-backlinks.ts can be
 * confirmed. Total cost: a few cents (limits kept tiny).
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp(`${k}\\s*=\\s*"?([^"\\n\\r]+)"?`)) || [])[1]?.trim();
const auth =
  "Basic " + Buffer.from(`${get("DATAFORSEO_LOGIN")}:${get("DATAFORSEO_PASSWORD")}`).toString("base64");
const BASE = "https://api.dataforseo.com/v3";

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify([body]) : undefined,
  });
  return { http: res.status, json: await res.json().catch(() => ({})) };
}

const u = await call("GET", "appendix/user_data");
const balance = u.json?.tasks?.[0]?.result?.[0]?.money?.balance;
console.log("user_data HTTP", u.http, "| status_code", u.json?.status_code, "| BALANCE $", balance);
if (typeof balance !== "number" || balance < 0.1) {
  console.log("Balance too low — top up at app.dataforseo.com, then re-run.");
  process.exit(0);
}

function shape(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log("HTTP", r.http, "task_status", r.json?.tasks?.[0]?.status_code, "cost", r.json?.tasks?.[0]?.cost);
  const result = r.json?.tasks?.[0]?.result?.[0];
  if (!result) return console.log("(no result)", JSON.stringify(r.json?.tasks?.[0]?.status_message ?? ""));
  console.log("result[0] keys:", Object.keys(result));
  const items = result.items;
  console.log(Array.isArray(items) && items[0]
    ? "items[0]: " + JSON.stringify(items[0], null, 1).slice(0, 2000)
    : "result[0]: " + JSON.stringify(result, null, 1).slice(0, 2000));
}

const LOC = { location_code: 2840, language_code: "en" };
shape("competitors_domain", await call("POST", "dataforseo_labs/google/competitors_domain/live",
  { target: "katzmelinger.com", ...LOC, limit: 3, item_types: ["organic"] }));
shape("related_keywords", await call("POST", "dataforseo_labs/google/related_keywords/live",
  { keyword: "wrongful termination", ...LOC, limit: 3, depth: 1 }));
shape("keyword_suggestions", await call("POST", "dataforseo_labs/google/keyword_suggestions/live",
  { keyword: "wrongful termination", ...LOC, limit: 3 }));
shape("backlinks/summary", await call("POST", "backlinks/summary/live",
  { target: "katzmelinger.com", internal_list_limit: 1, backlinks_status_type: "live", include_subdomains: true }));
shape("backlinks/referring_domains", await call("POST", "backlinks/referring_domains/live",
  { target: "katzmelinger.com", limit: 3, order_by: ["backlinks,desc"], backlinks_status_type: "live" }));
shape("backlinks/backlinks", await call("POST", "backlinks/backlinks/live",
  { target: "katzmelinger.com", limit: 3, mode: "one_per_domain", order_by: ["first_seen,desc"], backlinks_status_type: "live" }));
