# Part B1: Feature Specification Pseudocode — `calculateDeliveryFee`

> **READ THIS FIRST.** Section 2 below is preserved EXACTLY as it was first
> written, including its internal contradictions, because it is the honest
> record of the specification that was handed to the manual and AI
> implementations. Section 4 is the later audit pass: it names the ambiguities
> found in section 2, states the revised unambiguous pseudocode, and records
> which implementation was wrong as a result. Do not read section 2 as the
> final spec — read section 4 alongside it.

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

---

## 4. Ambiguity Log & Revised Pseudocode (added by audit)

Three genuine ambiguities were found in section 2. Each is stated with the
original wording, the reason it is ambiguous, and the revised wording that
removes the ambiguity. The revisions are what `part-b/delivery_fee_manual.ts`
now implements.

### AMBIGUITY 1 — the `FAILS WHEN` header and step 1 contradict each other about `Infinity`

**Original text, section 2 header:**
```text
FAILS WHEN:
  - distanceKm is negative or NaN
```

**Original text, section 2 step 1:**
```text
1. VALIDATE inputs:
     IF distanceKm is less than 0 or is not a finite number
```

**Why this is ambiguous, not merely verbose.** The two blocks are the same
rule written twice, and they disagree on set membership. `NaN` is not the only
non-finite value: `Infinity` and `-Infinity` are also not finite. A reader
implementing from the header writes `isNaN(distanceKm)`; a reader implementing
from the step writes `!Number.isFinite(distanceKm)`. Both are defensible
readings of the same document, and they produce different programs.

This is not hypothetical. `part-b/delivery_fee_manual.ts` followed the header,
so it validated with `isNaN` only, so `Infinity` passed validation, so the
function returned `fee = Infinity`. The AI implementation followed the step, so
it was correct. **The manual implementation was the defective one.** The
`isFinite` guard was never an unsolicited AI addition; it was the AI following
the specification's own step 1 against the specification's own weaker header.
See `part-c/DIFFERENCE_TABLE.md` for the corrected classification.

**Revised wording — header and step split into three independently numbered,
individually checkable guards:**
```text
FAILS WHEN:
  - distanceKm is not a finite number            (covers NaN, Infinity, -Infinity)
  - distanceKm is less than 0
  - subtotalKobo is less than 0 or is not an integer
  - vehicleType is not equal to "bike" AND is not equal to "car" AND is not equal to "van"
```

```text
1a. VALIDATE distanceKm is a finite number
      OTHERWISE RETURN error: Invalid distance (must be non-negative number)
    END VALIDATE
1b. VALIDATE distanceKm is greater than or equal to 0
      OTHERWISE RETURN error: Invalid distance (must be non-negative number)
    END VALIDATE
1c. VALIDATE subtotalKobo is greater than or equal to 0 AND is an integer
      OTHERWISE RETURN error: Invalid subtotal (must be non-negative integer)
    END VALIDATE
1d. VALIDATE vehicleType is one of "bike", "car", "van"
      OTHERWISE RETURN error: Unsupported vehicle type
    END VALIDATE
```

**Why 1a/1b and not one combined guard.** Bundling three rules into a single
numbered step is what let the weaker reading hide inside the stronger one. One
rule, one step, one check in the code. The early-exit order is now also
specified: distance first, then subtotal, then vehicle, which is the order both
implementations use.

### AMBIGUITY 2 — "rounded value of" does not say whether the step 4 rounding is authoritative

**Original text, section 2 step 4 and step 8:**
```text
4. COMPUTE distanceFeeKobo as rounded value of (distanceKm multiplied by 15000)
...
8. COMPUTE finalFeeKobo as rounded value of (rawBaseFee multiplied by surgeMultiplier)
```

**Why this is ambiguous.** The document rounds twice. It never says whether the
step 4 rounding is an *intermediate* value that step 6 is allowed to recompute
from the unrounded product, or an *authoritative* integer that step 6 must
consume as-is. "Rounded value of" does not settle that, and the two readings
disagree by real kobo at ordinary distances.

This is not a rounding-tie edge case. It is float representation error. For
`distanceKm = 64.07`, the exact decimal product is 961,050, but IEEE-754 double
arithmetic yields `64.07 * 15000 === 961049.9999999999`.

| Reading | Step 4 | Step 6 | Step 8 | Result |
|---|---|---|---|---|
| **A — step 4 rounding is authoritative** (adopted) | `round(961049.9999999999) = 961050` | `(50000 + 961050) * 1.4 = 1415470` | `round(1415470 * 1.25) = round(1769337.5) = 1769338` | **1,769,338 kobo (₦17,693.38)** |
| **B — defer all rounding to step 8** | no rounding | `(50000 + 961049.9999999999) * 1.4 = 1415469.9999999998` | `round(1415469.9999999998 * 1.25) = round(1769337.4999999998) = 1769337` | **1,769,337 kobo (₦17,693.37)** |

Both implementations, both readings, and all 17 hand-trace and comparative
inputs in this repository pass identically under either reading. The two
readings diverge on 133 distinct distances between 0.01 km and 200 km at
0.01 km granularity, using `car` or `van` with a peak-hour surge. The first
divergence found by exhaustive sweep is 64.07 km, shown above. Neither
implementation was wrong; the specification was, and it was wrong in a way that
changes a customer's charge.

**Revised wording:**
```text
4. COMPUTE distanceFeeKobo as ROUND_HALF_UP( distanceKm multiplied by 15000 )
   ROUND_HALF_UP means: return the integer nearest to the input; if the input is
   exactly halfway between two integers, return the LARGER of the two. This
   rounding is AUTHORITATIVE. Steps 6 and 8 must consume the already-rounded
   integer and must never recompute it from the unrounded product.

8. COMPUTE finalFeeKobo as ROUND_HALF_UP( rawBaseFee multiplied by surgeMultiplier )
   ROUND_HALF_UP is defined identically to step 4. The output is guaranteed to
   be a whole number of kobo for every input the step 1 guards admit.
```

**Tie-breaking is stated even though it is unobservable here.** With the 15,000
per-kilometre rate, `distanceKm * 15000` lands on an exact `.5` only at
distances that are not representable as doubles, so round-half-up and
round-half-to-even are observationally identical for this function. It is
specified anyway: an implementation must not be left to guess, and a future rate
change would make the choice observable.

### AMBIGUITY 3 — "integer division" was used in the original spec but the rounding mode was never defined

The original Part A money spec (superseded; see `part-a/02`) used the phrase
*"integer division ... rounding to nearest integer"* without ever saying whether
that means truncation toward zero, floor, or round-half-up. "Rounding to
nearest" and "integer division" are, taken literally, different operations:
integer division truncates, rounding to nearest does not. `Math.floor(2.9)` is
`2` and `Math.round(2.9)` is `3`.

**Resolution, applied everywhere in this repository:** the operation is written
`ROUND_HALF_UP(x)`, truncation is never used for money, and the term "integer
division" has been removed from every specification. The one place it could
have caused a customer-visible overcharge, the Part A coupon calculator, is
handled explicitly in `part-a/08` and `part-a/09`, where step 2 names
`ROUND_HALF_UP` directly.

---

## 5. Verification of Step-to-Code Traceability

Every numbered step in the revised specification maps to exactly one labelled
region of `part-b/delivery_fee_manual.ts`. The mapping is restated in that
file's header comment.

| Revised step | Manual implementation | AI implementation |
|---|---|---|
| 1a distance finite | `// Step 1a` | `// Step 1a` |
| 1b distance non-negative | `// Step 1a` (same guard, second clause) | `// Step 1a` (same guard, first clause) |
| 1c subtotal non-negative integer | `// Step 1b` | `// Step 1b` |
| 1d vehicle allowlist | `// Step 1c` | `// Step 1c` |
| 2 free delivery | `// Step 2` | `// Step 2` |
| 3 base fee | `// Step 3` | `// Step 3` |
| 4 distance fee | `// Step 4` | `// Step 4` |
| 5 vehicle multiplier | `// Step 5` | `// Step 5` |
| 6 raw base fee | `// Step 6` | `// Step 6` |
| 7 surge multiplier | `// Step 7` | `// Step 7` |
| 8 final fee | `// Step 8` | `// Step 8` |
| 9 return envelope | `// Step 9` | `// Step 9` |

The only traceability break found by this audit was step 1, where the code
checked `isNaN` while the step said "is not a finite number". That is fixed;
`evidence/probe_divergence.log` is the executed proof, because `Infinity`,
`NaN` and `-Infinity` are inputs 1, 2 and 3 of that probe and all three now
throw the specified error in both implementations.
