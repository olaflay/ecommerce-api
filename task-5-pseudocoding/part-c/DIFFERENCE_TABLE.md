# Part C2: Side-by-Side Pseudocode Difference Classification Table

A line-by-line comparison of the **Original Specification Pseudocode
(`part-b/FEATURE_SPEC_PSEUDOCODE.md` section 2)** versus the **Pseudocode
Reverse-Engineered From The AI Output (`REVERSE_ENGINEERED_PSEUDOCODE.md`)**.

> **This table was wrong and has been corrected.** The previous version of this
> file contained two false claims. It asserted that the AI emitted
> `distanceKm: any` and omitted input validation, and it classified the
> `isFinite` guard as an unsolicited "Added" feature, which framed the AI as
> over-engineering. Both claims were false. The AI declares full TypeScript
> types and did validate its inputs; and the `isFinite` guard came from the
> specification's own step 1, which the previous version of this file did not
> quote. See section 5 for the full retraction.

---

## 1. Difference Classification Table

| # | Component / Step | Specification (`part-b` section 2) | Actual AI code (`delivery_fee_ai.ts`) | Difference Category | Engineering Verdict & Impact |
|---|---|---|---|---|---|
| 1 | Input type annotation | `distanceKm: Number`, `subtotalKobo: Integer` in the INPUTS block | `distanceKm: number, subtotalKobo: number, vehicleType: string, isPeakHour: boolean` (lines 14-17) | **Identical** | **The previous claim of an "Omitted" typing is RETRACTED.** The AI emitted the same static types the spec asked for. The only difference is `Integer` versus `number`, which is the correct TypeScript spelling for an integer-domain value and matches the manual implementation. The return type is inferred, not annotated. |
| 2 | Distance finiteness guard | Step 1: "IF distanceKm is less than 0 **or is not a finite number**" | `distanceKm < 0 \|\| typeof distanceKm !== "number" \|\| !isFinite(distanceKm)` (line 20) | **Identical to spec** | The AI implemented the spec step faithfully. It did not add this; the spec contains it. See section 2. |
| 3 | Subtotal integer guard | Step 1: "IF subtotalKobo is less than 0 or is not an integer" | `subtotalKobo < 0 \|\| !Number.isInteger(subtotalKobo)` (line 24) | **Identical** | Both use `Number.isInteger`, which also rejects `Infinity` and `NaN`. |
| 4 | Vehicle dispatch lookup | Sequential `IF/ELSE IF` ladder for `"bike"`, `"car"`, `"van"` | Constant dictionary map, `vehicleMultipliers[vehicleType]` (lines 53-58) | **Interpreted differently** | A data structure substituted for a branch ladder. Behaviour is identical because the spec's step 1 guard has already rejected every other key before step 5 is reached, so the lookup cannot return `undefined`. This is a readability trade, not a correctness gain, and the manual implementation is the more literal one. |
| 5 | Vehicle type validation | Explicit equality disjunction | `!["bike", "car", "van"].includes(vehicleType)` (line 28) | **Interpreted differently** | Semantically equivalent for string inputs. The spec's disjunction is the more explicit statement of intent, because it names the three allowed values at the point of rejection. |
| 6 | Return breakdown object shape | `baseFeeKobo`, `distanceFeeKobo`, `vehicleMultiplier`, `surgeMultiplier` | Same four fields, same names, same values (lines 70-79) | **Identical** | Zero drift in the output envelope. |
| 7 | Integer rounding points | Round at step 4 and at step 8 | `Math.round` at the same two points (lines 50, 67) | **Identical** | Both use the same rounding function at the same two points. |
| 8 | Step ordering | Validate, then free-delivery check, then compute | Same order | **Identical** | No reordering, so no change in which error a request with two invalid inputs receives. |
| 9 | Free-delivery short circuit | Step 2 returns immediately with a zeroed breakdown | Identical, including the `1.0` multipliers on a free delivery | **Identical** | Including the detail that a free delivery reports `vehicleMultiplier: 1.0` and `surgeMultiplier: 1.0` even though no multiplier was ever selected. Both implementations reproduce this, so it is a shared quirk of the specification, not a divergence. |

**Net difference count: 0 corrections to the AI, 2 structural interpretations,
7 identical.** The AI introduced no unsolicited features, omitted no required
validation, and changed no output. That is the finding, and it is the opposite
of what the previous version of this file claimed.

---

## 2. The `isFinite` guard: the manual implementation was the defective one

The previous version of this table classified `isFinite(distanceKm)` as an
**Added** feature and called it a "welcome addition", on the stated basis that
"the pseudocode did not explicitly state" a finiteness check. That basis was
wrong. The specification says it, twice, inconsistently:

- `FEATURE_SPEC_PSEUDOCODE.md` section 2, `FAILS WHEN`: *"distanceKm is
  negative or NaN"*
- `FEATURE_SPEC_PSEUDOCODE.md` section 2, step 1: *"IF distanceKm is less than
  0 **or is not a finite number**"*

| | Guard used | `Infinity` input | Result |
|---|---|---|---|
| Spec `FAILS WHEN` header | `isNaN(distanceKm)` | `isNaN(Infinity) === false`, so the guard passes | `Infinity` is a valid distance |
| Spec step 1 | `!Number.isFinite(distanceKm)` | rejects | correct |
| **Manual implementation, before fix** | `isNaN(distanceKm)` | `Infinity` passed validation | **returned `fee = Infinity`** |
| **AI implementation** | `!isFinite(distanceKm)` | rejected | correct |

**Verdict: the manual implementation deviated from the specification, and the
AI implementation followed it.** `part-b/delivery_fee_manual.ts` step 1a now
uses `Number.isFinite`, and the divergence is gone. This is not a case of the
AI adding scope; it is a case of one of two implementations reading an
internally contradictory specification, and the one that read the step happened
to be the one that read it correctly.

The root cause is ambiguity 1 in
`FEATURE_SPEC_PSEUDOCODE.md` section 4, where the fix is recorded with the
old-versus-new pseudocode.

---

## 3. Hostile-input probe results (`probe_divergence.ts`)

The 10-input comparative suite in `compare_implementations.ts` covers the
inputs the specification's own hand traces chose. It cannot find a guard
difference on inputs it never tries. `probe_divergence.ts` exists to try the
inputs a specification author is most likely to forget.

Executed output is in `../evidence/probe_divergence.log`.

| Hostile input | Manual (after fix) | AI | Agreement |
|---|---|---|---|
| `distanceKm = Infinity` | throws `Invalid distance (must be non-negative number)` | same | AGREE |
| `distanceKm = NaN` | throws the same error | same | AGREE |
| `distanceKm = -Infinity` | throws the same error | same | AGREE |
| `subtotalKobo = Infinity` | throws `Invalid subtotal (must be non-negative integer)` | same | AGREE |
| `0.0001 km, car, peak` | `fee = 87503` | `fee = 87503` | AGREE |
| `1e20 km, car, peak` | `fee = 2.625e+24` | `fee = 2.625e+24` | AGREE |
| `-0 km, bike` | `fee = 50000` | `fee = 50000` | AGREE |

**7/7 agree after the fix. Before the fix, row 1 was a live divergence**:
the manual implementation returned `fee = Infinity` while the AI threw.

**One agreement in this table is luck, and is labelled as such in the probe.**
At `0.0001 km`, `0.0001 * 15000 === 1.5` exactly, which is a genuine half-way
tie at step 4. Under the two readings of the rounding ambiguity in
`FEATURE_SPEC_PSEUDOCODE.md` section 4, this input *should* diverge — rounding
at step 4 gives `(50000 + 2) * 1.4 * 1.25`, deferring gives
`(50000 + 1.5) * 1.4 * 1.25`. In IEEE-754 doubles the first evaluates to
`87503.49999999999` and the second to `87502.62499999999`, so both round to
`87503`. The implementations agree because of where the floating-point error
happened to fall, not because the specification was unambiguous.

**One finding the probe produced that is NOT a divergence.** Row 6 is a shared
defect. At `distanceKm = 1e20`, both implementations return `2.625e+24`, which
is not an integer and not a safe integer. The specification promises an
`Integer` in kobo, and neither implementation honours that promise for absurd
inputs, because `Number.isFinite(1e20)` is `true` and the step 1 guard
therefore admits it. **Both implementations are equally wrong here.** It is
recorded rather than fixed, because closing it would require a maximum
plausible distance in the specification, which is a product decision, not an
audit fix. A suggested guard is in section 6.

**Scope of the rounding ambiguity, measured.** An exhaustive sweep of
`distanceKm` from 0.01 to 200.00 in 0.01 km steps, peak hour, under both
readings of step 4, finds **133 distances at which the two readings return
different kobo amounts. All 133 are `car`; `van` never diverges at any distance
in the range**, because its `2.0` multiplier scales both readings by the same
power of two and leaves the half-way position unchanged. The first divergent
distance is 64.07 km, the last is 136.45 km. This is the number that makes
ambiguity 2 a real defect rather than a stylistic complaint: it changes a
customer's charge by 1 kobo on 133 ordinary distances.

---

## 4. What the 10-input suite does and does not prove

`compare_implementations.ts` reports `10/10 test inputs in agreement`. That
number is now computed from the observed results rather than hard-coded — the
previous version of the script printed the literal string "10/10 ... 100%" no
matter what happened, and exited 0 regardless — but the scope of the claim is
still 10 inputs. It is not a proof of general equivalence, and the hostile-input
probe exists precisely because the two implementations did differ on an input
the suite never contained.

---

## 5. Retraction of the previous version of this table

| Previous claim | Status | Reality |
|---|---|---|
| "The AI emitted `distanceKm: any` relying on runtime type guards" | **FALSE** | `delivery_fee_ai.ts` lines 5-8 declare `distanceKm: number, subtotalKobo: number, vehicleType: string, isPeakHour: boolean`. |
| "Omitted TypeScript static type annotations ... fixed by adding TypeScript type parameters" | **FALSE** | The types were present from the start. The claim was never checked against the file. |
| "Finite Number Check ... **Added** ... not explicitly stated in the pseudocode" | **FALSE** | It is stated in step 1: "is not a finite number". The AI followed the spec. |
| "`isFinite` was a welcome defensive addition" | **MISATTRIBUTED** | The manual implementation lacked it and returned `Infinity`. The AI was right. |
| Vehicle lookup and validation differences labelled "Welcome optimization" / "Welcome simplification" | **ARGUABLE, NOT DEFECTS** | Behaviourally equivalent. Retained in section 1 as "Interpreted differently", and explicitly *not* counted as an ambiguity fix, which is what the previous version's summary implied. |

The previous version also asserted an ambiguity fix that did not exist: it
labelled the two vehicle rows "Welcome optimization" and "Welcome
simplification", and its only other "fix" was prose about a type change. The
genuine ambiguity, with rewritten pseudocode and old-versus-new comparison, is
ambiguity 1 in `FEATURE_SPEC_PSEUDOCODE.md` section 4.

---

## 6. Open items, not yet fixed

1. **No maximum plausible distance.** `1e20` km is admitted by both
   implementations and produces a non-integer kobo fee. A `distanceKm` upper
   bound in the specification, with a corresponding guard, would close this.
   Not applied unilaterally: it is a product decision, and the bootcamp forbids
   silently inventing requirements.
2. **`currency` is not modelled.** Neither implementation carries a currency
   field. The delivery fee is implicitly NGN because kobo is an NGN minor unit,
   but the specification never says so. Recorded, not fixed.
