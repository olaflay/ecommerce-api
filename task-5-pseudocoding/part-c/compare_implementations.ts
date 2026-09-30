import { calculateDeliveryFeeManual } from "../part-b/delivery_fee_manual.js";
import { calculateDeliveryFeeAI } from "./delivery_fee_ai.js";

console.log("===============================================================================");
console.log("PART C3: MANUAL VS. AI IMPLEMENTATION 10-INPUT COMPARATIVE BENCHMARK");
console.log("===============================================================================\n");

interface TestCase {
  name: string;
  distanceKm: number;
  subtotalKobo: number;
  vehicleType: string;
  isPeakHour: boolean;
  expectError?: boolean;
}

const testCases: TestCase[] = [
  // 5 Original Inputs
  {
    name: "Input 1: Standard Daytime Bike (5km, 1M subtotal, bike, off-peak)",
    distanceKm: 5,
    subtotalKobo: 1000000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 2: Free Delivery Threshold Met (8km, 3.5M subtotal, bike, off-peak)",
    distanceKm: 8,
    subtotalKobo: 3500000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 3: Free Delivery Disqualified by Distance (12km, 4M subtotal, bike, off-peak)",
    distanceKm: 12,
    subtotalKobo: 4000000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 4: Peak Hour Heavy Van (10km, 500k subtotal, van, peak)",
    distanceKm: 10,
    subtotalKobo: 500000,
    vehicleType: "van",
    isPeakHour: true,
  },
  {
    name: "Input 5: Invalid Negative Distance (-4km)",
    distanceKm: -4,
    subtotalKobo: 1000000,
    vehicleType: "bike",
    isPeakHour: false,
    expectError: true,
  },

  // 5 Additional Boundary / Edge Inputs
  {
    name: "Input 6: Exact Free Delivery Lower Bound (Exactly 10km, 3M subtotal)",
    distanceKm: 10.0,
    subtotalKobo: 3000000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 7: Distance Boundary Breached by 100m (10.1km, 3M subtotal)",
    distanceKm: 10.1,
    subtotalKobo: 3000000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 8: Zero Distance Pickup at Hub (0.0km, 500k subtotal, bike, off-peak)",
    distanceKm: 0.0,
    subtotalKobo: 500000,
    vehicleType: "bike",
    isPeakHour: false,
  },
  {
    name: "Input 9: Car Delivery with Fractional Distance and Peak Surge (7.3km, 800k, car, peak)",
    distanceKm: 7.3,
    subtotalKobo: 800000,
    vehicleType: "car",
    isPeakHour: true,
  },
  {
    name: "Input 10: Invalid Vehicle Type ('drone')",
    distanceKm: 5.0,
    subtotalKobo: 1000000,
    vehicleType: "drone",
    isPeakHour: false,
    expectError: true,
  },
];

let allIdentical = true;
let matchCount = 0;

testCases.forEach((tc, idx) => {
  let manualResult: any;
  let manualError: string | null = null;
  let aiResult: any;
  let aiError: string | null = null;

  // Run Manual Implementation
  try {
    manualResult = calculateDeliveryFeeManual(tc.distanceKm, tc.subtotalKobo, tc.vehicleType, tc.isPeakHour);
  } catch (err: any) {
    manualError = err.message;
  }

  // Run AI Implementation
  try {
    aiResult = calculateDeliveryFeeAI(tc.distanceKm, tc.subtotalKobo, tc.vehicleType, tc.isPeakHour);
  } catch (err: any) {
    aiError = err.message;
  }

  if (tc.expectError) {
    const errorMatch = manualError !== null && manualError === aiError;
    console.log(`[Test ${idx + 1}] ${tc.name}`);
    console.log(`   Manual Threw: "${manualError}"`);
    console.log(`   AI Threw:     "${aiError}"`);
    console.log(`   Agreement:    ${errorMatch ? "PERFECT MATCH" : "DIVERGENCE"}\n`);
    if (errorMatch) matchCount++;
    else allIdentical = false;
  } else {
    const feeMatch = manualResult?.deliveryFeeKobo === aiResult?.deliveryFeeKobo;
    const freeMatch = manualResult?.isFreeDelivery === aiResult?.isFreeDelivery;
    const match = feeMatch && freeMatch;
    console.log(`[Test ${idx + 1}] ${tc.name}`);
    console.log(`   Manual Fee: ${manualResult?.deliveryFeeKobo} kobo (Free: ${manualResult?.isFreeDelivery})`);
    console.log(`   AI Fee:     ${aiResult?.deliveryFeeKobo} kobo (Free: ${aiResult?.isFreeDelivery})`);
    console.log(`   Agreement:  ${match ? "PERFECT MATCH" : "DIVERGENCE"}\n`);
    if (match) matchCount++;
    else allIdentical = false;
  }
});

// AUDIT DEFECT 12 + 15 FIX: the old final line hard-coded the string
// "10/10 Test Inputs in 100% Agreement" regardless of the real tally, and the
// script always exited 0. Both are now derived from the observed results.
console.log("===============================================================================");
console.log(`Final Result: ${matchCount}/${testCases.length} test inputs in agreement across Manual and AI: ${allIdentical}`);
console.log("===============================================================================");
if (!allIdentical) {
  console.error("RESULT: DIVERGENCE DETECTED — exiting with code 1");
  process.exit(1);
}
console.log("RESULT: 100% AGREEMENT ON THIS 10-INPUT SUITE — exiting with code 0");
console.log(
  "NOTE: this suite covers 10 inputs only. It is NOT proof of general equivalence.\n" +
    "      See part-c/DIFFERENCE_TABLE.md section 4 and probe_divergence.ts, which found a\n" +
    "      real divergence on Infinity inputs while the manual implementation was buggy."
);
