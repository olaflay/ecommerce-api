import { calculateDeliveryFeeManual } from "./delivery_fee_manual.js";

console.log("===============================================================================");
console.log("PART B2: HAND-TRACE VS. MANUAL IMPLEMENTATION EXECUTION BENCHMARKS");
console.log("===============================================================================\n");

const tests = [
  {
    name: "Input 1: Standard Daytime Bike (5km, 1M subtotal, bike, off-peak)",
    run: () => calculateDeliveryFeeManual(5, 1000000, "bike", false),
    expectedFee: 125000,
    expectedFree: false,
  },
  {
    name: "Input 2: Free Delivery Threshold Met (8km, 3.5M subtotal, bike, off-peak)",
    run: () => calculateDeliveryFeeManual(8, 3500000, "bike", false),
    expectedFee: 0,
    expectedFree: true,
  },
  {
    name: "Input 3: Free Delivery Disqualified by Distance (12km, 4M subtotal, bike, off-peak)",
    run: () => calculateDeliveryFeeManual(12, 4000000, "bike", false),
    expectedFee: 230000,
    expectedFree: false,
  },
  {
    name: "Input 4: Peak Hour Heavy Van (10km, 500k subtotal, van, peak)",
    run: () => calculateDeliveryFeeManual(10, 500000, "van", true),
    expectedFee: 500000,
    expectedFree: false,
  },
  {
    name: "Input 5: Invalid Negative Distance (-4km)",
    run: () => {
      try {
        calculateDeliveryFeeManual(-4, 1000000, "bike", false);
        return { error: "DID_NOT_THROW" };
      } catch (err: any) {
        return { error: err.message };
      }
    },
    expectedError: "Invalid distance (must be non-negative number)",
  },
];

let allPassed = true;
let passCount = 0;
tests.forEach((t, i) => {
  const result: any = t.run();
  if (t.expectedError) {
    const match = result.error === t.expectedError;
    console.log(`[Trace ${i + 1}] ${t.name}: ${match ? "PASS (Threw expected error)" : "FAIL"}`);
    if (match) passCount++;
    else {
      allPassed = false;
      console.log(`         Expected error: "${t.expectedError}"`);
      console.log(`         Observed:        "${result.error}"`);
    }
  } else {
    const match = result.deliveryFeeKobo === t.expectedFee && result.isFreeDelivery === t.expectedFree;
    console.log(
      `[Trace ${i + 1}] ${t.name}: ${match ? "PASS" : "FAIL"} (Observed: ${result.deliveryFeeKobo} kobo, Expected: ${t.expectedFee} kobo)`
    );
    if (match) passCount++;
    else allPassed = false;
  }
});

console.log(`\n${passCount}/${tests.length} hand traces match manual execution exactly: ${allPassed}`);
console.log("===============================================================================");

// AUDIT DEFECT 12 FIX: this harness previously always exited 0, so a failing
// trace still reported success to npm/CI. Exit non-zero when anything fails.
if (!allPassed) {
  console.error("RESULT: FAIL — exiting with code 1");
  process.exit(1);
}
console.log("RESULT: PASS — exiting with code 0");
