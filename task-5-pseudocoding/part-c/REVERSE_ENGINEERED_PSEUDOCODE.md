# Part C2: Reverse-Engineered Pseudocode (Derived from AI Code)

> **Read this with the source.** This is a reconstruction of the *actual
> behaviour* of `delivery_fee_ai.ts`, not a restatement of the specification. Where
> the two differ, this file follows the code. It is a change-log target: if the
> AI code is edited, this file is now wrong and must be regenerated.

## What was corrected in this file

The previous version of this file opened with:

```text
  distanceKm: Any value (checked for number, finite, >= 0)
  subtotalKobo: Any value (checked for integer, >= 0)
```

**That was false.** It was the single most-cited falsehood in the whole
submission, because it invited the conclusion that the AI emitted untyped code
and left validation to chance. The truth is the opposite, and it is readable in
`delivery_fee_ai.ts` lines 13-18:

```ts
export function calculateDeliveryFeeAI(
  distanceKm: number,
  subtotalKobo: number,
  vehicleType: string,
  isPeakHour: boolean
): DeliveryFeeResult {
```

The AI declared a precise, fully typed signature. There is no `any` anywhere in
the file. "Any value" has been replaced below with the real types.

## Reverse-engineered pseudocode

```text
FUNCTION calculateDeliveryFee_REVERSE_ENGINEERED
INPUTS:
  distanceKm: Number            (TypeScript `number`, declared at line 14)
  subtotalKobo: Number          (TypeScript `number`, declared at line 15;
                                 the integer constraint is a RUNTIME guard, not a
                                 static type, because TypeScript has no Integer type)
  vehicleType: String           (TypeScript `string`, declared at line 16;
                                 narrowed to "bike" | "car" | "van" by a runtime guard)
  isPeakHour: Boolean           (TypeScript `boolean`, declared at line 17)
OUTPUT:
  result: Object with deliveryFeeKobo, isFreeDelivery, and breakdown object
  (the return type is INFERRED, not annotated: line 18 declares no return type)
SIDE EFFECTS:
  NONE — the function is pure. It reads no module state, performs no I/O, and
  mutates nothing outside its own local variables.
FAILS WHEN:  (each throws `new Error(<message>)`, not a custom error class)
  - distanceKm is negative, not a number, or non-finite
        -> throws "Invalid distance (must be non-negative number)"   (guard line 20)
  - subtotalKobo is negative or not an integer
        -> throws "Invalid subtotal (must be non-negative integer)"  (guard line 24)
  - vehicleType is not found in ["bike", "car", "van"]
        -> throws "Unsupported vehicle type"                         (guard line 28)

1. VALIDATE distanceKm, OTHERWISE throw Error
     (line 20: distanceKm < 0 OR typeof distanceKm !== "number" OR !isFinite(distanceKm))
     NOTE the clause order: the `< 0` test is evaluated FIRST, so a string input
     such as "-5" is rejected by the typeof clause only after the comparison
     coerces it. See section "Ordering, restated honestly" below.
2. VALIDATE subtotalKobo, OTHERWISE throw Error
     (line 24: subtotalKobo < 0 OR !Number.isInteger(subtotalKobo))
3. VALIDATE vehicleType is in ["bike", "car", "van"], OTHERWISE throw Error
     (line 28: !["bike", "car", "van"].includes(vehicleType))
4. IF subtotalKobo >= 3000000 AND distanceKm <= 10
      RETURN {
        deliveryFeeKobo: 0,
        isFreeDelivery: true,
        breakdown: { baseFeeKobo: 0, distanceFeeKobo: 0,
                     vehicleMultiplier: 1.0, surgeMultiplier: 1.0 }
      }
    END IF
     QUIRK PRESERVED DELIBERATELY: the free-delivery branch reports
     vehicleMultiplier 1.0 and surgeMultiplier 1.0 WITHOUT ever having selected
     a multiplier. Step 3 has not run yet at that point, so no per-vehicle value
     exists to report. Both implementations do this identically; it is a quirk
     of the specification, not a divergence, and it is recorded rather than
     silently normalised away.
5. SET baseFeeKobo to 50000                                             (line 47)
6. SET distanceFeeKobo to Math.round(distanceKm * 15000)               (line 50)
7. LOOK UP vehicleType in { bike: 1.0, car: 1.4, van: 2.0 }
     (lines 53-58, a constant dictionary rather than an IF/ELSE ladder)
8. SET rawBaseFee to (baseFeeKobo + distanceFeeKobo) * vehicleMultiplier  (line 61)
9. SET surgeMultiplier to 1.25 IF isPeakHour, OTHERWISE 1.0               (line 64)
10. SET finalFeeKobo to Math.round(rawBaseFee * surgeMultiplier)          (line 67)
11. RETURN {
       deliveryFeeKobo: finalFeeKobo,
       isFreeDelivery: false,
       breakdown: { baseFeeKobo, distanceFeeKobo, vehicleMultiplier, surgeMultiplier }
     }
```

## Ordering, restated honestly

The manual implementation evaluates the distance guards in the order
`typeof`, then `Number.isFinite`, then `< 0`. The AI implementation evaluates
`< 0` first, then `typeof`, then `!isFinite`. **These are not identical
programs**, even though every input in this repository produces the same result,
because the three clauses short-circuit in different orders.

The only input class where the order could matter is a non-primitive value
forced past the static type system, such as a boxed `Number` object or a
`Symbol`. Neither implementation is specified to handle those, the signature
forbids them, and no test exercises them. This is recorded as a real, narrow
difference in `DIFFERENCE_TABLE.md` rather than smoothed over, and it is the one
place where "the two implementations are the same function" would be an
overstatement.

## Divergences from the specification, of the AI

None in behaviour. The reconstruction above matches the code, and the code
matches the specification's numbered steps. The defects in this submission were
in the *manual* implementation (a missing `isFinite` guard) and in this
project's *own documentation* (the false `Any value` header, the false
"AI added a finiteness check" claim). Both documentation defects are corrected
here and in `DIFFERENCE_TABLE.md` section 5.
