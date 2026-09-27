# Part A1: Own Complex Function — `createOrder`

## 1. Pseudocode Specification

```text
FUNCTION createOrder
INPUTS:
  customerId: String, UUID format, identifying the customer placing the order
  items: Array of objects, each containing productId (UUID String) and quantity (Integer >= 1)
OUTPUT:
  createdOrder: Object containing order id, customerId, status ("pending"), totalAmount (Integer kobo), items list, and timestamps
SIDE EFFECTS:
  - WRITES 1 row to Order table
  - WRITES N rows to OrderItem table
  - UPDATES Product table rows (decrements stockQuantity)
  - ACQUIRES database row locks on Product rows
FAILS WHEN:
  - customerId is missing or does not match an existing Customer record
  - items array is empty or contains non-positive quantities
  - Any productId does not exist in Product table
  - Any requested product has stockQuantity strictly less than requested quantity
  - Database transaction fails or times out

1. START a database transaction
2. LOOK UP customer by customerId within transaction
3. IF customer does not exist
     ABORT transaction
     RETURN error: Customer not found (HTTP 404)
   END IF
4. MERGE items array by productId, summing quantities for duplicate products
5. EXTRACT all unique productIds from merged items
6. SORT unique productIds in ascending alphabetical order to guarantee deadlock-free lock acquisition
7. FOR EACH productId in sorted unique productIds
     ACQUIRE an exclusive row lock and read product record:
     CALL database to select product with FOR UPDATE
     IF product does not exist
       ABORT transaction
       RETURN error: Product not found (HTTP 404)
     END IF
     IF product stockQuantity is strictly less than requested quantity
       ABORT transaction
       RETURN error: Insufficient stock for product (HTTP 409)
     END IF
   END FOR
8. INITIALIZE totalAmount to zero
9. INITIALIZE orderItemsToCreate to empty list
10. FOR EACH item in merged items
      FETCH locked product corresponding to item.productId
      COMPUTE itemSubtotal as product.priceTimesQuantity (product.priceTimesKobo * item.quantity)
      ADD itemSubtotal to totalAmount
      DECREMENT product stockQuantity by item.quantity
      WRITE updated product stockQuantity to database
      APPEND to orderItemsToCreate:
        productId = item.productId
        quantity = item.quantity
        unitPriceSnapshot = product.priceKobo (snapshot current catalog price)
        subtotalSnapshot = itemSubtotal
    END FOR
11. WRITE new Order record to database:
      customerId = customerId
      status = "pending"
      totalAmount = totalAmount
12. FOR EACH lineItem in orderItemsToCreate
      WRITE OrderItem record linked to new Order id
    END FOR
13. COMMIT database transaction
14. RETURN createdOrder object with 201 Created status
```

---

## 2. Hand-Trace Verification (3 Test Inputs)

### Input 1 (Normal Happy Path):
- `customerId`: Valid customer UUID `C1`
- `items`: `[{ productId: "P1", quantity: 2 }]` (P1 stock: 10, price: 5,000 NGN = 500,000 kobo)
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 1–3 | Customer `C1` exists. Proceed. | Active transaction |
  | 4–6 | Merged items: `[{ P1, qty: 2 }]`. Sorted IDs: `["P1"]`. | Ready for locking |
  | 7 | Locks `P1`. Stock (10) >= 2. Proceed. | Row locked |
  | 8–10 | `totalAmount` = $2 \times 500,000 = 1,000,000$ kobo. P1 stock becomes 8. | Snapshot recorded |
  | 11–13| Order written with total 1,000,000 kobo. Item row written. Commit. | DB updated |
  | 14 | Return order with status `pending`. | **HTTP 201 Created** |
- **Real Code Execution Result:** `tests/orders.test.ts` line 14: Returned `201 Created`, total 1,000,000 kobo, stock decremented to 8. **Match: YES**.

### Input 2 (Edge Case: Insufficient Stock):
- `customerId`: Valid `C1`
- `items`: `[{ productId: "P1", quantity: 15 }]` (P1 stock: 10)
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 1–6 | Customer valid. Sorted IDs: `["P1"]`. | Proceed |
  | 7 | Locks `P1`. Reads stock: 10. Check: $10 < 15$ is TRUE. | Early Exit triggered |
  | 7 | Abort transaction. Return error. | **HTTP 409 Conflict** |
- **Real Code Execution Result:** `tests/orders.test.ts` line 82: Returned `409 Conflict` with message `Insufficient stock for product`. **Match: YES**.

### Input 3 (Invalid Case: Unknown Customer ID):
- `customerId`: Non-existent UUID `C999`
- `items`: `[{ productId: "P1", quantity: 1 }]`
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 1–2 | Start transaction. Look up `C999`. | Null result |
  | 3 | Customer does not exist. Abort transaction. | **HTTP 404 Not Found** |
- **Real Code Execution Result:** `tests/orders.test.ts` line 56: Returned `404 Not Found` with message `Customer not found`. **Match: YES**.
