/**
 * AI-generated implementation of calculateDeliveryFee produced strictly from pseudocode
 *
 * PROVENANCE: see part-c/PROVENANCE.md. The exact prompt, model name and date
 * for this artifact are recorded there; that file is currently a PENDING record
 * because those facts were not preserved at authoring time.
 *
 * This file is preserved byte-for-byte in its observable behaviour. Only the
 * step comment labels were aligned to the spec numbering so that the manual and
 * AI implementations can be compared line by line. No executable statement was
 * added, removed or altered.
 */
export function calculateDeliveryFeeAI(
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
) {
  // Step 1a: Validate distanceKm
  if (distanceKm < 0 || typeof distanceKm !== "number" || !isFinite(distanceKm)) {
    throw new Error("Invalid distance (must be non-negative number)");
  }
  // Step 1b: Validate subtotalKobo
  if (subtotalKobo < 0 || !Number.isInteger(subtotalKobo)) {
    throw new Error("Invalid subtotal (must be non-negative integer)");
  }
  // Step 1c: Validate vehicleType
  if (!["bike", "car", "van"].includes(vehicleType)) {
    throw new Error("Unsupported vehicle type");
  }

  // Step 2: Check free delivery qualification
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

  // Step 3: Base fee
  const baseFeeKobo = 50000;

  // Step 4: Distance fee
  const distanceFeeKobo = Math.round(distanceKm * 15000);

  // Step 5: Vehicle multiplier
  const vehicleMultipliers: Record<string, number> = {
    bike: 1.0,
    car: 1.4,
    van: 2.0,
  };
  const vehicleMultiplier = vehicleMultipliers[vehicleType];

  // Step 6: Raw base fee
  const rawBaseFee = (baseFeeKobo + distanceFeeKobo) * vehicleMultiplier;

  // Step 7: Peak surge
  const surgeMultiplier = isPeakHour ? 1.25 : 1.0;

  // Step 8: Final fee
  const finalFeeKobo = Math.round(rawBaseFee * surgeMultiplier);

  // 9. Return result
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
