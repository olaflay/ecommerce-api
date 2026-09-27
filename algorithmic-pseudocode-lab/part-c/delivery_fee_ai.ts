/**
 * AI-generated implementation of calculateDeliveryFee produced strictly from pseudocode
 */
export function calculateDeliveryFeeAI(
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
) {
  // 1. Validate inputs
  if (distanceKm < 0 || typeof distanceKm !== "number" || !isFinite(distanceKm)) {
    throw new Error("Invalid distance (must be non-negative number)");
  }
  if (subtotalKobo < 0 || !Number.isInteger(subtotalKobo)) {
    throw new Error("Invalid subtotal (must be non-negative integer)");
  }
  if (!["bike", "car", "van"].includes(vehicleType)) {
    throw new Error("Unsupported vehicle type");
  }

  // 2. Check free delivery qualification
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

  // 3. Base fee
  const baseFeeKobo = 50000;

  // 4. Distance fee
  const distanceFeeKobo = Math.round(distanceKm * 15000);

  // 5. Vehicle multiplier
  const vehicleMultipliers: Record<string, number> = {
    bike: 1.0,
    car: 1.4,
    van: 2.0,
  };
  const vehicleMultiplier = vehicleMultipliers[vehicleType];

  // 6. Raw base fee
  const rawBaseFee = (baseFeeKobo + distanceFeeKobo) * vehicleMultiplier;

  // 7. Peak surge
  const surgeMultiplier = isPeakHour ? 1.25 : 1.0;

  // 8. Final fee
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
