# Part C2: Side-by-Side Pseudocode Difference Classification Table

A rigorous line-by-line comparison of the **Original Specification Pseudocode (`Part B1`)** versus the **Reverse-Engineered Pseudocode from AI (`Part C2`)**.

---

## Difference Classification Table

| Component / Step | Original Pseudocode (`B1`) | Reverse-Engineered from AI (`C2`) | Difference Category | Engineering Verdict & Impact |
|---|---|---|---|---|
| **Input Type Annotation** | Explicitly typed parameters (`distanceKm: Number`, `subtotalKobo: Integer`) | Un-annotated parameters (`distanceKm: any`) relying on runtime type guards | **Omitted** | *Defect in strictness.* The AI omitted TypeScript static type annotations from the function signature, relying solely on runtime checks. Fixed by adding TypeScript type parameters. |
| **Vehicle Dispatch Lookup** | Sequential `IF/ELSE IF` evaluation for `"bike"`, `"car"`, `"van"` | Constant dictionary map object lookup (`vehicleMultipliers[vehicleType]`) | **Interpreted differently** | *Welcome optimization.* Mapping multipliers in a static dictionary is $O(1)$, cleaner, and more extensible than a chain of `if-else` branches. |
| **Vehicle Type Validation** | Explicit equality disjunction: `vehicleType !== "bike" AND !== "car" AND !== "van"` | Array inclusion check: `!["bike", "car", "van"].includes(vehicleType)` | **Interpreted differently** | *Welcome simplification.* More idiomatic in modern JavaScript/TypeScript while preserving exact semantics. |
| **Finite Number Check** | Checked `typeof distanceKm !== "number" \|\| isNaN(...)` | Added `isFinite(distanceKm)` check | **Added** | *Welcome addition.* Prevents `Infinity` or `-Infinity` from slipping through as valid distance numbers. |
| **Return Breakdown Object Shape** | Exact fields: `baseFeeKobo`, `distanceFeeKobo`, `vehicleMultiplier`, `surgeMultiplier` | Exact match | **Identical** | Zero drift in output envelope contract. |
| **Integer Rounding Points** | Rounded at distance fee and at final fee calculation | Rounded at distance fee and at final fee calculation | **Identical** | Precise floating-point precision alignment. |

---

## Summary of Findings
1. **Omitted:** The AI did not emit explicit TypeScript interface types unless prompted. (Fixed in TypeScript wrapper).
2. **Added:** The AI added `isFinite(distanceKm)`, which was not explicitly stated in the pseudocode but represents defensive programming against `Infinity`.
3. **Interpreted Differently:** The AI converted the branching `IF/ELSE` multiplier ladder into a static dictionary lookup. This was an elegant architectural interpretation that maintained exact behavioral equivalence.
