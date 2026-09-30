# Part A3: Planted Bug Analysis — What the Code SHOULD Do

## The Business Requirement:
*"Customers may apply a promotional percentage discount to eligible goods in their cart, followed by a fixed monetary gift voucher applied against the remaining balance. The percentage discount applies to the full catalog subtotal, not the post-voucher amount. A voucher cannot discount more than the remaining balance, and final total must never be negative."*

---

## 1. Pseudocode of What It SHOULD Do

```text
FUNCTION applyTieredDiscount_INTENDED
INPUTS:
  subtotalKobo: Integer representing initial cart amount in kobo
  percentageDiscount: Integer representing percentage discount (0 to 100)
  fixedVoucherKobo: Integer representing fixed cash voucher in kobo (>= 0)
OUTPUT:
  finalTotal: Integer in kobo after discounts
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - subtotalKobo <= 0 (returns 0)
  - percentageDiscount < 0 or > 100
  - fixedVoucherKobo < 0

1. IF subtotalKobo is less than or equal to zero
     RETURN 0
   END IF
2. COMPUTE percentageDeduction as integer division of (subtotalKobo multiplied by percentageDiscount) by 100
3. SUBTRACT percentageDeduction from subtotalKobo, yielding discountedSubtotal
4. SUBTRACT fixedVoucherKobo from discountedSubtotal, yielding remainingTotal
5. IF remainingTotal is strictly less than zero
     SET finalTotal to zero
   OTHERWISE
     SET finalTotal to remainingTotal
   END IF
6. RETURN finalTotal
```
