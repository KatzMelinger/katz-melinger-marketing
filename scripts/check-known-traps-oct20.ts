/**
 * The Oct 20 trap changes, checked against real phrasings.
 *
 *   node scripts/run.mjs scripts/check-known-traps-oct20.ts
 *
 * Read-only, no DB. The guarantee trap must fire on the eb5d488b sentence and
 * its siblings, and stay quiet on ordinary uses of "always"; the approved
 * replacement must clear it. Every Oct 6 trap must still pass the corrected
 * sentence, so the fix never trades one finding for another.
 */
import { matchTrap, type KnownTrap } from "../lib/known-traps";
import { GUARANTEE_TRAP, OCT20_CORRECTIONS, RETIRED_TRAPS } from "../lib/known-traps-oct20";
import { OCT6_TRAPS } from "../lib/known-traps-oct6";

const asTrap = (t: typeof GUARANTEE_TRAP): KnownTrap => ({ ...t, id: t.number, enabled: true });
const trap = asTrap(GUARANTEE_TRAP);
const ctx = { isWebPage: true };

const FIRE = [
  "Severance agreements are almost always negotiable.",
  "Severance packages are always negotiable.",
  "With the right lawyer you will always win.",
  "Employees almost always recover their unpaid wages.",
];
const PASS = [
  "Severance agreements are often negotiable.",
  "Always keep copies of your pay stubs.",
  "Your employer must always pay overtime after 40 hours.",
  "We always return calls within one business day.",
];

let failures = 0;
for (const s of FIRE) {
  if (matchTrap(trap, s, ctx).length === 0) {
    failures++;
    console.log(`FAIL should fire: ${s}`);
  }
}
for (const s of PASS) {
  if (matchTrap(trap, s, ctx).length > 0) {
    failures++;
    console.log(`FAIL should pass: ${s}`);
  }
}

// The correction must clear the guarantee trap and trip nothing else.
for (const c of OCT20_CORRECTIONS) {
  const after = `Severance agreements are ${c.replace}.`;
  if (matchTrap(trap, after, ctx).length > 0) {
    failures++;
    console.log(`FAIL correction still fires: ${after}`);
  }
  for (const t of OCT6_TRAPS) {
    if (t.matchType === "document_missing") continue;
    if (matchTrap(asTrap(t), after, ctx).length > 0) {
      failures++;
      console.log(`FAIL correction trips trap ${t.number}: ${after}`);
    }
  }
}

// Retired traps are gone from the source list.
for (const r of RETIRED_TRAPS) {
  if (OCT6_TRAPS.some((t) => t.label === r.label)) {
    failures++;
    console.log(`FAIL retired trap still in OCT6_TRAPS: ${r.label}`);
  }
}

console.log(`cases: ${FIRE.length} fire, ${PASS.length} pass`);
console.log(failures ? `${failures} FAILED` : "all passed");
if (failures) process.exit(1);
