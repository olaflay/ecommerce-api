/**
 * probe_divergence.ts — hostile-input differential probe for Part B vs Part C.
 *
 * AUDIT DEFECT 3 FIX: this file existed in the repository but was orphaned.
 * It was not wired into package.json scripts, not referenced from README.md,
 * and its output was recorded nowhere — while README/POST simultaneously
 * claimed "10/10 100% agreement". Its existence contradicts that headline,
 * because on the pre-fix manual implementation it DID find a divergence.
 *
 * This harness exists to answer one question honestly: do the manual and AI
 * implementations agree on inputs the 10-input comparative suite never tries?
 *
 * It reports every case, counts agreements, and exits non-zero on any
 * divergence so that `npm run test:probe` can never silently pass.
 */
import { calculateDeliveryFeeManual } from "./part-b/delivery_fee_manual.js";
import { calculateDeliveryFeeAI } from "./part-c/delivery_fee_ai.js";

console.log("===============================================================================");
console.log("HOSTILE-INPUT DIVERGENCE PROBE: MANUAL (Part B) vs AI (Part C)");
console.log("===============================================================================\n");

type Runner = (
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
) => { deliveryFeeKobo: number; isFreeDelivery: boolean };

const cases: Array<{ name: string; args: [number, number, string, boolean]; threat: string }> = [
  {
    name: "Infinity distance",
    args: [Infinity, 1000000, "bike", false],
    threat: "isNaN(Infinity)===false, so an isNaN-only guard lets this through",
  },
  {
    name: "NaN distance",
    args: [NaN, 1000000, "bike", false],
    threat: "NaN is never < 0, so a <0-only guard lets this through",
  },
  {
    name: "-Infinity distance",
    args: [-Infinity, 1000000, "bike", false],
    threat: "negative-infinity must be rejected by the finiteness rule, not the < 0 rule",
  },
  {
    name: "Infinity subtotal",
    args: [5, Infinity, "bike", false],
    threat: "Number.isInteger(Infinity)===false, so the subtotal guard should catch it",
  },
  {
    name: "tiny 0.0001 car peak",
    args: [0.0001, 1000000, "car", true],
    // 0.0001*15000 === 1.5 exactly, so step 4 has a genuine half-way tie.
    // The two readings of the spec diverge on paper, but in IEEE-754 doubles
    // both land on 87503 (87503.49999999999 and 87502.62499999999), so this
    // case documents a tie that does NOT diverge. Agreement here is luck.
    threat: "exact .5 tie at step 4; the two spec readings agree only by float luck, so a tie-passing suite proves nothing",
  },
  {
    name: "huge 1e20 car peak",
    args: [1e20, 1000000, "car", true],
    // Number.isFinite(1e20) is true, so step 1a admits this distance and both
    // implementations return the same fee. That shared value is not a safe
    // integer, so both are wrong. This is a SHARED defect, not a divergence.
    threat: "both agree and BOTH are wrong: 2.625e+24 is not a safe integer, yet the spec promises Integer kobo",
  },
  {
    name: "negative zero",
    args: [-0, 1000000, "bike", false],
    threat: "-0 < 0 is false, so -0 is admitted; must still yield 0, not -0 drift",
  },
];

let agreeCount = 0;
const divergences: string[] = [];

for (const c of cases) {
  let m: string;
  let a: string;
  try {
    m = "fee=" + (calculateDeliveryFeeManual(...c.args) as { deliveryFeeKobo: number }).deliveryFeeKobo;
  } catch (e) {
    m = "THREW: " + (e as Error).message;
  }
  try {
    a = "fee=" + (calculateDeliveryFeeAI(...c.args) as { deliveryFeeKobo: number }).deliveryFeeKobo;
  } catch (e) {
    a = "THREW: " + (e as Error).message;
  }
  const agree = m === a;
  if (agree) agreeCount++;
  else divergences.push(`${c.name} (${c.args.join(", ")}) -> manual ${m} | ai ${a}`);
  console.log(
    (agree ? "AGREE" : "*** DISAGREE ***").padEnd(18) +
      "| " +
      c.name.padEnd(24) +
      "| manual: " +
      m.padEnd(44) +
      "| ai: " +
      a
  );
  console.log(`${" ".repeat(19)}threat: ${c.threat}`);
}

console.log("\n===============================================================================");
console.log(`Summary: ${agreeCount}/${cases.length} hostile inputs agree across Manual and AI.`);
if (divergences.length) {
  console.log("Divergences found:");
  for (const d of divergences) console.log(`  - ${d}`);
} else {
  console.log("No divergence found. This covers 7 inputs; it is NOT a proof of general");
  console.log("equivalence. Inputs outside this list are still unverified.");
}
console.log("===============================================================================");

if (divergences.length) {
  console.error("RESULT: DIVERGENCE DETECTED — exiting with code 1");
  process.exit(1);
}
console.log("RESULT: NO DIVERGENCE ON THESE 7 HOSTILE INPUTS — exiting with code 0");
