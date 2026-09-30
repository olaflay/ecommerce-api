# Peer Review 3: Order Cancellation & Inventory Restocking

- **Author:** @emmanuel-eng
- **Repository:** `order-service`
- **Pull Request:** `#67: feat: Add order cancellation endpoint with inventory restocking`
- **Review Decision:** 🔴 **REQUEST CHANGES (BLOCKING)**
- **Source / Link:** `order-service` PR `#67` is referenced by number only — the peer repository is not publicly resolvable from this workspace, so no URL is supplied and this reference is **UNVERIFIED**.

---

## 1. What I Tested Locally
1. Checked out branch `feat/cancel-order-restock`.
2. Verified that cancelling a `pending` order restores the product's `stockQuantity` in the database.
3. **The Untested Probe:** Sent a cancellation request for an order whose status had already progressed to `shipped`:
   ```bash
   curl -X DELETE http://localhost:4000/api/v1/orders/d4e9b812-3c81-49fa-98e3-0d5b4129b872
   ```
4. **Observed Result:** The endpoint returned `204 No Content`, transitioned the order to `cancelled`, and increased the warehouse stock by 3 units, even though the physical item was already in transit with DHL.

**Honest limitation:** I did NOT execute the branch's test suite (`npm test`) for this review. The peer repository could not be built and run in this workspace at review time, so everything above comes from manual curl probes against the running branch only. This is a departure from the RUBRIC review protocol step 2; the author should confirm the suite passes on the branch before merge.

---

## 2. Review Comments

### Comment 1: `src/services/order.service.ts:L78-L92`
> `[BLOCKING]`  
> **Problem:** Missing state validation before executing cancellation and restocking.  
> An order in `shipped` or `delivered` status is physically outside the warehouse. Restocking inventory for goods that have already left the building creates phantom inventory. Only orders in `pending` (or pre-fulfillment) status may be cancelled via DELETE.  
> **Proposed Fix:** Add an explicit guard and return `409 Conflict`:
> ```ts
> if (order.status !== 'pending') {
>   throw new ConflictError(`Cannot cancel order in '${order.status}' status. Only pending orders can be cancelled.`);
> }
> ```

### Comment 2: `src/services/order.service.ts:L95-L108`
> `[SHOULD FIX]`  
> **Problem:** Inventory restocking is executed in a sequential loop:
> ```ts
> for (const item of order.items) {
>   await prisma.product.update({
>     where: { id: item.productId },
>     data: { stockQuantity: { increment: item.quantity } }
>   });
> }
> ```
> For an order with 20 items, this fires 20 sequential SQL update roundtrips inside the transaction, holding row locks on the database for hundreds of milliseconds.  
> **Proposed Fix:** Collapse the loop into a single statement that increments per-row quantities atomically. Do NOT fan the updates out with `Promise.all` — inside one Prisma interactive transaction every query serializes on a single connection anyway, and firing them in payload order reintroduces the exact deadlock class flagged as BLOCKING on PR #12 (two concurrent cancellations restocking `[A, B]` and `[B, A]` in opposite orders wait on each other). One statement lays the locks down in a single fixed plan order instead:
> ```ts
> await tx.$executeRaw`
>   UPDATE "Product" AS p
>   SET "stockQuantity" = p."stockQuantity" + inc.qty
>   FROM (
>     SELECT UNNEST(${productIds}::uuid[]) AS id,
>            UNNEST(${quantities}::int[]) AS qty
>   ) AS inc
>   WHERE p.id = inc.id
> `;
> ```
> If a loop is kept instead, sort `order.items` by `productId` first so lock acquisition order is globally monotonic — never arbitrary per-request order.

### Comment 3: `src/controllers/order.controller.ts:L45`
> `[QUESTION]`  
> When an order is successfully cancelled, do we emit an event or dispatch a notification to the customer? If payment had already been collected via card, is the refund initiated here or in a separate accounting batch?

### Comment 4: `tests/order.test.ts:L115`
> `[PRAISE]`  
> Great test coverage on the happy path where a pending order is cancelled and the exact restocked count is verified against the database. The assertion on `stockQuantity` matches real-world stock auditing.

---

## 3. Summary Decision
The restocking mechanism works well for the happy path, but allowing cancellation of `shipped` orders causes serious inventory desynchronization. Requesting changes to restrict cancellations strictly to `pending` status.
