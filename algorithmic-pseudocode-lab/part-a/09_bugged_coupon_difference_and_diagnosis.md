# Part A3: Planted Bug Identification & Mathematical Diagnosis

## 1. The Bug Named: **Order of Operations Inversion & Voucher Value Dilution**

The planted bug is an **inversion of the discount application precedence**: the code applies the fixed cash voucher *before* calculating the percentage discount, rather than applying the percentage discount to the catalog subtotal first.

---

## 2. Step-by-Step Difference Analysis

| Execution Step | What the Bugged Code Does (`07_actual`) | What the Intended Code Does (`08_intended`) |
|---|---|---|
| Step 2 | Deducts `fixedVoucherKobo` from `subtotalKobo` first. | Computes percentage deduction on full `subtotalKobo`. |
| Step 3 | Applies `percentageDiscount` to the post-voucher remainder `(subtotal - voucher)`. | Deducts percentage discount from subtotal. |
| Step 4 | Multiplies diminished base by percentage. | Deducts full face value of fixed voucher from remainder. |

---

## 3. Mathematical Proof of Financial Loss

Let:
- `subtotalKobo` = 100,000 kobo (1,000 NGN)
- `percentageDiscount` = 20%
- `fixedVoucherKobo` = 50,000 kobo (500 NGN gift card)

### What the Bugged Code Produces:
1. `afterVoucher` = $100,000 - 50,000 = 50,000$ kobo.
2. `finalTotal` = $50,000 \times 0.80 = \mathbf{40,000\text{ kobo}}$ (400 NGN).
- *Effective Total Discount:* 60,000 kobo (600 NGN).
- *Notice:* The user's 50,000 kobo voucher only saved them 40,000 kobo because the 20% multiplier shrunk the voucher! The customer was **cheated out of 10,000 kobo (100 NGN)** of their voucher face value!

### What the Intended Business Logic Produces:
1. `percentageDeduction` = $100,000 \times 0.20 = 20,000$ kobo (200 NGN).
2. `discountedSubtotal` = $100,000 - 20,000 = 80,000$ kobo.
3. `finalTotal` = $80,000 - 50,000 = \mathbf{30,000\text{ kobo}}$ (300 NGN).
- *Effective Total Discount:* 70,000 kobo (700 NGN).
- Customer receives the full 20% catalog promotion AND the full 500 NGN face value of their purchased voucher.

---

## 4. The Corrected Implementation

```ts
export function applyTieredDiscount(
  subtotalKobo: number,
  percentageDiscount: number,
  fixedVoucherKobo: number
): number {
  if (subtotalKobo <= 0) return 0;
  
  // 1. Calculate percentage discount on full catalog subtotal
  const percentageDeduction = Math.round((subtotalKobo * Math.min(Math.max(percentageDiscount, 0), 100)) / 100);
  const discountedSubtotal = subtotalKobo - percentageDeduction;

  // 2. Subtract fixed voucher from remainder
  const remainingTotal = discountedSubtotal - Math.max(fixedVoucherKobo, 0);

  // 3. Guarantee non-negative floor
  return Math.max(0, remainingTotal);
}
```
