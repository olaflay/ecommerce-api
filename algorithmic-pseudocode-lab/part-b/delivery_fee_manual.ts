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
 * Calculates delivery fee from strict pseudocode specification (Part B2: Manual Implementation)
 */
export function calculateDeliveryFeeManual(
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
): DeliveryFeeResult {
  // Step 1: Input Validation
  if (typeof distanceKm !== "number" || isNaN(distanceKm) || distanceKm < 0) {
    throw new Error("Invalid distance (must be non-negative number)");
  }
  if (!Number.isInteger(subtotalKobo) || subtotalKobo < 0) {
    throw new Error("Invalid subtotal (must be non-negative integer)");
  }
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

  // Step 4: Distance Fee
  const distanceFeeKobo = Math.round(distanceKm * 15000);

  // Step 5: Vehicle Multiplier
  let vehicleMultiplier = 1.0;
  if (vehicleType === "bike") {
    vehicleMultiplier = 1.0;
  } else if (vehicleType === "car") {
    vehicleMultiplier = 1.4;
  } else if (vehicleType === "van") {
    vehicleMultiplier = 2.0;
  }

  // Step 6: Raw Base Fee
  const rawBaseFee = (baseFeeKobo + distanceFeeKobo) * vehicleMultiplier;

  // Step 7: Peak Hour Surge
  const surgeMultiplier = isPeakHour ? 1.25 : 1.0;

  // Step 8: Final Fee Calculation
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
