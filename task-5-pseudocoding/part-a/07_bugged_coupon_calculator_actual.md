# Part A3: Planted Bug Analysis — What the Code Actually Does

## The Code Under Review:
```ts
function applyTieredDiscount(subtotalKobo: number, percentageDiscount: number, fixedVoucherKobo: number): number {
  if (subtotalKobo <= 0) return 0;
  const afterVoucher = subtotalKobo - fixedVoucherKobo;
  const discountMultiplier = (100 - percentageDiscount) / 100;
  const finalTotal = afterVoucher * discountMultiplier;
  return Math.max(0, Math.round(finalTotal));
}
```

---

## 1. Pseudocode of What It ACTUALLY Does

```text
FUNCTION applyTieredDiscount_ACTUAL
INPUTS:
  subtotalKobo: Number representing initial cart amount in kobo
  percentageDiscount: Number representing percentage discount (e.g. 20 for 20%)
  fixedVoucherKobo: Number representing fixed cash discount in kobo (e.g. 50000 kobo)
OUTPUT:
  finalTotal: Number in kobo after discounts
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - subtotalKobo is zero or negative (returns 0)

1. IF subtotalKobo is less than or equal to zero
     RETURN 0
   END IF
2. SUBTRACT fixedVoucherKobo from subtotalKobo, yielding afterVoucher
3. CALCULATE discountMultiplier as (100 minus percentageDiscount) divided by 100
4. MULTIPLY afterVoucher by discountMultiplier, yielding finalTotal
5. IF finalTotal is less than 0
     RETURN 0
   OTHERWISE
     RETURN rounded finalTotal
   END IF
```
