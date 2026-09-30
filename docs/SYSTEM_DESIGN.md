# SYSTEM_DESIGN.md — E-Commerce Catalog & Ordering Platform

This document defines the comprehensive system design and architectural specification for the E-Commerce API platform, complementing the implementation contract (`ecommerce-api-prd.md`) and operational constitution (`AGENTS.md`).

---

## 1. Executive System Topology

```
                         ┌─────────────────────────────────────────┐
                         │       Client / Consumer Application     │
                         │    (Vite + React + TS, AbortController, │
                         │     Cold-Start Indicator, Non-blocking) │
                         └───────────────────┬─────────────────────┘
                                             │ HTTPS
                                             ▼
                         ┌─────────────────────────────────────────┐
                         │         Reverse Proxy / Edge Tier       │
                         │         (Render / Railway / Ingress)    │
                         │     - TLS 1.3 Termination               │
                         │     - X-Forwarded-For Header Injection  │
                         └───────────────────┬─────────────────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Application Tier (Node.js / Express)                     │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Middleware Pipeline                                                            │   │
│   │  ├── 1. Correlation ID Middleware (X-Request-Id tracing context)               │   │
│   │  ├── 2. Helmet Security Headers (HSTS, CSP, X-Frame-Options, Sniff Guard)       │   │
│   │  ├── 3. Strict CORS Policy (Explicit origin allowlist, Credentials enabled)   │   │
│   │  ├── 4. Body Payload Ceiling (100kb maximum raw JSON payload size)             │   │
│   │  └── 5. Rate Limiter (RFC 7231 Retry-After, Token bucket window, /healthz skip)│   │
│   └────────────────────────────────────────┬───────────────────────────────────────┘   │
│                                            │                                           │
│   ┌────────────────────────────────────────▼───────────────────────────────────────┐   │
│   │ Routing & Validation Tier                                                      │   │
│   │  ├── Route Dispatcher (/api/v1/{categories, products, customers, orders})      │   │
│   │  └── Zod Schema Validation (Location-aware: 422 on body, 400 on params/query)  │   │
│   └────────────────────────────────────────┬───────────────────────────────────────┘   │
│                                            │                                           │
│   ┌────────────────────────────────────────▼───────────────────────────────────────┐   │
│   │ Controllers & Presentation Layer                                               │   │
│   │  ├── Request unmarshaling & parameter extraction                               │   │
│   │  └── Envelope response serialization (CollectionResponse, SingleResponse, 204) │   │
│   └────────────────────────────────────────┬───────────────────────────────────────┘   │
│                                            │                                           │
│   ┌────────────────────────────────────────▼───────────────────────────────────────┐   │
│   │ Domain Service Tier                                                            │   │
│   │  ├── Catalog Query Engine (Limit clamping, whitelist sort, inverted guards)    │   │
│   │  ├── Order Transaction Manager (Row-level lock, atomic decrement, snapshots)   │   │
│   │  └── Order State Machine (Pending -> Paid -> Shipped -> Delivered, Restock)    │   │
│   └────────────────────────────────────────┬───────────────────────────────────────┘   │
│                                            │                                           │
│   ┌────────────────────────────────────────▼───────────────────────────────────────┐   │
│   │ Centralized Error Handler (Registered Last)                                    │   │
│   │  ├── Domain Error Translation (AppError, NotFoundError, ConflictError)         │   │
│   │  ├── Prisma Error Translation (P2002 -> 409, P2025 -> 404, P2003 -> 400)       │   │
│   │  └── Safe Internal Error Masking (Opaque 500 envelope, server log correlation) │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────┬───────────────────────────────────────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Data Tier (Prisma ORM & PostgreSQL 16)                    │
│                                                                                        │
│   ├── Connection Pool Management (?connection_limit=5&sslmode=require)                 │
│   ├── Interactive Concurrency Isolation (SELECT ... FOR UPDATE row locks)              │
│   ├── Foreign Key Cascade Hygiene (CASCADE only on OrderItem -> Order; RESTRICT else)  │
│   ├── Index Architecture (B-Tree on price, categoryId, customerId, status, createdAt)  │
│   └── Database-Level CHECK Constraints (stockQuantity >= 0, price > 0, etc.)           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Principles & Invariants

### 2.1 Money & Numerical Representation
- **Minor Units Everywhere**: All financial values are modeled as 32-bit integers representing minor units (NGN kobo). 
- **Float Prohibition**: Floating-point types (`Float`, `Double`, `Decimal` with imprecise serialization) are strictly prohibited across all layers (PostgreSQL columns, Prisma schema, TypeScript domain models, and API JSON payloads).
- **Snapshot Pricing**: `OrderItem.unitPrice` is snapshotted from `Product.price` at the instant of order creation and is immutable thereafter. Order totals (`totalAmount`) are calculated server-side as `Σ(quantity * snapshotted unitPrice)` and never trust client-supplied figures.

### 2.2 Identity & Key Strategy
- **UUID v4**: All entities (`Category`, `Product`, `Customer`, `Order`, `OrderItem`) use randomly generated UUID v4 keys stored as native PostgreSQL `uuid` types.
- **Enumeration Attack Prevention**: Sequential integer IDs (`SERIAL`, `BIGSERIAL`, `AUTO_INCREMENT`) are completely excluded to eliminate resource enumeration and sequential scraping vulnerabilities.
- **Route Parameter Validation**: Malformed UUIDs in path parameters (e.g. `/products/123-abc`) fail with `400 BAD_REQUEST` ("Invalid ID format: must be a valid UUID"). Well-formed UUIDs that do not exist in storage resolve to `404 NOT_FOUND`.

### 2.3 Concurrency & Transactional Order Integrity
Order placement involves multiple tables, stock decrement, and pricing calculations. Concurrency safety is achieved via **Pessimistic Row-Level Locking**:

```sql
SELECT id, name, price, "stockQuantity" 
FROM "Product" 
WHERE id = ANY($1::uuid[]) 
FOR UPDATE;
```

#### Concurrency Flow:
1. Client requests `POST /api/v1/orders`.
2. Controller parses and validates body with strict Zod schema (rejecting unexpected properties with `422`).
3. Service begins interactive database transaction `prisma.$transaction`.
4. Row-level lock (`FOR UPDATE`) is acquired on all distinct requested product rows.
5. In-transaction re-read guarantees up-to-the-millisecond stock availability.
6. If any product has `requestedQuantity > stockQuantity`, transaction rolls back and aborts with `409 CONFLICT` ("Insufficient stock for product X. Requested: Y, Available: Z").
7. Stock is decremented in place: `UPDATE "Product" SET "stockQuantity" = "stockQuantity" - Y`.
8. Order record and OrderItem records are inserted within the same atomic transaction.
9. Transaction commits, releasing row locks. Competing transactions queue safely; whichever loses the race receives `409 Conflict`, guaranteeing zero overselling and preventing stock from ever dropping below zero.

### 2.4 State Machine & Lifecycle Rules

```
           ┌──────────┐
           │ pending  │
           └────┬─────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   ┌─────────┐     ┌───────────┐
   │  paid   │     │ cancelled │ (Terminal)
   └────┬────┘     └───────────┘
        │               ▲
        ├───────────────┘
        ▼
   ┌─────────┐
   │ shipped │
   └────┬────┘
        │
        ▼
  ┌───────────┐
  │ delivered │ (Terminal)
  └───────────┘
```

- **Transitions**:
  - `pending` -> `paid`, `cancelled`
  - `paid` -> `shipped`, `cancelled`
  - `shipped` -> `delivered`
  - `delivered` -> (Terminal)
  - `cancelled` -> (Terminal)
- **Idempotency**: A PATCH request targeting the existing status is a no-op returning `200 OK` with the existing state.
- **Order Deletion & Restocking**: Deletion (`DELETE /orders/:id`) is permitted **only** when `status === 'pending'`. A successful delete executes an atomic transaction that replenishes inventory for all associated line items before cascading the deletion of the order, returning `204 No Content` with zero body bytes.

---

## 3. Database Architecture & Storage Design

### 3.1 Relational Graph & Cascade Boundaries
| Parent | Child | Foreign Key | Cascade Behavior | Architectural Rationale |
|---|---|---|---|---|
| `Customer` | `Order` | `Order.customerId -> Customer.id` | `RESTRICT` | Financial history and customer records must never be orphaned. |
| `Category` | `Product` | `Product.categoryId -> Category.id` | `RESTRICT` | Products must not lose their organizational classification. |
| `Product` | `OrderItem` | `OrderItem.productId -> Product.id` | `RESTRICT` | Preserves auditability of historical line item purchases. |
| `Order` | `OrderItem` | `OrderItem.orderId -> Order.id` | `CASCADE` | Order line items have no lifecycle independent of the order. |

### 3.2 Indexing Strategy
Indexes are deliberately placed only where query workloads demand them:
- **`Customer(email)`**: Unique B-tree index. Emails are normalized to lowercase on write to guarantee case-insensitive uniqueness across all collation configurations.
- **`Category(name)`**: Unique B-tree index.
- **`Product(categoryId)`**: B-tree index for Category -> Products lookups and filtering.
- **`Product(price)`**: B-tree index supporting `minPrice`/`maxPrice` range scans and `sort=price`.
- **`Order(customerId)`**: B-tree index supporting customer-scoped order retrieval.
- **`Order(status)`**: Low-cardinality B-tree index supporting status filtering and admin querying.
- **`Order(createdAt)`**: B-tree index for default chronological sorting (`createdAt desc`).
- **`OrderItem(orderId, productId)`**: B-tree index for join performance.

### 3.3 Storage-Level Defense-in-Depth (CHECK Constraints)
Database check constraints prevent invalid records from ever being committed to disk even if application validation were bypassed:
```sql
ALTER TABLE "Product" ADD CONSTRAINT check_product_stock_non_negative CHECK ("stockQuantity" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT check_product_price_positive CHECK (price > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT check_order_item_quantity_positive CHECK (quantity >= 1);
ALTER TABLE "OrderItem" ADD CONSTRAINT check_order_item_unit_price_positive CHECK ("unitPrice" > 0);
```

---

## 4. API Contract, Error Handling & Security Topology

### 4.1 Response Envelope Shapes
Every API response strictly matches one of three shapes:

1. **Collections**:
   ```json
   {
     "data": [ ... ],
     "meta": {
       "total": 400,
       "limit": 20,
       "offset": 0,
       "hasMore": true
     }
   }
   ```

2. **Single Resource**:
   ```json
   {
     "data": { ... }
   }
   ```

3. **Error**:
   ```json
   {
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "quantity must be at least 1",
       "details": { ... }
     }
   }
   ```

### 4.2 Standard HTTP Status Mapping
| Status Code | Error Code | Meaning / Condition |
|---|---|---|
| `200 OK` | — | Successful read or idempotent update. |
| `201 Created` | — | Successful resource creation (`POST /orders`). |
| `204 No Content` | — | Successful deletion (`DELETE /orders/:id`) with zero body bytes. |
| `400 Bad Request` | `BAD_REQUEST` | Malformed query parameters, invalid sort fields, negative limits/offsets, malformed UUID path params, malformed JSON body. |
| `404 Not Found` | `NOT_FOUND` | Valid-format UUID with no matching record in database, or unmapped route path. |
| `409 Conflict` | `CONFLICT` | State conflict: insufficient stock, illegal order state machine transition, deleting non-pending order, or duplicate unique constraint. |
| `422 Unprocessable Entity` | `VALIDATION_ERROR` | Schema validation failures in request body (e.g., empty items array, missing fields, unexpected properties in strict mode). |
| `429 Too Many Requests` | `RATE_LIMITED` | Rate limit threshold exceeded; includes `Retry-After` header. |
| `500 Internal Server Error`| `INTERNAL_ERROR` | Server-side runtime error. Stack trace and internals masked; correlation ID logged. |

---

## 5. Deployment & Production Reliability

### 5.1 Reverse Proxy & Platform Connection Pooling
- **Managed Postgres Connection Cap**: Render/Railway databases enforce low connection limits on starter plans. `DATABASE_URL` specifies `?connection_limit=5&sslmode=require` to prevent connection pool exhaustion.
- **Fail-Fast Environment Validation**: `src/config/index.ts` validates all required environment variables at process startup using Zod. Missing or invalid keys trigger an immediate exit with code `1` and descriptive terminal diagnostics.
- **Healthcheck Endpoint (`/healthz`)**: Platform uptime monitors hit `/healthz` directly. This endpoint is explicitly bypassed by the rate limiter to prevent synthetic monitor traffic from exhausting real user quota.

### 5.2 Frontend Consumer Reliability Model (Phase 6)
- **Cold-Start Buffer**: Free-tier cloud providers spin down inactive instances. The frontend client includes an explicit cold-start indicator ("API is waking up, this may take up to 30 seconds...") instead of an ambiguous generic spinner.
- **Stale Request Protection**: Rapid pagination clicks cancel in-flight queries using `AbortController`, preventing out-of-order responses from corrupting UI state.
- **Pagination Boundary Defense**: The "Next Page" button is disabled whenever `meta.hasMore === false`.
