# Part A2: Own Money Function — the server-side total computation in `createOrder`

**Source under analysis:** `task-1-consumable-api/src/services/order.service.ts`,
lines 74-92, inside `OrderService.createOrder`'s transaction callback.
**Executed evidence:** `../evidence/partA2_total_amount.log` (14/14 assertions,
real HTTP against a real Express app, real PostgreSQL, fixtures cleaned up).

---

> ## ⚠️ The function this file previously documented does not exist
>
> The previous version of this file documented `calculateOrderTotals`, a
> standalone function taking `items`, a `catalogPriceLookup`, a
> `taxRateBasisPoints` and a `discountKobo`, and returning `subtotalKobo`,
> `taxKobo`, `discountKobo` and `finalTotalKobo`.
>
> **None of that exists.** There is no `calculateOrderTotals` anywhere in
> `task-1-consumable-api`. There is no VAT. There is no discount. There is no
> basis-points helper and no negative-total clamp. The identifiers
> `taxRateBasisPoints` and `discountKobo` appear in no source file, and no test
> asserts a tax or a discount.
>
> Worse, the previous version's "Real Code Execution Result" lines — *"Returned
> Subtotal 500,000 kobo, Tax 37,500 kobo, Final 487,500 kobo"*, *"Returned final
> total 0 kobo (negative floor triggered)"*, *"Throws validation error"* — were
> **never executed against anything.** They were transcribed from the fiction in
> section 1 into the verification section as though they were observations. All
> three are withdrawn. Section 4 lists the retractions.
>
> This file now documents the computation that is real, which is a smaller and
> more interesting function than the one that was invented.

---

## 1. Pseudocode Specification (reconstructed from the real implementation)

The money logic is not a function. It is a labelled region of
`createOrder` that runs inside the transaction, after the product rows have been
locked, and before any stock is decremented. It is reproduced here as a
function-shaped pseudocode for readability, and that reshaping is stated
explicitly because it is a change in presentation, not in behaviour.

```text
FUNCTION computeOrderTotal        <- NOT EXPORTED. This is a naming convenience
                                   <- for the region at order.service.ts:74-92.
                                   <- It is not a function in the codebase.
INPUTS:
  mergedItems: Array of { productId: String, quantity: Integer >= 1 }
              Already merged: duplicate productIds summed (order.service.ts:46-53)
  productMap: Map from productId to the LOCKED product row
              { id, name, price, stockQuantity }, read inside the same
              transaction with SELECT ... FOR UPDATE (order.service.ts:63, 65)
OUTPUT:
  totalAmount: Integer kobo, the sum of price * quantity over mergedItems
  orderLines: Array of { productId, quantity, unitPrice }
SIDE EFFECTS:
  NONE. This region reads and multiplies. It writes nothing; the writes are the
  separate stock-decrement loop and the separate nested order.create.
FAILS WHEN:
  - a locked product has stockQuantity STRICTLY LESS THAN its merged quantity
      -> ConflictError -> HTTP 409                              (order.service.ts:80-83)
  - a merged productId has no entry in productMap
      -> NotFoundError, raised in the EARLIER loop at order.service.ts:68-72,
         so this function can never itself see a missing product
  (NOTE: a negative or zero quantity is NOT rejected here. It is rejected by the
   Zod request schema upstream. A caller reaching this region with quantity 0
   would multiply by 0 and add 0, not raise.)

1. SET totalAmount to 0                                    (order.service.ts:75)
2. SET orderLines to an empty list                          (order.service.ts:76)
3. FOR EACH item in mergedItems, in merged order
     READ product as productMap[item.productId]             (order.service.ts:79)
     IF product.stockQuantity is STRICTLY LESS THAN item.quantity
       RAISE ConflictError('Insufficient stock for product "<name>".
                           Requested: <q>, Available: <s>')  -> HTTP 409
     END IF                                                 (order.service.ts:80-84)
     ADD (product.price MULTIPLIED BY item.quantity) to totalAmount
                                                             (order.service.ts:86)
     APPEND { productId: product.id,
              quantity: item.quantity,
              unitPrice: product.price } to orderLines
       unitPrice is the price read from the LOCKED row, so the snapshot cannot
       be stale and cannot be supplied by the client.
                                                             (order.service.ts:87-91)
   END FOR
4. RETURN totalAmount and orderLines
   -> totalAmount is written to the Order row together with currency "NGN"
      (order.service.ts:109-110)
   -> orderLines is written as nested OrderItem rows by the SAME create call
      (order.service.ts:111-113)
```

### Arithmetic contract

This is the part that matters for a money function, and it is short:

| Property | Value | Why it is correct |
|---|---|---|
| Unit | kobo, the minor unit of NGN | `Order.currency` is `"NGN"` (`order.service.ts:110`) |
| Storage | `Order.totalAmount` is an integer column | verified by `Number.isInteger` against the stored row |
| Operation | one multiplication and one addition per line | `order.service.ts:86` |
| Rounding | **none, anywhere** | there is no `Math.round`, no division, and no division-by-10000 |
| Tax | **none** | no tax term exists in the accumulation |
| Discount | **none** | no discount term exists in the accumulation |
| Negative clamp | **none** | an empty `mergedItems` would yield `0`, and that is the only way to reach it |
| Client-supplied total | impossible | the request schema is strict, so a `totalAmount` field in the body is rejected with 422 before the service is reached |

**Why "no rounding" is the correct design here and not an oversight.** The
accumulation is integer × integer summed into an integer. `price` is an integer
kobo column and `quantity` is an integer validated by the schema, so the product
is exactly representable and the sum of such products is exact. A rounding step
would only introduce a place to be wrong. This is the direct contrast with
`part-a/08` and `part-a/09`, where a percentage discount is involved and rounding
is genuinely unavoidable — and where the original code got it wrong.

---

## 2. Hand-Trace Verification (3 Test Inputs)

Predictions are made from the pseudocode in section 1, then checked by real
execution. Every number below was read out of a real HTTP response or a real
database row; the captured output is `../evidence/partA2_total_amount.log`.

Fixtures for this trace: product **A** at `price = 200000` kobo (₦2,000),
product **B** at `price = 100000` kobo (₦1,000), product **OOS** at
`price = 50000` with `stockQuantity = 0`, one fresh customer, one fresh category.
All fixtures were deleted after the run.

### Input 1 (Two distinct products)
- **Request:** `{ customerId, items: [{ A, 2 }, { B, 1 }] }`
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| merge | two distinct productIds | no merge, `mergedItems = [{A,2},{B,1}]` |
| 1 | `totalAmount = 0` | 0 |
| 3, line A | lock check: `50 < 2` is false. `totalAmount += 200000 * 2` | `totalAmount = 400000` |
| 3, line B | lock check: `50 < 1` is false. `totalAmount += 100000 * 1` | `totalAmount = 500000` |
| 4 | Order written with `totalAmount = 500000`, `currency = "NGN"` | 2 OrderItem rows, `unitPrice` 200000 and 100000 |

- **Predicted `totalAmount = 500000`, 2 lines, `unitPrice` = catalog price for each.**
- **Real Code Execution Result:** `totalAmount returned: 500000`, HTTP 201,
  2 lines, and every `unitPrice` equal to its own catalog price.
  `partA2_total_amount.log`: *"Input 1 totalAmount = 200000*2 + 100000*1"* PASS.
  **Match: YES.**
- **No tax.** The old file predicted `taxKobo = 37500` for this input and a final
  total of `487500`. The real value is `500000`. The old prediction was not
  merely unexecuted, it was wrong by 12,500 kobo, because it invented a 7.5% VAT
  term that does not exist in this codebase.

### Input 2 (Out of stock aborts the total)
- **Request:** `{ customerId, items: [{ OOS, 1 }] }` where `OOS.stockQuantity = 0`
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| 1 | `totalAmount = 0`, `orderLines = []` | 0 |
| 3, line OOS | `0 < 1` is TRUE | raise ConflictError |
| — | throws out of the callback, so the transaction ROLLS BACK | no Order, no OrderItem, no decrement |
| 4 | never reached | `totalAmount` discarded |

- **Predicted HTTP 409 and no order row created.**
- **Real Code Execution Result:** HTTP 409, `error.code = "CONFLICT"`, and the
  order count for this customer stayed at 1 (only the Input 1 order existed).
  `partA2_total_amount.log`: *"Input 2 no order row created"* PASS.
  **Match: YES.**
- **This input is the reason the stock check is inside the accumulation loop
  rather than after it.** Accumulating `50000 * 1` before checking stock would
  leave a computed total that must then be thrown away, and any future refactor
  that moved the check later would risk persisting it. The old file modelled
  step 7 as clamping a negative total to zero, implying the total was computed
  first and sanitised afterwards. The real code checks before it computes.

### Input 3 (Duplicate productIds merge BEFORE multiplication)
- **Request:** `{ customerId, items: [{ A, 2 }, { A, 3 }] }`
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| merge, in `createOrder` before this function | `Map` sums `2 + 3` | `mergedItems = [{A,5}]` |
| 1 | `totalAmount = 0` | 0 |
| 3, single line | `50 < 5` is false. `totalAmount += 200000 * 5` | `totalAmount = 1000000` |
| 4 | Order written with `totalAmount = 1000000` | 1 OrderItem row, `quantity = 5` |

- **Predicted one line, merged quantity 5, `totalAmount = 1000000`.**
- **Real Code Execution Result:** `totalAmount returned: 1000000`, HTTP 201,
  1 line, `quantity = 5`, and a raw `SELECT "totalAmount" FROM "Order"` returned
  the integer `1000000` with `"currency" = "NGN"`.
  `partA2_total_amount.log`: *"Input 3 totalAmount = 200000 * 5"* PASS,
  *"totalAmount stored as an integer column"* PASS, *"currency column written as
  NGN"* PASS. **Match: YES.**
- **Why this is the load-bearing money trace.** Merge-before-multiply and
  multiply-before-merge give the same answer here, so this input alone does not
  distinguish them. What it does prove is that the accumulation happens **once
  per merged line**, and that the stored value is an integer kobo amount with an
  explicit currency. Had the merge happened after the total loop, the request
  would have produced two lines totalling the same 1,000,000 — the arithmetic
  would agree while the line count would not. The test asserts both.

---

## 3. What This Function Does Not Do

Recorded because the previous version of this file claimed all of it, and because
each absence is a question a reviewer will ask.

| Not present | Consequence | Recorded where |
|---|---|---|
| Tax / VAT | The API charges no tax. Any figure labelled "tax" elsewhere in this repository is fiction. | section 4 |
| Discount / coupon on order totals | No discount is applied at order creation. The only coupon logic in this repository is the deliberately buggy calculator in `part-a/07`-`09`, which is not wired into the API. | `part-a/09` |
| Negative-total clamp | Unreachable, because the only inputs are validated non-negative integers and at least one item is required. | section 1 |
| Rounding of any kind | Exact integer arithmetic only. | section 1 |
| Maximum order value | No cap. A large cart produces a large integer; the DB column type is the only limit. | not fixed, not in scope |

---

## 4. Retractions

Every claim below was made by the previous version of this file and is withdrawn.

| # | Withdrawn claim | Reality | Evidence |
|---|---|---|---|
| 1 | A function named `calculateOrderTotals` exists | No such function is exported anywhere in `task-1-consumable-api`. The money logic is the inline region at `order.service.ts:74-92`. | `order.service.ts:75, 86, 90` in `../evidence/citations.log` |
| 2 | A `taxRateBasisPoints` input exists, e.g. 750 for 7.5% VAT | No such identifier, and no tax is computed or stored. | grep of `task-1-consumable-api/src` finds no `taxRateBasisPoints` |
| 3 | A `discountKobo` input exists and is subtracted | No such identifier, and no discount is applied. | grep of `task-1-consumable-api/src` finds no `discountKobo` |
| 4 | "Returned Subtotal 500,000 kobo, Tax 37,500 kobo, Final 487,500 kobo. **Match: YES**" | **Never executed.** The function does not exist. The real execution of a comparable input returned `500000` with no tax term. | `../evidence/partA2_total_amount.log`, Input 1 |
| 5 | "Returned final total 0 kobo (negative floor triggered). **Match: YES**" | **Never executed**, and the negative floor does not exist in the code. | no clamping construct at `order.service.ts:74-92` |
| 6 | "Throws validation error: `Quantity must be positive integer`. **Match: YES**" | **Never executed.** The service has no quantity guard. The Zod schema rejects it upstream, with a different message, and the harness did not exercise this path. | `order.service.ts:78-92` has no quantity check |
| 7 | Step 5: "COMPUTE taxKobo as integer division of (subtotalKobo × taxRateBasisPoints) by 10000, rounding to nearest" | No division and no basis points anywhere in the computation. | `order.service.ts:86` is the only arithmetic statement |
| 8 | Step 7: "IF rawTotal is strictly less than zero, SET finalTotalKobo to zero" | No such clamp. | absent from `order.service.ts:74-92` |
| 9 | The file was headed "Part A1", duplicating the heading of the `createOrder` file | Renamed to Part A2 to match the brief. | this file, line 1 |

**The three "Match: YES" verdicts in the withdrawn rows 4-6 were the most
serious defect in this file**, because a reviewer checking only for the presence
of a verification table would have seen three green ticks and stopped. A
verification result is only evidence if something was executed. Rows 4-6 had
nothing behind them, and they are removed rather than re-labelled, because there
is no real execution that could stand in for them.
