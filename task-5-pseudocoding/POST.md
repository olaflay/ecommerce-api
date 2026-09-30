# The Spec is the Prompt: What Pseudocode Taught Me About Directing AI

If you ask an AI coding agent to *"build a dynamic delivery fee calculator with free shipping discounts and vehicle surcharges"*, you will get code that looks elegant, compiles cleanly, and silently destroys your business margins.

It will invent arbitrary default values. It will apply discounts before validating minimum thresholds. It will use floating-point numbers that round 49.99999 cents. And worst of all: because the code compiles, you will trust that it works.

For **Task 5 of the Product Engineering Bootcamp**, I ran a controlled experiment: I wrote a rigorous, standardized pseudocode specification first, implemented it manually without AI, handed *only* the pseudocode to an AI agent, and then reverse-engineered the AI's output line by line to compare them across 10 adversarial edge inputs.

Here is what the exercise revealed about the gap between what humans think they asked for, and what code actually does.

---

## 1. The Strict Pseudocode Standard

Loose pseudocode is where misunderstandings hide. In our lab, every algorithm was constrained to a formal contract:

```text
FUNCTION calculateDeliveryFee
INPUTS:
  distanceKm: Number (>= 0)
  subtotalKobo: Integer (cart merchandise subtotal in kobo, >= 0)
  vehicleType: String ("bike", "car", "van")
  isPeakHour: Boolean
OUTPUT:
  feeResult: Object containing deliveryFeeKobo (Integer), isFreeDelivery (Boolean), breakdown
SIDE EFFECTS: NONE
FAILS WHEN:
  - distanceKm is negative or NaN
  - subtotalKobo is negative or not an integer
  - vehicleType is not one of "bike", "car", "van"
```

Notice what is missing: no programming language syntax, no `const`, no `Array.prototype.find`. Just pure mathematical inputs, boundaries, side effects, and numbered sequential actions.

---

## 2. The Power of Directing AI with Pure Pseudocode

When I prompted the AI with **only** the numbered pseudocode specification (without explanatory prose), something remarkable happened:
1. **Zero Hallucinated Edge Cases:** The AI did not add unsolicited features (like tipping, tax calculation, or currency conversions).
2. **Zero Missing Guardrails:** It checked `distanceKm < 0`, `Number.isInteger(subtotalKobo)`, and vehicle inclusion in the exact order specified.
3. **Exact Mathematical Parity:** When running both implementations against 10 test cases—including decimal boundaries (`10.0 km` vs `10.1 km`), zero distances, and unsupported vehicles:

```log
===============================================================================
PART C3: MANUAL VS. AI IMPLEMENTATION 10-INPUT COMPARATIVE BENCHMARK
===============================================================================
[Test 1] Standard Daytime Bike (5km, 1M subtotal)   -> Agreement: PERFECT MATCH
[Test 2] Free Delivery Threshold Met (8km, 3.5M)    -> Agreement: PERFECT MATCH
[Test 3] Distance Disqualification (12km, 4M)       -> Agreement: PERFECT MATCH
[Test 4] Peak Hour Heavy Van (10km, 500k, peak)     -> Agreement: PERFECT MATCH
[Test 5] Invalid Negative Distance (-4km)           -> Agreement: PERFECT MATCH (Threw expected error)
[Test 6] Exact Free Delivery Bound (10.0km, 3M)     -> Agreement: PERFECT MATCH
[Test 7] 100m Distance Breach (10.1km, 3M)          -> Agreement: PERFECT MATCH
[Test 8] Zero Distance Curbside Pickup (0.0km)      -> Agreement: PERFECT MATCH
[Test 9] Fractional Distance (7.3km, car, peak)     -> Agreement: PERFECT MATCH
[Test 10] Invalid Vehicle Type ('drone')            -> Agreement: PERFECT MATCH (Threw expected error)
===============================================================================
Final Result: 10/10 Test Inputs in 100% Agreement across Manual and AI: true
===============================================================================
```

---

## 3. The Reverse-Engineering Discipline

The real test of an engineer is not whether you can prompt an AI to write code; it is whether you can **read code you did not write and reverse-engineer its exact logic back into pseudocode**.

When I reverse-engineered the AI's TypeScript output back into plain English without looking at my original notes, three interesting discrepancies emerged:
1. **The AI Optimized the Branching Ladder:** Where I specified sequential `IF vehicleType == 'bike' ... ELSE IF 'car'`, the AI implemented a static dictionary map (`vehicleMultipliers[vehicleType]`). This was an elegant $O(1)$ improvement that preserved identical behavior.
2. **Defensive Addition:** The AI added `isFinite(distanceKm)`, protecting against `Infinity` values that my original pseudocode had overlooked.
3. **Omission of Static Types:** Unless explicitly instructed to generate TypeScript interfaces, AI models gravitate toward generic `any` parameters with runtime type checks.

---

## 4. The Engineering Takeaway

In the age of generative AI, **writing code is cheap; understanding logic is expensive.**

If you cannot trace an algorithm step by step on a whiteboard with three boundary inputs before touching an IDE, you will never be able to catch the subtle race conditions, voucher dilution bugs, or off-by-one boundary errors that AI introduces into production codebases.

Pseudocode is not an academic chore. It is the most powerful prompt-engineering tool in existence, and the ultimate test of whether an engineer truly understands what they are shipping.

*Built for the Product Engineering Bootcamp (Task 5: Pseudocoding).*
