# PSEUDOCODE.md — Algorithmic Specification

This document presents the formal algorithmic logic, state transition mechanics, and concurrency controls powering the E-Commerce Catalog & Ordering Platform.

---

## Table of Contents
1. [Conventions & Notational Standards](#1-conventions--notational-standards)
2. [Algorithm 1: Catalog Querying, Limit Clamping & Whitelist Sorting](#algorithm-1-catalog-querying-limit-clamping--whitelist-sorting)
3. [Algorithm 2: Concurrency-Safe Order Creation & Stock Reservation](#algorithm-2-concurrency-safe-order-creation--stock-reservation)
4. [Algorithm 3: Order Status State Machine Transition](#algorithm-3-order-status-state-machine-transition)
5. [Algorithm 4: Order Cancellation & Inventory Restock](#algorithm-4-order-cancellation--inventory-restock)
6. [Algorithm 5: Background Scheduled Job — Expired Order Auto-Cancellation](#algorithm-5-background-scheduled-job--expired-order-auto-cancellation)
7. [Algorithmic Complexity Summary](#algorithmic-complexity-summary)

---

## 1. Conventions & Notational Standards

- **Atomic Transactions**: Executed within `BEGIN TRANSACTION ... COMMIT / ROLLBACK` boundaries.
- **Pessimistic Row Locking**: Expressed via `SELECT ... FOR UPDATE`, blocking competing transactions until the current transaction commits or rolls back.
- **Minor Currency Units**: All financial operations occur strictly in integer kobo (`100 kobo = 1 NGN`). Division is prohibited in core logic.
- **Envelope Response Format**:
  - Success Collection: `{ data: Array<T>, meta: { total, limit, offset, hasMore } }`
  - Success Single: `{ data: T }`
  - Error: `{ error: { code: String, message: String, details?: Object } }`

---

## Algorithm 1: Catalog Querying, Limit Clamping & Whitelist Sorting

Handles client requests to retrieve product listings with defensive validation, clamping, and tiebreaker sorting.

```text
ALGORITHM GetProductCatalog(queryParams)
INPUT: queryParams containing { limit, offset, categoryId, minPrice, maxPrice, inStock, sort, order }
OUTPUT: CollectionEnvelope containing paginated products and metadata, or ErrorEnvelope

BEGIN
    // Step 1: Query Parameter Sanitization & Clamping
    parsedLimit ← ParseInteger(queryParams.limit) DEFAULT 20
    IF parsedLimit <= 0 THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Limit must be greater than zero")
    END IF
    // Clamp runaway limit to defend against memory exhaustion
    clampedLimit ← MIN(parsedLimit, 100)

    parsedOffset ← ParseInteger(queryParams.offset) DEFAULT 0
    IF parsedOffset < 0 THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Offset cannot be negative")
    END IF

    // Step 2: Filter Validation & Inversion Guard
    whereConditions ← {}

    IF queryParams.categoryId IS PRESENT THEN
        IF NOT IsValidUUIDv4(queryParams.categoryId) THEN
            RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Invalid category ID format: must be UUID")
        END IF
        whereConditions.categoryId ← queryParams.categoryId
    END IF

    IF queryParams.minPrice IS PRESENT THEN
        minP ← ParseInteger(queryParams.minPrice)
        IF minP < 0 OR minP > 2147483647 THEN
            RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "minPrice must be between 0 and 2147483647")
        END IF
        whereConditions.price.gte ← minP
    END IF

    IF queryParams.maxPrice IS PRESENT THEN
        maxP ← ParseInteger(queryParams.maxPrice)
        IF maxP < 0 OR maxP > 2147483647 THEN
            RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "maxPrice must be between 0 and 2147483647")
        END IF
        whereConditions.price.lte ← maxP
    END IF

    // Inverted range check
    IF whereConditions.price.gte IS PRESENT AND whereConditions.price.lte IS PRESENT THEN
        IF whereConditions.price.gte > whereConditions.price.lte THEN
            RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "minPrice cannot exceed maxPrice")
        END IF
    END IF

    IF queryParams.inStock IS PRESENT THEN
        IF queryParams.inStock == true THEN
            whereConditions.stockQuantity ← { gt: 0 }
        ELSE
            whereConditions.stockQuantity ← { equals: 0 }
        END IF
    END IF

    // Step 3: Whitelist Sorting & Secondary Tiebreaker
    ALLOWED_SORT_FIELDS ← ["price", "createdAt", "name", "stockQuantity"]
    sortField ← queryParams.sort DEFAULT "createdAt"
    IF sortField NOT IN ALLOWED_SORT_FIELDS THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Invalid sort field. Allowed: " + ALLOWED_SORT_FIELDS)
    END IF

    sortOrder ← ToLowerCase(queryParams.order) DEFAULT "desc"
    IF sortOrder NOT IN ["asc", "desc"] THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Order must be 'asc' or 'desc'")
    END IF

    // Construct primary sort + deterministic tiebreaker on primary key
    orderByClause ← [
        { [sortField]: sortOrder },
        { id: "asc" }
    ]

    // Step 4: Execute Total Count and Paginated Query in Parallel
    totalRecords ← DB.Count(Product, WHERE whereConditions)
    products ← DB.FindMany(Product, 
                           WHERE whereConditions, 
                           ORDER BY orderByClause, 
                           SKIP parsedOffset, 
                           TAKE clampedLimit)

    hasMore ← (parsedOffset + products.length) < totalRecords

    RETURN CollectionEnvelope(HTTP_200, products, {
        total: totalRecords,
        limit: clampedLimit,
        offset: parsedOffset,
        hasMore: hasMore
    })
END
```

---

## Algorithm 2: Concurrency-Safe Order Creation & Stock Reservation

Guarantees transactional consistency, eliminates race conditions during simultaneous checkouts, and snapshots immutable line-item prices.

```text
ALGORITHM CreateOrder(requestBody)
INPUT: requestBody containing { customerId, items: [ { productId, quantity } ] }
OUTPUT: SingleEnvelope containing created Order or ErrorEnvelope

BEGIN
    // Step 1: Input Validation
    IF NOT IsValidUUIDv4(requestBody.customerId) THEN
        RETURN ErrorEnvelope(HTTP_422, "VALIDATION_ERROR", "Invalid or missing customerId")
    END IF

    IF requestBody.items IS EMPTY THEN
        RETURN ErrorEnvelope(HTTP_422, "VALIDATION_ERROR", "Order must contain at least one item")
    END IF

    // Consolidate duplicate products in the request payload
    consolidatedItems ← Map<UUID, Integer>()
    FOR EACH item IN requestBody.items DO
        IF item.quantity <= 0 THEN
            RETURN ErrorEnvelope(HTTP_422, "VALIDATION_ERROR", "Item quantity must be greater than zero")
        END IF
        currentQty ← consolidatedItems.GET(item.productId) DEFAULT 0
        consolidatedItems.SET(item.productId, currentQty + item.quantity)
    END FOR

    productIds ← consolidatedItems.KEYS()

    // Step 2: Execute Interactive Transaction with Pessimistic Row Locking
    BEGIN TRANSACTION (ISOLATION = READ_COMMITTED)
        // Verify customer existence
        customer ← DB.FindUnique(Customer, WHERE id = requestBody.customerId)
        IF customer IS NULL THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_404, "NOT_FOUND", "Customer not found")
        END IF

        // ACQUIRE EXCLUSIVE ROW LOCKS on all targeted product records
        // Competing checkout transactions for these products must wait until this lock is released
        lockedProducts ← DB.QueryRaw(`
            SELECT id, name, price, "stockQuantity" 
            FROM "Product" 
            WHERE id = ANY(productIds::uuid[]) 
            FOR UPDATE
        `)

        IF lockedProducts.length != productIds.length THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_404, "NOT_FOUND", "One or more products not found in catalog")
        END IF

        productMap ← IndexById(lockedProducts)
        orderTotalAmount ← 0
        orderLinesToCreate ← []

        // Step 3: Verify Stock and Compute Snapshots Server-Side
        FOR EACH (productId, requestedQuantity) IN consolidatedItems DO
            product ← productMap[productId]

            // Strict Stock Verification
            IF product.stockQuantity < requestedQuantity THEN
                ROLLBACK
                RETURN ErrorEnvelope(HTTP_409, "CONFLICT", 
                    "Insufficient stock for product '" + product.name + 
                    "'. Requested: " + requestedQuantity + 
                    ", Available: " + product.stockQuantity)
            END IF

            // Decrement Stock in Database
            DB.Update(Product, 
                      WHERE id = productId, 
                      SET stockQuantity = stockQuantity - requestedQuantity)

            // Calculate Line Total in Minor Units (Kobo)
            lineTotal ← product.price * requestedQuantity
            orderTotalAmount ← orderTotalAmount + lineTotal

            // Snapshot unitPrice at the instant of order placement
            orderLinesToCreate.APPEND({
                id: GenerateUUIDv4(),
                productId: productId,
                quantity: requestedQuantity,
                unitPrice: product.price   // Immutable snapshot
            })
        END FOR

        // Step 4: Persist Order and Related Line Items
        newOrder ← DB.Insert(Order, {
            id: GenerateUUIDv4(),
            customerId: customer.id,
            status: "pending",
            totalAmount: orderTotalAmount,
            currency: "NGN",
            items: orderLinesToCreate,
            createdAt: Now(),
            updatedAt: Now()
        })

    COMMIT TRANSACTION

    RETURN SingleEnvelope(HTTP_201, newOrder)
END
```

---

## Algorithm 3: Order Status State Machine Transition

Governs finite state transitions for order fulfillment under pessimistic order row locking.

```text
ALGORITHM UpdateOrderStatus(orderId, newStatus)
INPUT: orderId (UUID), newStatus (String: "pending"|"paid"|"shipped"|"delivered"|"cancelled")
OUTPUT: SingleEnvelope containing updated Order or ErrorEnvelope

STATE MACHINE RULES:
    pending   → ["paid", "cancelled"]
    paid      → ["shipped", "cancelled"]
    shipped   → ["delivered"]
    delivered → [] (Terminal)
    cancelled → [] (Terminal)

BEGIN
    IF NOT IsValidUUIDv4(orderId) THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Invalid order ID format")
    END IF

    IF newStatus NOT IN ["pending", "paid", "shipped", "delivered", "cancelled"] THEN
        RETURN ErrorEnvelope(HTTP_422, "VALIDATION_ERROR", "Invalid status enum value")
    END IF

    BEGIN TRANSACTION
        // Lock the specific order row
        lockedOrder ← DB.QueryRaw(`
            SELECT id, status FROM "Order" WHERE id = orderId::uuid FOR UPDATE
        `)

        IF lockedOrder IS EMPTY THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_404, "NOT_FOUND", "Order not found")
        END IF

        currentStatus ← lockedOrder[0].status

        // Idempotent Transition Check (no-op success per PRD §6)
        IF currentStatus == newStatus THEN
            orderData ← DB.FindUnique(Order, WHERE id = orderId, INCLUDE items, customer)
            COMMIT
            RETURN SingleEnvelope(HTTP_200, orderData)
        END IF

        // Validate Transition Rule
        allowedDestinations ← STATE_MACHINE_RULES[currentStatus]
        IF newStatus NOT IN allowedDestinations THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_409, "CONFLICT", 
                "Illegal status transition from '" + currentStatus + "' to '" + newStatus + "'")
        END IF

        // Apply Status Update
        updatedOrder ← DB.Update(Order, 
                                 WHERE id = orderId, 
                                 SET status = newStatus, updatedAt = Now(), 
                                 INCLUDE items, customer)
    COMMIT TRANSACTION

    RETURN SingleEnvelope(HTTP_200, updatedOrder)
END
```

---

## Algorithm 4: Order Cancellation & Inventory Restock

Handles cancellation and hard deletion of pending orders with atomic inventory refund.

```text
ALGORITHM DeletePendingOrder(orderId)
INPUT: orderId (UUID)
OUTPUT: HTTP 204 No Content or ErrorEnvelope

BEGIN
    IF NOT IsValidUUIDv4(orderId) THEN
        RETURN ErrorEnvelope(HTTP_400, "BAD_REQUEST", "Invalid order ID format")
    END IF

    BEGIN TRANSACTION
        // Acquire row lock on target order
        lockedOrder ← DB.QueryRaw(`
            SELECT id, status FROM "Order" WHERE id = orderId::uuid FOR UPDATE
        `)

        IF lockedOrder IS EMPTY THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_404, "NOT_FOUND", "Order not found")
        END IF

        // Only pending orders can be deleted
        IF lockedOrder[0].status != "pending" THEN
            ROLLBACK
            RETURN ErrorEnvelope(HTTP_409, "CONFLICT", 
                "Cannot delete order with status '" + lockedOrder[0].status + "'. Only pending orders can be deleted.")
        END IF

        // Fetch associated line items
        lineItems ← DB.FindMany(OrderItem, WHERE orderId = orderId)

        // Restock inventory for each product
        FOR EACH item IN lineItems DO
            DB.Update(Product, 
                      WHERE id = item.productId, 
                      SET stockQuantity = stockQuantity + item.quantity)
        END FOR

        // Delete order record (Foreign key CASCADE automatically removes OrderItems)
        DB.Delete(Order, WHERE id = orderId)

    COMMIT TRANSACTION

    RETURN HttpResponse(HTTP_204, NO_CONTENT)
END
```

---

## Algorithm 5: Background Scheduled Job — Expired Order Auto-Cancellation

Autonomous worker job that detects expired pending orders, cancels them, and restores reserved stock to catalog.

```text
ALGORITHM ExpireStaleOrdersJob(expiryMinutes = 30, batchSize = 100)
INPUT: expiryMinutes (Integer), batchSize (Integer)
OUTPUT: JobMetrics { scanned, cancelled, restockedUnits, elapsedMs }

BEGIN
    startTime ← CurrentTimestampMs()
    cutoffTimestamp ← Now() - (expiryMinutes * 60 seconds)

    // Identify candidate expired pending orders
    candidateOrders ← DB.FindMany(Order, 
                                  WHERE status == "pending" AND createdAt <= cutoffTimestamp, 
                                  ORDER BY createdAt ASC, 
                                  LIMIT batchSize)

    cancelledCount ← 0
    totalUnitsRestocked ← 0

    FOR EACH candidate IN candidateOrders DO
        BEGIN TRANSACTION
            // Lock individual order row
            lockedOrder ← DB.QueryRaw(`
                SELECT id, status FROM "Order" WHERE id = candidate.id::uuid FOR UPDATE
            `)

            // Verify order has not been concurrently paid or deleted
            IF lockedOrder IS NOT EMPTY AND lockedOrder[0].status == "pending" THEN
                items ← DB.FindMany(OrderItem, WHERE orderId = candidate.id)

                // Restore stock back to catalog
                FOR EACH item IN items DO
                    DB.Update(Product, 
                              WHERE id = item.productId, 
                              SET stockQuantity = stockQuantity + item.quantity)
                    totalUnitsRestocked ← totalUnitsRestocked + item.quantity
                END FOR

                // Transition order to cancelled
                DB.Update(Order, 
                          WHERE id = candidate.id, 
                          SET status = "cancelled", updatedAt = Now())

                cancelledCount ← cancelledCount + 1
            END IF
        COMMIT TRANSACTION
    END FOR

    elapsedMs ← CurrentTimestampMs() - startTime

    LogInfo("Stale Order Expiry Job Complete", {
        scanned: candidateOrders.length,
        cancelled: cancelledCount,
        restockedUnits: totalUnitsRestocked,
        elapsedMs: elapsedMs
    })

    RETURN {
        scanned: candidateOrders.length,
        cancelled: cancelledCount,
        restockedUnits: totalUnitsRestocked,
        elapsedMs: elapsedMs
    }
END
```

---

## Algorithmic Complexity Summary

| Algorithm | Primary Operation | Time Complexity | Space Complexity | Concurrency Protection |
|---|---|---|---|---|
| **Algorithm 1 (Catalog)** | B-Tree Index Scan + Count | $O(\log N + K)$ | $O(K)$ ($K \le 100$) | Non-blocking MVCC read snapshot |
| **Algorithm 2 (Order Create)** | Row-locked multi-table write | $O(M)$ line items | $O(M)$ | Pessimistic `SELECT ... FOR UPDATE` |
| **Algorithm 3 (State Machine)** | Row-locked status transition | $O(1)$ | $O(1)$ | Pessimistic row lock on Order ID |
| **Algorithm 4 (Order Delete)** | Stock restock + cascade delete | $O(M)$ line items | $O(M)$ | Pessimistic row lock on Order ID |
| **Algorithm 5 (Background Job)** | Batch fetch + atomic restock loop | $O(B \times M)$ | $O(B)$ batch size | Isolated per-order row lock transactions |
