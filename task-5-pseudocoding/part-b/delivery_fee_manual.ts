export type VehicleType = "bike" | "car" | "van";

export interface DeliveryFeeResult {
  deliveryFeeKobo: number;
  isFreeDelivery: boolean;
  breakdown: {
    baseFeeKobo: number;
    distanceFeeKobo: number;
    vehicleMultiplier: number;
    surgeMultiplier: number;
  };
}

/**
 * Calculates delivery fee from strict pseudocode specification (Part B1: Manual Implementation)
 *
 * STEP TRACEABILITY (audit defect 5) — every numbered step of
 * part-b/FEATURE_SPEC_PSEUDOCODE.md section 2 maps to one labelled code region.
 *
 *   Spec step 1a VALIDATE distanceKm   -> "// Step 1a"  (line below)
 *   Spec step 1b VALIDATE subtotalKobo -> "// Step 1b"
 *   Spec step 1c VALIDATE vehicleType  -> "// Step 1c"
 *   Spec step 2  CHECK free delivery   -> "// Step 2"
 *   Spec step 3  SET baseFeeKobo       -> "// Step 3"
 *   Spec step 4  COMPUTE distanceFee   -> "// Step 4"
 *   Spec step 5  DETERMINE multiplier  -> "// Step 5"
 *   Spec step 6  COMPUTE rawBaseFee    -> "// Step 6"
 *   Spec step 7  SET surgeMultiplier   -> "// Step 7"
 *   Spec step 8  COMPUTE finalFeeKobo  -> "// Step 8"
 *   Spec step 9  RETURN feeResult      -> "// Step 9"
 *
 * NOTE ON RENUMBERING: the original spec wrote validation as a single numbered
 * step 1 containing three independent rules. That bundling is the root cause of
 * the audit defect 1/5 bug and is resolved in FEATURE_SPEC_PSEUDOCODE.md
 * section 4 ("Ambiguity Log & Revised Pseudocode"). The implementation below
 * already follows the REVISED 1a/1b/1c numbering.
 */
export function calculateDeliveryFeeManual(
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
): DeliveryFeeResult {
  // Step 1a: VALIDATE distanceKm is a finite, non-negative number
  // FIXED (audit defect 1/5): this previously used `isNaN(distanceKm)` only.
  // `isNaN(Infinity) === false`, so `Infinity` passed validation and produced
  // `deliveryFeeKobo: Infinity`. The spec step 1a says "is not a finite number"
  // and the spec FAILS WHEN header says "is negative or NaN" — the two disagreed,
  // and the implementation followed the weaker header. `Number.isFinite` now
  // enforces the spec step, and rejects NaN, +Infinity and -Infinity together.
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("Invalid distance (must be non-negative number)");
  }
  // Step 1b: VALIDATE subtotalKobo is a non-negative integer
  if (!Number.isInteger(subtotalKobo) || subtotalKobo < 0) {
    throw new Error("Invalid subtotal (must be non-negative integer)");
  }
  // Step 1c: VALIDATE vehicleType is one of "bike", "car", "van"
  if (vehicleType !== "bike" && vehicleType !== "car" && vehicleType !== "van") {
    throw new Error("Unsupported vehicle type");
  }

  // Step 2: Check Free Delivery Qualification
  if (subtotalKobo >= 3000000 && distanceKm <= 10) {
    return {
      deliveryFeeKobo: 0,
      isFreeDelivery: true,
      breakdown: {
        baseFeeKobo: 0,
        distanceFeeKobo: 0,
        vehicleMultiplier: 1.0,
        surgeMultiplier: 1.0,
      },
    };
  }

  // Step 3: Base Fee
  const baseFeeKobo = 50000;

  // Step 4: COMPUTE distanceFeeKobo
  // REVISED spec step 4 (ambiguity fix): ROUND_HALF_UP to the nearest whole
  // kobo. This rounding is AUTHORITATIVE — steps 6 and 8 consume the already
  // rounded integer and never recompute it from the unrounded product.
  const distanceFeeKobo = Math.round(distanceKm * 15000);

  // Step 5: DETERMINE vehicleMultiplier
  let vehicleMultiplier = 1.0;
  if (vehicleType === "bike") {
    vehicleMultiplier = 1.0;
  } else if (vehicleType === "car") {
    vehicleMultiplier = 1.4;
  } else if (vehicleType === "van") {
    vehicleMultiplier = 2.0;
  }

  // Step 6: COMPUTE rawBaseFee
  const rawBaseFee = (baseFeeKobo + distanceFeeKobo) * vehicleMultiplier;

  // Step 7: SET surgeMultiplier
  const surgeMultiplier = isPeakHour ? 1.25 : 1.0;

  // Step 8: COMPUTE finalFeeKobo
  // REVISED spec step 8: ROUND_HALF_UP to the nearest whole kobo. Because
  // Math.round breaks exact .5 ties toward positive infinity, both step 4 and
  // step 8 are deterministic for every input the step 1 guards admit.
  const finalFeeKobo = Math.round(rawBaseFee * surgeMultiplier);

  // Step 9: Return Fee Result
  return {
    deliveryFeeKobo: finalFeeKobo,
    isFreeDelivery: false,
    breakdown: {
      baseFeeKobo,
      distanceFeeKobo,
      vehicleMultiplier,
      surgeMultiplier,
    },
  };
}
