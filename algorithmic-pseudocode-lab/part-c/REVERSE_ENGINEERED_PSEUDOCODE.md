# Part C2: Reverse-Engineered Pseudocode (Derived from AI Code)

```text
FUNCTION calculateDeliveryFee_REVERSE_ENGINEERED
INPUTS:
  distanceKm: Any value (checked for number, finite, >= 0)
  subtotalKobo: Any value (checked for integer, >= 0)
  vehicleType: String
  isPeakHour: Boolean
OUTPUT:
  result: Object with deliveryFeeKobo, isFreeDelivery, and breakdown object
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - distanceKm is negative, not a number, or non-finite (throws Error)
  - subtotalKobo is negative or not an integer (throws Error)
  - vehicleType is not found in array ["bike", "car", "van"] (throws Error)

1. VALIDATE distanceKm is non-negative finite number, OTHERWISE throw Error
2. VALIDATE subtotalKobo is non-negative integer, OTHERWISE throw Error
3. VALIDATE vehicleType is in ["bike", "car", "van"], OTHERWISE throw Error
4. IF subtotalKobo is greater than or equal to 3000000 AND distanceKm is less than or equal to 10
     RETURN object with deliveryFeeKobo = 0, isFreeDelivery = true, and zeroed breakdown
   END IF
5. SET baseFeeKobo to 50000
6. MULTIPLY distanceKm by 15000, round to nearest integer, and assign to distanceFeeKobo
7. LOOK UP vehicleType in lookup dictionary {"bike": 1.0, "car": 1.4, "van": 2.0} and assign to vehicleMultiplier
8. COMPUTE rawBaseFee as sum of baseFeeKobo and distanceFeeKobo, then multiply by vehicleMultiplier
9. IF isPeakHour is true
     SET surgeMultiplier to 1.25
   OTHERWISE
     SET surgeMultiplier to 1.0
   END IF
10. MULTIPLY rawBaseFee by surgeMultiplier, round to nearest integer, and assign to finalFeeKobo
11. RETURN result object with finalFeeKobo, isFreeDelivery = false, and breakdown object
```
