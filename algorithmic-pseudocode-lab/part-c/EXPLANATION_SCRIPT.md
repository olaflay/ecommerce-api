# Part C4: The Five-Minute Engineering Explanation Script

*Spoken walkthrough explaining the Dynamic Delivery Fee Calculation algorithm to a non-technical peer or engineering colleague, using only the pseudocode as notes without showing code on screen.*

---

## The Script (Estimated Delivery: 4 Minutes 30 Seconds)

### [00:00 - 00:45] 1. The Purpose & Inputs
"Hello! Today I'm walking you through how our system calculates the delivery fee for an e-commerce order. The business goal is simple: calculate a fair, transparent delivery cost based on how far the driver travels, the size of vehicle needed, and whether the order qualifies for free delivery.

To make this decision, the function takes four clear inputs:
First, the **distance** in kilometers from the store to the customer's doorstep.
Second, the **order subtotal** in kobo—meaning the total value of items in the cart.
Third, the **vehicle type** required—which is either a motorbike, a standard passenger car, or a cargo van.
And fourth, a simple true/false flag indicating whether the order is being dispatched during **peak rush hour** traffic."

---

### [00:45 - 01:30] 2. Guardrails & Early Exits (Sanity Checks)
"Before doing any math, the algorithm enforces three non-negotiable safety guardrails:
First, distance cannot be negative or infinite. If someone passes minus five kilometers, the system stops immediately and raises an invalid distance error.
Second, the cart subtotal cannot be negative or fractional.
And third, the vehicle type must be recognized. If a client asks for a 'helicopter' or 'scooter', we reject it upfront.

Next comes our first business decision: **Free Delivery**.
We want to reward our high-value customers without bankrupting our logistics fleet. So the rule is: if a customer spends thirty thousand Naira or more (which is three million kobo), **AND** they live within ten kilometers of the dispatch hub, delivery is completely free.
If both conditions are met, the algorithm immediately returns zero kobo and exits. We don't calculate surcharges or mileage; the customer gets free shipping."

---

### [01:30 - 02:45] 3. Core Pricing & Mileage Calculations
"Now, if the order doesn't qualify for free shipping, we calculate the standard fee in three steps:

Step one is the **base rate**. Every delivery starts with a flat flag-drop fee of five hundred Naira (fifty thousand kobo) to cover the driver's dispatch time.

Step two is the **mileage rate**. We charge one hundred and fifty Naira (fifteen thousand kobo) for every kilometer traveled. If a customer lives five kilometers away, five times fifteen thousand gives seventy-five thousand kobo. We add that to the base fee of fifty thousand, giving us a subtotal of one hundred and twenty-five thousand kobo.

Step three is the **vehicle surcharge**. Different parcels require different transport. A small envelope goes on a motorbike, so the multiplier is one point zero—no extra charge. A medium box needs a car trunk, which has a forty percent surcharge (multiplier one point four). And heavy bulk items like furniture need a cargo van, which doubles the base rate with a two point zero multiplier. We multiply our subtotal by this vehicle factor."

---

### [02:45 - 03:45] 4. Peak Hour Surge & Integer Rounding
"Finally, we account for traffic congestion.
If the order is dispatched during morning or evening peak rush hours—when drivers sit in heavy traffic—we apply a twenty-five percent surge multiplier (one point two five). Otherwise, the multiplier is just one point zero.

We multiply the vehicle-adjusted fee by the surge multiplier, round to the nearest whole integer to ensure we never have fractional kobo or floating-point cents, and pack the result into a clean summary response.

The response gives the checkout screen the final fee, a clear boolean stating whether delivery was free, and the transparent breakdown of the base fee, distance fee, vehicle factor, and surge factor."

---

### [03:45 - 04:30] 5. Summary & Edge Case Resilience
"To prove this logic holds, we tested it against extreme edges:
What happens if the customer lives exactly on the ten-kilometer boundary? If they live ten point zero kilometers away, they get free delivery. If they live ten point one kilometers away, the threshold breaks and they pay standard mileage.
What happens if the distance is zero kilometers—meaning the customer picked it up at the curbside? Mileage is zero, and they pay only the flat dispatch base rate.

Because the logic was mapped step-by-step in pseudocode before writing a single line of TypeScript, both my manual implementation and an AI-generated implementation arrived at the exact same output across ten out of ten adversarial test cases. Thank you!"
