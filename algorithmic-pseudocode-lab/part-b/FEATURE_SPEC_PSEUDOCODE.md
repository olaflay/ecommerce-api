# Part B1: Feature Specification Pseudocode — `calculateDeliveryFee`

## 1. Business Logic & Feature Requirements
The delivery fee calculation engine determines the cost to dispatch an e-commerce order from the merchant hub to the customer address.
- **Base Fee:** 500 NGN (50,000 kobo).
- **Distance Rate:** 150 NGN (15,000 kobo) per kilometer.
- **Free Delivery Rule:** If order `subtotalKobo` is greater than or equal to 30,000 NGN (3,000,000 kobo) AND delivery distance is less than or equal to 10 km, the entire delivery fee is waived (0 kobo).
- **Vehicle Surcharge:** 
  - `bike`: 1.0x (standard multiplier)
  - `car`: 1.4x (+40% surcharge)
  - `van`: 2.0x (+100% surcharge for bulk/heavy parcels)
- **Peak Hour Surge:** If the delivery is booked between 08:00–10:00 or 17:00–20:00 on weekdays, a 1.25x surge multiplier (+25%) applies to the calculated fee.

---

## 2. Pseudocode Specification

```text
FUNCTION calculateDeliveryFee
INPUTS:
  distanceKm: Number (straight-line or route distance, must be >= 0)
  subtotalKobo: Integer (cart merchandise subtotal in kobo, must be >= 0)
  vehicleType: String (one of "bike", "car", "van")
  isPeakHour: Boolean (true if delivery falls in morning/evening rush hour)
OUTPUT:
  feeResult: Object containing deliveryFeeKobo (Integer), isFreeDelivery (Boolean), breakdown (Object)
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - distanceKm is negative or NaN
  - subtotalKobo is negative or not an integer
  - vehicleType is not one of "bike", "car", "van"

1. VALIDATE inputs:
     IF distanceKm is less than 0 or is not a finite number
       RETURN error: Invalid distance (must be non-negative number)
     END IF
     IF subtotalKobo is less than 0 or is not an integer
       RETURN error: Invalid subtotal (must be non-negative integer)
     END IF
     IF vehicleType is not equal to "bike" AND is not equal to "car" AND is not equal to "van"
       RETURN error: Unsupported vehicle type
     END IF
2. CHECK free delivery qualification:
     IF subtotalKobo is greater than or equal to 3000000 AND distanceKm is less than or equal to 10
       RETURN feeResult with deliveryFeeKobo = 0, isFreeDelivery = true, and zeroed breakdown
     END IF
3. SET baseFeeKobo to 50000 (500 NGN)
4. COMPUTE distanceFeeKobo as rounded value of (distanceKm multiplied by 15000)
5. DETERMINE vehicleMultiplier:
     IF vehicleType is equal to "bike"
       SET vehicleMultiplier to 1.0
     OTHERWISE IF vehicleType is equal to "car"
       SET vehicleMultiplier to 1.4
     OTHERWISE IF vehicleType is equal to "van"
       SET vehicleMultiplier to 2.0
     END IF
6. COMPUTE rawBaseFee as (baseFeeKobo plus distanceFeeKobo) multiplied by vehicleMultiplier
7. IF isPeakHour is true
     SET surgeMultiplier to 1.25
   OTHERWISE
     SET surgeMultiplier to 1.0
   END IF
8. COMPUTE finalFeeKobo as rounded value of (rawBaseFee multiplied by surgeMultiplier)
9. RETURN feeResult object:
     deliveryFeeKobo = finalFeeKobo
     isFreeDelivery = false
     breakdown:
       baseFeeKobo = baseFeeKobo
       distanceFeeKobo = distanceFeeKobo
       vehicleMultiplier = vehicleMultiplier
       surgeMultiplier = surgeMultiplier
```

---

## 3. Hand-Trace Verification (5 Test Inputs)

### Trace 1: Standard Daytime Bike Delivery (5 km, Subtotal 1,000,000 kobo, bike, off-peak)
- `distanceKm`: 5, `subtotalKobo`: 1,000,000, `vehicleType`: "bike", `isPeakHour`: false
- **Trace:**
  - Free delivery? $1,000,000 < 3,000,000 \implies$ No.
  - Base fee: 50,000 kobo.
  - Distance fee: $5 \times 15,000 = 75,000$ kobo.
  - Subtotal fee: $50,000 + 75,000 = 125,000$ kobo.
  - Bike multiplier: 1.0 $\implies 125,000$.
  - Peak surge: 1.0 $\implies 125,000$.
  - **Result: 125,000 kobo (1,250 NGN), isFree: false**

### Trace 2: Free Delivery Threshold Met (8 km, Subtotal 3,500,000 kobo, bike, off-peak)
- `distanceKm`: 8, `subtotalKobo`: 3,500,000, `vehicleType`: "bike", `isPeakHour`: false
- **Trace:**
  - Free delivery? $3,500,000 \ge 3,000,000$ AND $8 \le 10 \implies$ **YES**.
  - **Result: 0 kobo, isFree: true**

### Trace 3: Free Delivery Disqualified by Distance (12 km, Subtotal 4,000,000 kobo, bike, off-peak)
- `distanceKm`: 12, `subtotalKobo`: 4,000,000, `vehicleType`: "bike", `isPeakHour`: false
- **Trace:**
  - Free delivery? $12 > 10 \implies$ **Disqualified by distance threshold**.
  - Base fee: 50,000. Distance: $12 \times 15,000 = 180,000$.
  - Raw fee: $50,000 + 180,000 = 230,000$.
  - Bike: 1.0, Peak: 1.0 $\implies 230,000$.
  - **Result: 230,000 kobo (2,300 NGN), isFree: false**

### Trace 4: Peak Hour Heavy Van Delivery (10 km, Subtotal 500,000 kobo, van, peak)
- `distanceKm`: 10, `subtotalKobo`: 500,000, `vehicleType`: "van", `isPeakHour`: true
- **Trace:**
  - Free delivery? No.
  - Base: 50,000. Distance: $10 \times 15,000 = 150,000$. Total base: 200,000 kobo.
  - Van multiplier: $2.0 \implies 200,000 \times 2.0 = 400,000$ kobo.
  - Peak surge: $1.25 \implies 400,000 \times 1.25 = 500,000$ kobo.
  - **Result: 500,000 kobo (5,000 NGN), isFree: false**

### Trace 5: Invalid Negative Distance (-4 km)
- `distanceKm`: -4, `subtotalKobo`: 1,000,000, `vehicleType`: "bike", `isPeakHour`: false
- **Trace:**
  - Validation: $-4 < 0 \implies$ Early Exit.
  - **Result: Error: Invalid distance (must be non-negative number)**
