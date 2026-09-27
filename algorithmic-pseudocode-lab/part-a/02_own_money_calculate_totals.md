# Part A1: Own Money Function — `calculateOrderTotals`

## 1. Pseudocode Specification

```text
FUNCTION calculateOrderTotals
INPUTS:
  items: Array of objects with productId (String) and quantity (Integer)
  catalogPriceLookup: Map of productId to priceMinor (Integer kobo)
  taxRateBasisPoints: Integer (e.g. 750 for 7.5% VAT)
  discountKobo: Integer (e.g. coupon discount in kobo >= 0)
OUTPUT:
  calculation: Object with subtotalKobo (Integer), taxKobo (Integer), discountKobo (Integer), finalTotalKobo (Integer)
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - Any item quantity is strictly less than 1
  - Any product price in catalogPriceLookup is missing, negative, or not an integer
  - taxRateBasisPoints is negative
  - discountKobo is negative

1. VALIDATE that taxRateBasisPoints is greater than or equal to zero
   IF NOT
     RETURN error: Invalid tax rate
   END IF
2. VALIDATE that discountKobo is greater than or equal to zero
   IF NOT
     RETURN error: Invalid discount amount
   END IF
3. INITIALIZE subtotalKobo to zero
4. FOR EACH item in items
     IF item.quantity is less than 1
       RETURN error: Quantity must be positive integer
     END IF
     LOOK UP unitPriceKobo in catalogPriceLookup using item.productId
     IF unitPriceKobo is missing or less than zero
       RETURN error: Invalid catalog price for product
     END IF
     COMPUTE lineItemTotal as unitPriceKobo multiplied by item.quantity
     ADD lineItemTotal to subtotalKobo
   END FOR
5. COMPUTE taxKobo as integer division of (subtotalKobo multiplied by taxRateBasisPoints) by 10000, rounding to nearest integer
6. COMPUTE rawTotal as subtotalKobo plus taxKobo minus discountKobo
7. IF rawTotal is strictly less than zero
     SET finalTotalKobo to zero (prevent negative totals)
   OTHERWISE
     SET finalTotalKobo to rawTotal
   END IF
8. RETURN calculation object containing subtotalKobo, taxKobo, discountKobo, finalTotalKobo
```

---

## 2. Hand-Trace Verification (3 Test Inputs)

### Input 1 (Normal Case):
- `items`: 2 items (Item A: price 200,000 kobo, qty 2; Item B: price 100,000 kobo, qty 1)
- `taxRateBasisPoints`: 750 (7.5% VAT)
- `discountKobo`: 50,000 kobo (500 NGN voucher)
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 1–3 | Subtotal = 0. Tax rate = 750, discount = 50,000. | Valid inputs |
  | 4 | Line 1: $2 \times 200,000 = 400,000$. Line 2: $1 \times 100,000 = 100,000$. Subtotal = 500,000 kobo. | Subtotal = 500,000 |
  | 5 | Tax: $\text{round}((500,000 \times 750) / 10,000) = \text{round}(37,500) = 37,500$ kobo. | Tax = 37,500 |
  | 6–7 | Raw total: $500,000 + 37,500 - 50,000 = 487,500$ kobo (> 0). | Final = 487,500 |
  | 8 | Return totals. | **Subtotal: 500,000, Tax: 37,500, Final: 487,500 kobo** |
- **Real Code Execution Result:** Returned Subtotal 500,000 kobo, Tax 37,500 kobo, Final 487,500 kobo. **Match: YES**.

### Input 2 (Edge Case: Discount Exceeds Subtotal + Tax):
- `items`: 1 item (price 50,000 kobo, qty 1). Tax: 0.
- `discountKobo`: 200,000 kobo (voucher exceeds cart value).
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 4 | Subtotal = 50,000 kobo. | Subtotal = 50,000 |
  | 5 | Tax = 0. | Tax = 0 |
  | 6 | Raw total: $50,000 - 200,000 = -150,000$ kobo. | Negative total |
  | 7 | Clamped: $-150,000 < 0 \implies \text{finalTotalKobo} = 0$. | Final = 0 kobo |
  | 8 | Return totals. | **Final: 0 kobo** |
- **Real Code Execution Result:** Returned final total 0 kobo (negative floor triggered). **Match: YES**.

### Input 3 (Invalid Case: Negative Quantity):
- `items`: `[{ productId: "P1", quantity: -3 }]`
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 4 | Item quantity (-3) < 1. | Early exit |
  | 4 | Return error: Quantity must be positive integer. | **Error: Invalid Quantity** |
- **Real Code Execution Result:** Throws validation error: `Quantity must be positive integer`. **Match: YES**.
