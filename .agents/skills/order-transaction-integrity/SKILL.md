---
name: order-transaction-integrity
description: Transaction safety, row locking, stock integrity, state machine transitions, and kobo money handling.
---

# order-transaction-integrity

**Load during:** Phase 4, reviewed again in Phase 5 by Security
**Trigger:** any code touching `Order`, `OrderItem`, `Product.stockQuantity`, or money

- `totalAmount` is **always server-computed** from line items at the product's *current* price at order-creation time. Never accept or trust a client-supplied total.
- `OrderItem.unitPrice` is a **snapshot** taken at order creation and never recalculated later, even if the product's price changes afterward.
- Stock check-and-decrement happens inside one DB transaction with a row-level lock (`SELECT ... FOR UPDATE` or Prisma interactive transaction with an in-transaction re-read). Two simultaneous requests for the last unit must never both succeed — the loser gets `409`, not a negative stock value.
- Empty `items` array on order creation → `422`, not a silently-accepted zero-value order.
- Duplicate `productId` within one order's `items` → merge quantities into one line item (per the PRD's documented decision) — don't silently create two rows for the same product.
- Insufficient stock → `409 Conflict`, not `422` — this is a business-state conflict, not a malformed request. Name the product and available quantity in the message.
- Status transitions follow the state machine exactly: `pending→{paid,cancelled}`, `paid→{shipped,cancelled}`, `shipped→delivered`, `delivered`/`cancelled` terminal. Any other transition → `409`.
- PATCH-ing an order to its current status is a no-op success (`200`), not an error.
- `DELETE` only succeeds while `status === "pending"`; any other status → `409`. A successful delete **restocks** the associated OrderItem quantities before cascading the delete — don't leave inventory permanently decremented for a deleted order.
- Money fields are integers in minor units (kobo) everywhere — schema, business logic, and API responses. Never introduce a float/decimal anywhere in this path.
