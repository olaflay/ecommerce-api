# Part A1: Own Complex Function — `createOrder`

**Source under analysis:** `task-1-consumable-api/src/services/order.service.ts`,
`OrderService.createOrder`, lines 36-140.
**Executed evidence:** `../evidence/partA1_create_order.log` (25/25 assertions,
real HTTP against a real Express app, real PostgreSQL).

> **This file was substantially false and has been rewritten from the source.**
> The previous version described a function that does not exist. It claimed the
> customer lookup happens *inside* the transaction (it happens *before* it),
> that product IDs are *sorted* to guarantee deadlock-free locking (there is no
> sort anywhere in the function), that the product rows are locked one at a time
> in a loop (they are locked by a single batched `SELECT ... FOR UPDATE`),
> and it referenced schema fields named `priceKobo`, `priceTimesKobo`,
> `unitPriceSnapshot` and `subtotalSnapshot` — **none of which exist in the
> database schema.** Section 4 lists every correction with the line of real code
> that refutes the old claim.

---

## 1. Pseudocode Specification (reconstructed from the real implementation)

```text
FUNCTION createOrder(input)
INPUTS:
  customerId: String, UUID format
  items: Array of objects, each { productId: UUID String, quantity: Integer >= 1 }
OUTPUT:
  createdOrder: Order row, status "pending", with customer and items.product included
SIDE EFFECTS:
  - UPDATES Product.stockQuantity (decrement, one UPDATE per merged item)
  - WRITES 1 Order row
  - WRITES N OrderItem rows via a single NESTED write on Order.create
  - ACQUIRES row locks on the referenced Product rows
FAILS WHEN:
  - customerId does not match an existing Customer row  -> 404 NOT_FOUND
        "Customer not found"                                     (line 42)
  - a merged productId does not match an existing Product row -> 404 NOT_FOUND
        "Product not found: <productId>"                         (line 70)
  - a locked product has stockQuantity STRICTLY LESS than the requested merged
    quantity -> 409 CONFLICT
        'Insufficient stock for product "<name>". Requested: <q>, Available: <s>'
                                                                     (line 82)
  - the transaction cannot be committed, or exceeds maxWait 10000 ms / timeout
    20000 ms                                                     (line 137)

1. LOOK UP the Customer row by customerId.
   NOTE: this is a plain prisma.customer.findUnique, executed BEFORE the
   transaction is opened. It is not part of the transaction and is not locked.
                                                                 (lines 38-40)
2. IF no customer was found
     RAISE NotFoundError("Customer not found")           -> HTTP 404
   END IF                                                        (lines 41-43)
3. MERGE duplicate productIds in items, SUMMING their quantities, preserving
   FIRST-OCCURRENCE order of first appearance (a Map keyed by productId).
                                                                 (lines 46-53)
4. EXTRACT productIds from the merged items IN THAT SAME ORDER.
   DO NOT SORT. There is no sort in this function, and therefore no
   "deadlock-free lock ordering" guarantee.                   (line 55)
5. OPEN an interactive transaction, configured with
     maxWait 10000 ms (time allowed to acquire the connection from the pool)
     timeout 20000 ms (time allowed for the whole callback)
                                                                 (lines 58, 137)
6. INSIDE the transaction, ACQUIRE ROW LOCKS ON EVERY REFERENCED PRODUCT IN ONE
   STATEMENT: a raw SELECT of id, name, price and stockQuantity for all productIds,
   with FOR UPDATE. This is ONE batched locking read, not a per-product loop.
                                                                 (line 63)
7. INDEX the locked rows into a map from productId to product.
                                                                 (line 65)
8. FOR EACH merged item, in merged order
     IF the map has no entry for this productId
       RAISE NotFoundError("Product not found: <productId>") -> HTTP 404
     END IF                                                     (lines 68-72)
   END FOR
9. SET totalAmount to 0 and orderLines to an empty list          (lines 75-76)
10. FOR EACH merged item, in merged order
      READ the locked product
      IF product.stockQuantity is STRICTLY LESS THAN item.quantity
        RAISE ConflictError('Insufficient stock for product "<name>". Requested: <q>,
        Available: <s>')                                   -> HTTP 409
      END IF                                                    (lines 80-84)
      ADD (product.price multiplied by item.quantity) to totalAmount
                                                               (line 86)
      APPEND to orderLines: { productId, quantity, unitPrice: product.price }
        unitPrice is the SNAPSHOT of the catalog price at order-creation time.
        There is no separate subtotal column; the line subtotal is recomputed
        from unitPrice and quantity by any consumer that needs it.
                                                             (lines 87-91)
    END FOR
11. FOR EACH merged item, in merged order
      DECREMENT Product.stockQuantity by item.quantity with an atomic
      `{ decrement: <quantity> }` update                          (lines 95-102)
    END FOR
12. CREATE the Order row, with the line items NESTED IN THE SAME WRITE:
      customerId = customer.id
      status = "pending"
      totalAmount = totalAmount
      currency = "NGN"
      items = orderLines, created as OrderItem rows by the nested create
                                                                 (lines 105-114)
13. RETURN the created order, including the joined customer and, for every item,
    the joined product.                                          (lines 115-135)
14. COMMIT. The transaction is released when the callback returns without throwing.
```

### What the old pseudocode got structurally wrong

The old version's step list had **five** invented elements and **two**
misplaced ones. Each is listed in section 4 with the real line that refutes it.

One of them deserves a note here rather than only in the corrections table,
because it is a genuine latent issue in the real code, not a documentation
error: **step 4 does not sort.** The `Map` in step 3 preserves first-occurrence
order, so two concurrent requests that list the same two products in opposite
orders will ask for `ANY('{B,A}')` and `ANY('{A,B}')`. PostgreSQL does not
guarantee row-lock acquisition order for an `= ANY(...)` predicate, so the two
transactions can still take the same two row locks in opposite orders. The
original author appears to have believed a sort existed, because the old
pseudocode asserted one. It does not, and no deadlock test covers it. Recorded
in section 4 as an open item; not fixed here, because adding a sort changes
locking behaviour and is a change to someone else's production service.

---

## 2. Hand-Trace Verification (4 Test Inputs)

Each trace below is a prediction made from the pseudocode in section 1, then
checked against real execution. Citations are to
`task-1-consumable-api/tests/orders.test.ts`, and every cited line is
machine-verified by `../evidence/harness/verify_citations.ts`
(`../evidence/citations.log`).

### Input 1 (Happy path, one line item)
- **Request:** `{ customerId: <seeded customer>, items: [{ productId: <P1>, quantity: 2 }] }`
- P1 is chosen by the test at lines 14-18 as a product with `stockQuantity > 10`.
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| 1-2 | `findUnique` returns a customer | proceed, no lock taken |
| 3-4 | one distinct productId, so the merge is a no-op; `productIds = [P1]` | unchanged |
| 5 | interactive transaction opens, `maxWait 10000`, `timeout 20000` | tx active |
| 6 | one `SELECT ... FOR UPDATE` returns P1's `id, name, price, stockQuantity` | P1 locked |
| 8 | `productMap.has(P1)` is true | proceed |
| 10 | `stockQuantity > 10` is at least 11, so the `< 2` test is false | no error |
| 10 | `totalAmount = price * 2`; `orderLines = [{ P1, 2, unitPrice: price }]` | total = 2× price |
| 11 | `stockQuantity` decremented by 2 | stock − 2 |
| 12 | Order written `pending`, `currency: "NGN"`, nested item write | 1 Order + 1 OrderItem |
| 13-14 | commit, return order | **HTTP 201** |

- **Real Code Execution Result:** `tests/orders.test.ts:47` asserts
  `res.status === 201`; `:49` asserts `status === "pending"`; `:50` asserts
  `totalAmount === inStockProduct1.price * 2`; `:52` asserts
  `items[0].unitPrice === inStockProduct1.price`; `:58` asserts the database
  stock is `initialStock - 2`. **Match: YES.** The unitPrice assertion at line 52
  is the direct check that the price snapshot is the catalog `price`, not a
  `priceKobo` or `unitPriceSnapshot` field the old pseudocode invented.
- **Predicted HTTP 201, predicted total `price * 2`, predicted stock `initial - 2`.
  All three confirmed.**

### Input 2 (Duplicate productIds are merged)
- **Request:** `{ customerId: <customer>, items: [{ P2, 1 }, { P2, 2 }] }`
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| 3 | `Map` sees P2 → sets 1, then P2 again → `1 + 2 = 3` | `mergedItems = [{ P2, 3 }]` |
| 4 | `productIds = [P2]`, length 1 | one lock, not two |
| 6 | one `SELECT ... FOR UPDATE` for a single-element array | P2 locked once |
| 8 | map has P2 | proceed |
| 10 | one loop iteration, `quantity = 3`, not two | stock checked against 3, not against 1 and 2 separately |
| 10 | `totalAmount = price * 3`; one line with `quantity: 3` | total = 3× price |
| 11 | **one** decrement of 3, not two decrements of 1 and 2 | stock − 3 |
| 12 | nested create writes **one** OrderItem row | 1 OrderItem |

- **Real Code Execution Result:** `tests/orders.test.ts:77` asserts
  `items.length === 1`; `:78` asserts `items[0].quantity === 3`; `:79` asserts
  `totalAmount === price * 3`; `:84` asserts stock is `initialStock - 3`.
  **Match: YES.**
- **This trace is the load-bearing one.** The old pseudocode's step 4 said
  "merge duplicate productIds, summing quantities", which was correct, but its
  step 7 looped over *unique* IDs while its step 10 looped over *merged* items,
  and step 12 looped writing OrderItems. Under the old pseudocode, this request
  would have written two OrderItem rows. The real code writes one, and the test
  at line 77 proves it. The old pseudocode's step 12 was not merely verbose; it
  predicted the wrong number of rows.

### Input 3 (Insufficient stock)
- **Request:** `{ customerId: <customer>, items: [{ P_out, 1 }] }` where
  `P_out` is the seeded product with `stockQuantity === 0` (test lines 19-22).
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| 1-5 | customer found, merge is a no-op, transaction opens | tx active |
| 6 | `SELECT ... FOR UPDATE` returns P_out with `stockQuantity = 0` | P_out locked |
| 8 | map has P_out, so existence passes | proceed |
| 10 | `0 < 1` is TRUE | raise ConflictError |
| — | error propagates out of the callback, so the transaction ROLLS BACK | no writes |
| 13 | never reached; no Order, no OrderItem, no stock change | rollback |

- **Real Code Execution Result:** `tests/orders.test.ts:136` asserts
  `res.status === 409`; `:137` asserts `error.code === "CONFLICT"`; `:138`
  asserts the message contains `"Insufficient stock"`. **Match: YES.**
- **The old pseudocode's quoted message, `Insufficient stock for product`, was a
  truncation.** The real message at `order.service.ts:82` is
  `Insufficient stock for product "<name>". Requested: <q>, Available: <s>`,
  which embeds the product name and both quantities. `tests/orders.test.ts:138`
  uses `toContain("Insufficient stock")` rather than equality, so the test passes
  against either string; the message was wrong in the doc, not in the code.

### Input 4 (Unknown customer)
- **Request:** `{ customerId: "00000000-0000-0000-0000-000000000000", items: [{ P1, 1 }] }`
- **Hand trace:**

| Step | State | Outcome |
|---|---|---|
| 1 | `findUnique` returns `null` for the all-zero UUID | not found |
| 2 | raise `NotFoundError("Customer not found")` | **HTTP 404** |
| 3-14 | never reached | **no transaction is ever opened** |

- **Real Code Execution Result:** `tests/orders.test.ts:114` asserts
  `res.status === 404`; `:115` asserts `error.code === "NOT_FOUND"`. **Match: YES.**
- **The old pseudocode predicted a transaction was started and then rolled back
  for this input. The real code never opens one**, because the customer lookup
  at `order.service.ts:38` precedes `prisma.$transaction` at line 58. Verified by
  citation: lines 38 and 58 both appear in `../evidence/citations.log`.

---

## 3. Concurrency and Integrity Notes

| Property | Real behaviour | Evidence |
|---|---|---|
| Lost-update prevention | `FOR UPDATE` row locks serialise competing check-then-decrement cycles | `order.service.ts:63` |
| Batched lock, single statement | one `SELECT ... FOR UPDATE` for all products | `order.service.ts:63` |
| Atomic decrement | Prisma `{ decrement: n }`, not read-modify-write in JS | `order.service.ts:99` |
| Server-computed total | total is summed in the service from locked `price` values; the client never supplies a total | `order.service.ts:86` |
| Price snapshot | `unitPrice` captured inside the same locked read, so it cannot be a stale client value | `order.service.ts:90` |
| All-or-nothing | any throw inside the callback rolls back the Order, the OrderItems and every decrement | callback at `order.service.ts:59-136` |
| Lock ordering | **NONE. No sort exists.** See section 4, open item 1. | `order.service.ts:55` |

**Not verified here:** the claim that two simultaneous requests for the last unit
of a product produce exactly one success. That requires a concurrency test, and
this task's scope is the Part A function documentation. The row-lock mechanism
that makes it work is cited above; the test itself is not in this repository.

---

## 4. Corrections to the previous version of this file

| # | Old claim | Reality | Real line |
|---|---|---|---|
| 1 | "LOOK UP customer by customerId **within transaction**" | The lookup is a plain `prisma.customer.findUnique` executed **before** the transaction opens. An unknown customer never opens a transaction. | `order.service.ts:38` vs `:58` |
| 2 | "SORT unique productIds in ascending alphabetical order to guarantee deadlock-free lock acquisition" | **No sort exists.** `mergedItems.map(i => i.productId)` preserves `Map` first-occurrence order. The deadlock-free guarantee the old file claimed does not exist. | `order.service.ts:55` |
| 3 | "FOR EACH productId ... CALL database to select product with FOR UPDATE" (a per-product lock loop) | **One** batched `SELECT ... WHERE id = ANY(...) FOR UPDATE` locks every product in a single statement. | `order.service.ts:63` |
| 4 | "COMPUTE itemSubtotal as product.priceTimesQuantity (product.priceTimesKobo * item.quantity)" | Neither `priceTimesKobo` nor `priceKobo` exists. The expression is `product.price * item.quantity`. | `order.service.ts:86` |
| 5 | "unitPriceSnapshot = product.priceKobo" and "subtotalSnapshot = itemSubtotal" | The schema has one price column on OrderItem, named `unitPrice`, and **no subtotal column**. | `order.service.ts:90` |
| 6 | The old file never wrote the `currency` field | The Order row is created with `currency: "NGN"`. | `order.service.ts:110` |
| 7 | "FOR EACH lineItem in orderItemsToCreate: WRITE OrderItem record" as a separate step 12 | The items are written by a **nested create** on the same `order.create` call, so the Order and its OrderItems are a single statement. | `order.service.ts:111-113` |
| 8 | Old step 10 interleaved total computation and stock decrement in one loop | The real code has **two** loops: validate-and-compute (78-92), then decrement (95-102). The old ordering implied a decrement could happen before a later item's stock check failed. | `order.service.ts:78-102` |
| 9 | Cited `tests/orders.test.ts:14` for the 201 assertion | Line 14 is inside `beforeAll`, a `findMany` setup call with no assertion. The 201 assertion is at line 47. | `tests/orders.test.ts:47` |
| 10 | Cited `tests/orders.test.ts:82` for the 409 assertion | Line 82 is a `prisma.product.findUnique` inside the duplicate-merge test. The 409 assertion is at line 136. | `tests/orders.test.ts:136` |
| 11 | Cited `tests/orders.test.ts:56` for the 404 assertion | Line 56 is a `prisma.product.findUnique` in the happy-path test. The 404 assertion is at line 114. | `tests/orders.test.ts:114` |
| 12 | Message `Insufficient stock for product` | `Insufficient stock for product "<name>". Requested: <q>, Available: <s>` | `order.service.ts:82` |
| 13 | `FAILS WHEN: items array is empty or contains non-positive quantities` | The **service** has no such check. It is enforced upstream by the Zod request schema, so a caller bypassing HTTP would not get this error from `createOrder`. | route schema, not `order.service.ts` |

### Open items, not fixed

1. **No lock ordering.** Noted in section 3. Two concurrent multi-product orders
   with reversed product order can, in principle, take the same two row locks in
   opposite orders. Not fixed: it is a behaviour change to a production service
   outside this task's scope.
2. **Existence check is a `Map` lookup after a batched read, not a per-row
   read.** Correct as written, but it means a `Product` deleted between the
   `FOR UPDATE` and the map construction cannot be observed, because the lock
   prevents concurrent deletion of the locked rows. No action needed; recorded
   so a future reader does not "fix" it.
