# E-Commerce Catalog & Ordering Platform — REST API & Consumer Client

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-1B222D.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/Tests-44%2F44%20Passing-success.svg)](https://vitest.dev/)

A production-grade REST API modeling a complete e-commerce catalog and transactional ordering platform, backed by PostgreSQL and Prisma ORM, paired with an edge-resilient React consumer client application.

- **Live Public API**: [`https://ecommerce-api-xidz.onrender.com`](https://ecommerce-api-xidz.onrender.com)
- **Live Healthcheck**: [`https://ecommerce-api-xidz.onrender.com/healthz`](https://ecommerce-api-xidz.onrender.com/healthz)
- **Live Consumer Client**: [`https://ecommerce-consumer.onrender.com`](https://ecommerce-consumer.onrender.com)
- **GitHub Repository**: [`https://github.com/olaflay/ecommerce-api`](https://github.com/olaflay/ecommerce-api)

---

## 1. Resource Modeling & Relationships (Step 1)

The system models an e-commerce market consisting of 5 strongly related resource entities. All entities use generated **UUID v4** identifiers rather than sequential integers to prevent enumeration and ID-scraping attacks.

### Entity Relationship Diagram
```
+------------------+           +------------------+
|     Category     | 1       * |     Product      |
|------------------|<--------->|------------------|
| id (UUID v4)     |           | id (UUID v4)     |
| name             |           | categoryId (FK)  |
| description      |           | name, price      |
+------------------+           | stockQuantity    |
                               +------------------+
                                        ^
                                        | 1
                                        | *
+------------------+ 1       * +------------------+ *       1 +------------------+
|     Customer     |<--------->|      Order       |<--------->|    OrderItem     |
|------------------|           |------------------|           |------------------|
| id (UUID v4)     |           | id (UUID v4)     |           | id (UUID v4)     |
| name             |           | customerId (FK)  |           | orderId (FK)     |
| email (unique)   |           | status (enum)    |           | productId (FK)   |
+------------------+           | totalAmount      |           | quantity         |
                               | currency (NGN)   |           | unitPrice (snap) |
                               +------------------+           +------------------+
```

### Resource Field Specification Table

#### 1. Category (`Category`)
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `UUID v4` (`String`) | Yes | `gen_random_uuid()` | Primary identifier; non-sequential |
| `name` | `VarChar(100)` | Yes | — | Unique category title (e.g., "Electronics") |
| `description` | `Text` | No | `null` | Optional description |
| `createdAt` | `DateTime` | Yes | `now()` | Timestamp of record creation |
| `updatedAt` | `DateTime` | Yes | auto-updated | Timestamp of last modification |

#### 2. Product (`Product`)
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `UUID v4` (`String`) | Yes | `gen_random_uuid()` | Primary identifier; non-sequential |
| `categoryId` | `UUID v4` (`String`) | Yes | — | Foreign key referencing `Category.id` (`onDelete: Restrict`) |
| `name` | `VarChar(255)` | Yes | — | Item title |
| `description` | `Text` | No | `null` | Marketing & specification copy |
| `price` | `Int` (32-bit) | Yes | — | Stored in minor units (integer kobo; `price > 0` DB constraint) |
| `currency` | `VarChar(3)` | Yes | `"NGN"` | ISO-4217 standard currency code |
| `stockQuantity` | `Int` | Yes | `0` | Available inventory units (`stockQuantity >= 0` DB constraint) |
| `createdAt` | `DateTime` | Yes | `now()` | Record creation timestamp |
| `updatedAt` | `DateTime` | Yes | auto-updated | Last modification timestamp |

#### 3. Customer (`Customer`)
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `UUID v4` (`String`) | Yes | `gen_random_uuid()` | Primary identifier; non-sequential |
| `name` | `VarChar(255)` | Yes | — | Full customer name |
| `email` | `VarChar(255)` | Yes | — | Unique email address (lowercased on write) |
| `createdAt` | `DateTime` | Yes | `now()` | Customer registration timestamp |
| `updatedAt` | `DateTime` | Yes | auto-updated | Account update timestamp |

#### 4. Order (`Order`)
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `UUID v4` (`String`) | Yes | `gen_random_uuid()` | Primary identifier; non-sequential |
| `customerId` | `UUID v4` (`String`) | Yes | — | Foreign key referencing `Customer.id` (`onDelete: Restrict`) |
| `status` | `OrderStatus` (enum) | Yes | `"pending"` | Finite state machine: `pending`, `paid`, `shipped`, `delivered`, `cancelled` |
| `totalAmount` | `Int` (32-bit) | Yes | — | Server-computed sum of items in integer kobo (`totalAmount >= 0` constraint) |
| `currency` | `VarChar(3)` | Yes | `"NGN"` | Currency code matching product catalog |
| `createdAt` | `DateTime` | Yes | `now()` | Order placement timestamp |
| `updatedAt` | `DateTime` | Yes | auto-updated | State transition timestamp |

#### 5. OrderItem (`OrderItem`)
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | `UUID v4` (`String`) | Yes | `gen_random_uuid()` | Primary identifier; non-sequential |
| `orderId` | `UUID v4` (`String`) | Yes | — | Foreign key referencing `Order.id` (`onDelete: Cascade`) |
| `productId` | `UUID v4` (`String`) | Yes | — | Foreign key referencing `Product.id` (`onDelete: Restrict`) |
| `quantity` | `Int` | Yes | `1` | Purchased quantity (`quantity > 0` DB constraint) |
| `unitPrice` | `Int` (32-bit) | Yes | — | Snapshotted unit price in kobo at checkout time |
| `createdAt` | `DateTime` | Yes | `now()` | Item creation timestamp |

---

## 2. Design Decisions & Architectural Tradeoffs

### 2.1 Why These Resources?
An e-commerce marketplace naturally requires a multi-tier relational model:
1. **Catalog hierarchy**: `Category` → `Product` enables categorical navigation, faceted filtering, and relational integrity.
2. **Identity & Checkout**: `Customer` represents purchasing actors.
3. **Transaction boundary**: `Order` and `OrderItem` separate order metadata from individual line items. This separation is required to snapshot historical unit prices at purchase time, protecting historical accounting from future catalog price changes.

### 2.2 Why Generated Identifiers (UUID v4)?
Sequential auto-incrementing integers (`1, 2, 3...`) expose critical vulnerabilities in public APIs:
- **Enumeration Attacks**: Attackers can guess IDs to scrape the entire database.
- **Business Intelligence Leakage**: Competitors can monitor `orderId` growth rates to determine order volume and sales velocity.
- **Distributed Generation**: UUID v4 allows client or distributed service ID generation without database roundtrips or central lock contention.

### 2.3 Offset vs. Cursor Pagination: The Real Engineering Tradeoff
This API implements **Offset Pagination** (`limit` + `offset`) with a deterministic secondary tiebreaker (`id asc`):
- **Why Offset for E-Commerce Catalog Browsing**:
  - E-commerce users expect numbered pages (`"Page 1, 2, 3... 20"`) and arbitrary jumping (e.g. jumping straight to page 5). Cursor pagination only supports sequential "Next/Previous" traversal.
  - Catalog browsing requires exposing the `total` count so buyers understand catalog depth. Offset queries support `COUNT(*)` natively.
- **When Cursor Pagination Would Be Better**:
  - **High-Velocity Feeds**: Social feeds, chat message histories, and real-time activity streams where items are continuously inserted at the top. In an offset system, inserting a new record while a user pages causes duplicate items on page 2 ("pagination drift").
  - **Deep Datasets**: For offset values over 100,000, database engines must scan and discard all preceding rows (`OFFSET 100000 LIMIT 20`), leading to O(N) degradation. Cursor pagination uses index seek (`WHERE (createdAt, id) < ($cursorTimestamp, $cursorId) LIMIT 20`), which is strictly O(1) regardless of depth.
- **Mitigation Implemented**: To protect our offset system against runaway resource exhaustion, `limit` is clamped to a maximum of 100 (e.g., `limit=5000` is safely clamped to 100), and tiebreaker sorting on `id` prevents duplicate rows during concurrent writes.

### 2.4 Response Envelope Shape & Honest HTTP Status Codes
Every API response strictly follows standard envelope contracts:
- **Collection Envelope**:
  ```json
  {
    "data": [...],
    "meta": { "total": 400, "limit": 20, "offset": 0, "hasMore": true }
  }
  ```
- **Single Item Envelope**:
  ```json
  { "data": { ... } }
  ```
- **Error Envelope**:
  ```json
  {
    "error": {
      "code": "BAD_REQUEST",
      "message": "Human-readable description",
      "details": { "field": ["Specific validation error"] }
    }
  }
  ```
- **Why Envelope Discipline Matters**:
  - Guarantees predictable unmarshaling on the client side: consumers always inspect `response.data` or handle `response.error`.
  - Avoids the anti-pattern of returning HTTP 200 with an error object inside the body.
  - The API uses honest HTTP status codes: `400` (bad query/format), `404` (not found), `409` (state conflict/insufficient stock), `413` (payload too large), `422` (validation failure), `429` (rate limited), and `500` (opaque internal error).

### 2.5 Financial Integrity: Integer Minor Units (Kobo)
Floating-point representations (`0.1 + 0.2 === 0.30000000000000004`) lead to rounding errors, reconciliation discrepancies, and security flaws. All monetary values across the database schema, business logic, calculations, and JSON contracts are stored strictly in integer minor units (**kobo**, where 100 kobo = 1 NGN). The consumer client formats kobo into decimal currency (`₦`) only at the visual display layer.

### 2.6 Concurrency & Pessimistic Row Locking
To eliminate overselling during flash sales, `POST /api/v1/orders` executes inside an interactive transaction:
```sql
SELECT id, name, price, "stockQuantity" 
FROM "Product" 
WHERE id = ANY($productIds::uuid[]) 
FOR UPDATE;
```
Exclusive locks are acquired on all affected product rows before stock availability is checked. Competing transactions wait for the lock; when released, they read the decremented stock and fail with a clean `409 Conflict` if stock is exhausted. Furthermore, PostgreSQL `CHECK` constraints (`"stockQuantity" >= 0`) guarantee invariants at the storage engine level.

---

## 3. Quickstart & Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16+ running locally or in Docker

### 1. Clone & Install
```bash
git clone https://github.com/olaflay/ecommerce-api.git
cd ecommerce-api
npm install
npm --prefix consumer install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default local configuration:
```env
DATABASE_URL="postgres://postgres:postgres@localhost:5434/bootcamp_ecommerce?connection_limit=5"
PORT=4000
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Database Migration & Idempotent Seed
```bash
# Run migrations (creates tables and CHECK constraints)
npm run prisma:deploy

# Run deterministic seed script (Faker seed 42)
npm run seed
```

### 4. Running Locally
```bash
# Start backend API (port 4000)
npm run dev

# In a separate terminal, start consumer client (port 5173)
cd consumer
npm run dev
```
Open [`http://localhost:5173`](http://localhost:5173) in your browser.

---

## 4. Testing & Empirical Verification

Run the full automated test suite with Vitest:
```bash
npm test
```

### Test Suite Breakdown (44 Tests across 5 Suites):
- **Scaffold & Security (`tests/app.test.ts`)**:
  - `GET /healthz` and `/api/v1/healthz` return 200.
  - Unmapped routes return standard 404 envelope.
  - Malformed JSON body returns 400 `BAD_REQUEST`.
  - Unexpected runtime 500 masks internal stack traces from response.
- **Database Constraints & Tracing (`tests/constraints.test.ts`)**:
  - Direct insert of negative `stockQuantity` is blocked by DB CHECK constraint.
  - Direct insert of non-positive `price` is blocked by DB CHECK constraint.
  - `X-Request-Id` correlation UUID header is verified across responses.
- **Concurrency & Stock Integrity (`tests/concurrency.test.ts`)**:
  - Fires two simultaneous requests competing for the last unit of stock (`stockQuantity = 1`).
  - Verifies exactly 1 request receives `201 Created` and 1 receives `409 Conflict`, leaving stock at 0.
  - Serializes concurrent status PATCHes under row lock preventing terminal status corruption.
- **Catalog Querying, Filtering, & Sorting (`tests/catalog.test.ts`)**:
  - Limit clamping (`limit=5000` clamped to 100), negative offset rejection (`400`).
  - Inverted range rejection (`minPrice > maxPrice` -> `400`).
  - Whitelist sorting, multi-sort parameter rejection, UUID validation.
- **Order Lifecycle & State Machine (`tests/orders.test.ts`)**:
  - Server-side total calculation, price snapshotting, line-item consolidation.
  - Strict state machine transitions (`pending` -> `paid` -> `shipped` -> `delivered`).
  - Restocking of product inventory upon deletion of pending orders (`204 No Content`).

To validate TypeScript compilation and build output:
```bash
npm run typecheck
npm run build
```

---

## 5. API Reference & Documentation

Base URL: `https://ecommerce-api-xidz.onrender.com/api/v1` (or `http://localhost:4000/api/v1`)

### 1. Healthcheck
- **Method / Path**: `GET /healthz` (also available at `GET /api/v1/healthz`)
- **Exempt from Rate Limiting**: Yes
- **Curl Example**:
  ```bash
  curl -i https://ecommerce-api-xidz.onrender.com/healthz
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-09-20T21:48:32.469Z"
  }
  ```

---

### 2. List Products (Paginated, Filterable, Sortable)
- **Method / Path**: `GET /api/v1/products`
- **Query Parameters**:
  | Parameter | Type | Default | Clamped Max | Description |
  |---|---|---|---|---|
  | `limit` | integer | `20` | `100` | Items per page (values >100 clamped to 100) |
  | `offset` | integer | `0` | — | Zero-indexed offset (negative values return `400`) |
  | `categoryId` | UUID | — | — | Filter by category ID |
  | `minPrice` | integer | — | 2147483647 | Minimum price in kobo (negative returns `400`) |
  | `maxPrice` | integer | — | 2147483647 | Maximum price in kobo (`minPrice > maxPrice` returns `400`) |
  | `inStock` | boolean | — | — | `true` (stock > 0) or `false` (stock = 0) |
  | `sort` | string | `"createdAt"` | — | Whitelisted: `price`, `createdAt`, `name`, `stockQuantity` |
  | `order` | string | `"desc"` | — | `asc` or `desc` |
- **Curl Example**:
  ```bash
  curl -i "https://ecommerce-api-xidz.onrender.com/api/v1/products?limit=2&offset=0&inStock=true&sort=price&order=asc"
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "data": [
      {
        "id": "7fa12a10-22c9-4630-ad57-149d2332f430",
        "categoryId": "53f2fc10-4257-4679-9dae-a78504d5a8c9",
        "name": "Mechanical Keyboard 1",
        "description": "Ergonomic keyboard [Electronics]",
        "price": 2650000,
        "currency": "NGN",
        "stockQuantity": 22,
        "createdAt": "2026-09-16T05:00:00.000Z",
        "updatedAt": "2026-09-16T05:00:00.000Z",
        "category": {
          "id": "53f2fc10-4257-4679-9dae-a78504d5a8c9",
          "name": "Electronics"
        }
      }
    ],
    "meta": {
      "total": 391,
      "limit": 2,
      "offset": 0,
      "hasMore": true
    }
  }
  ```

---

### 3. Get Single Product
- **Method / Path**: `GET /api/v1/products/:id`
- **Curl Example**:
  ```bash
  curl -i https://ecommerce-api-xidz.onrender.com/api/v1/products/7fa12a10-22c9-4630-ad57-149d2332f430
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "data": {
      "id": "7fa12a10-22c9-4630-ad57-149d2332f430",
      "categoryId": "53f2fc10-4257-4679-9dae-a78504d5a8c9",
      "name": "Mechanical Keyboard 1",
      "description": "Ergonomic keyboard [Electronics]",
      "price": 2650000,
      "currency": "NGN",
      "stockQuantity": 22,
      "createdAt": "2026-09-16T05:00:00.000Z",
      "updatedAt": "2026-09-16T05:00:00.000Z",
      "category": { "id": "53f2fc10-4257-4679-9dae-a78504d5a8c9", "name": "Electronics" }
    }
  }
  ```

---

### 4. List Categories
- **Method / Path**: `GET /api/v1/categories`
- **Query Parameters**: `limit` (default 20, max 100), `offset` (default 0)
- **Curl Example**:
  ```bash
  curl -i "https://ecommerce-api-xidz.onrender.com/api/v1/categories?limit=5&offset=0"
  ```

---

### 5. Products in a Category
- **Method / Path**: `GET /api/v1/categories/:id/products`
- **Curl Example**:
  ```bash
  curl -i "https://ecommerce-api-xidz.onrender.com/api/v1/categories/53f2fc10-4257-4679-9dae-a78504d5a8c9/products?limit=10"
  ```

---

### 6. Create Order (Transactional & Race-Safe)
- **Method / Path**: `POST /api/v1/orders`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "customerId": "0385bf56-a36c-48c8-b574-8b89813fc104",
    "items": [
      { "productId": "7fa12a10-22c9-4630-ad57-149d2332f430", "quantity": 1 }
    ]
  }
  ```
- **Curl Example**:
  ```bash
  curl -i -X POST https://ecommerce-api-xidz.onrender.com/api/v1/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"0385bf56-a36c-48c8-b574-8b89813fc104","items":[{"productId":"7fa12a10-22c9-4630-ad57-149d2332f430","quantity":1}]}'
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "data": {
      "id": "e812d4a0-52f1-4b10-8b1e-01293a4b9012",
      "customerId": "0385bf56-a36c-48c8-b574-8b89813fc104",
      "status": "pending",
      "totalAmount": 2650000,
      "currency": "NGN",
      "createdAt": "2026-09-20T21:50:00.000Z",
      "customer": { "id": "0385bf56-a36c-48c8-b574-8b89813fc104", "name": "Ada Okafor", "email": "ada.okafor@example.com" },
      "items": [
        {
          "id": "item-uuid-1",
          "productId": "7fa12a10-22c9-4630-ad57-149d2332f430",
          "quantity": 1,
          "unitPrice": 2650000,
          "product": { "id": "7fa12a10-22c9-4630-ad57-149d2332f430", "name": "Mechanical Keyboard 1", "price": 2650000 }
        }
      ]
    }
  }
  ```

---

### 7. Update Order Status (State Machine)
- **Method / Path**: `PATCH /api/v1/orders/:id`
- **Allowed Transitions**:
  - `pending` ➔ `paid`, `cancelled`
  - `paid` ➔ `shipped`, `cancelled`
  - `shipped` ➔ `delivered`
  - Same-status transition is an idempotent `200 OK` no-op.
  - Illegal transitions return `409 Conflict`.
- **Curl Example**:
  ```bash
  curl -i -X PATCH https://ecommerce-api-xidz.onrender.com/api/v1/orders/e812d4a0-52f1-4b10-8b1e-01293a4b9012 \
    -H "Content-Type: application/json" \
    -d '{"status":"paid"}'
  ```

---

### 8. Delete Pending Order (Restocks Inventory)
- **Method / Path**: `DELETE /api/v1/orders/:id`
- **Rules**: Only `pending` orders can be deleted. Restocks quantities back to product catalog. Non-pending deletion returns `409 Conflict`.
- **Curl Example**:
  ```bash
  curl -i -X DELETE https://ecommerce-api-xidz.onrender.com/api/v1/orders/e812d4a0-52f1-4b10-8b1e-01293a4b9012
  ```
- **Response**: `204 No Content` (Empty body).

---

## 6. Error Codes & Honest Statuses

| HTTP Status | Error Code | Trigger Condition |
|---|---|---|
| `400 Bad Request` | `BAD_REQUEST` | Malformed JSON, negative offset, limit <= 0, invalid sort field, inverted price range, malformed UUID route param |
| `404 Not Found` | `NOT_FOUND` | Valid-format UUID not found in database, or unmapped route |
| `409 Conflict` | `CONFLICT` | Insufficient inventory for product, illegal state transition, attempting to delete non-pending order |
| `413 Payload Too Large` | `PAYLOAD_TOO_LARGE` | Request payload exceeds 100kb limit |
| `422 Unprocessable Entity` | `VALIDATION_ERROR` | Request body validation failure or missing required fields (with field-level error breakdown) |
| `429 Too Many Requests` | `RATE_LIMITED` | Rate limit quota exceeded (returns `Retry-After` header) |
| `500 Internal Server Error` | `INTERNAL_ERROR` | Unexpected server failure (opaque message; stack trace masked and logged with correlation ID) |

---

## 7. Defence Questions & Prepared Answers

#### 1. Why did you choose offset or cursor pagination, and when would the other be better?
> **Answer**: We chose **offset pagination** because this is an e-commerce catalog application where buyers expect numbered page navigation ("Page 1, 2, 3... 20"), arbitrary page jumping, and total item counts. Offset pagination naturally supports `COUNT(*)` and arbitrary offsets. Cursor pagination would be strictly superior in high-velocity append-only streams (like real-time chat, order event audit logs, or social media feeds) to eliminate pagination drift (skipping/duplicating items when new records are inserted during paging) and to eliminate the O(N) database scan penalty when paging hundreds of thousands of rows deep.

#### 2. What happens if I request page 50 of a resource that has 30 pages?
> **Answer**: The API returns an **HTTP 200 OK** with an empty data array (`"data": []`) and `"hasMore": false`:
> ```json
> {
>   "data": [],
>   "meta": { "total": 400, "limit": 20, "offset": 1000, "hasMore": false }
> }
> ```
> It does **not** return a 404, because the endpoint and parameters are completely valid—the query simply matched 0 remaining records.

#### 3. Show me where your rate limit number lives and tell me why it lives there.
> **Answer**: The rate limit values live in the configuration module at [`src/config/index.ts`](src/config/index.ts), read from `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` in environment variables:
> ```typescript
> export const config = configSchema.parse({
>   rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
>   rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
>   // ...
> });
> ```
> They live in configuration (never hardcoded in route handlers) so DevOps and infrastructure operators can adjust thresholds dynamically across environments (e.g. testing vs staging vs production) or respond to active DDoS traffic without modifying application source code or triggering code rebuilds.

#### 4. I want to add a field to the product resource without breaking existing clients. Walk me through it.
> **Answer**: We follow an additive, backward-compatible rollout:
> 1. **Database Migration**: Add the new column as nullable (`brand String?`) or with a database-level `DEFAULT` value so existing product rows remain valid.
> 2. **Prisma & Types**: Update the Prisma schema and run `prisma generate`.
> 3. **API Serialization**: Include the field in the product response. Existing clients adhering to REST conventions ignore unexpected fields and continue functioning without interruption.
> 4. **Query Filters**: If the field is made filterable/sortable, add it to the whitelist in `product.schema.ts` without modifying or removing existing sort keys.

---

## 8. Evidence & Live Verification

All requirements have been empirically verified against the **live deployed URL** (`https://ecommerce-api-xidz.onrender.com`):

### 1. Paginated Response from Live Terminal
```bash
curl -s -i "https://ecommerce-api-xidz.onrender.com/api/v1/products?limit=2&offset=0"
```
```http
HTTP/1.1 200 OK
ratelimit-limit: 100
ratelimit-remaining: 99
ratelimit-reset: 60
x-request-id: 2c2f3f47-a050-4ad7-ba69-973d35fecb05

{"data":[{"id":"00b8a8f8-ad24-4c31-bd81-2ed3bd89f45a","name":"Frozen Ceramic Hat 108","price":11719557,"currency":"NGN","stockQuantity":49,"category":{"name":"Books & Stationery"}},{"id":"01f5607a-6b3e-43c4-9a67-e56e4741c675","name":"Oriental Marble Bacon 274","price":29405339,"currency":"NGN","stockQuantity":32,"category":{"name":"Board Games"}}],"meta":{"total":400,"limit":2,"offset":0,"hasMore":true}}
```

### 2. Live Rate Limit Response (HTTP 429 with Retry-After)
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json; charset=utf-8

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}
```

### 3. Consumer Application Screenshots
- **Catalog View**: [`evidence/consumer_app_loaded.png`](evidence/consumer_app_loaded.png) (demonstrates pagination, price formatting, in-stock badges)
- **Filtered View**: [`evidence/consumer_app_filtered.png`](evidence/consumer_app_filtered.png) (demonstrates dynamic category filtering and active filter state)
- **Session Video**: [`evidence/consumer_session_recording.webp`](evidence/consumer_session_recording.webp)

### 4. Repeatable Seed Script
- Located at [`prisma/seed.ts`](prisma/seed.ts).
- Deterministic with `faker.seed(42)`.
- Generates 40 categories, 400 products (including deliberate out-of-stock items), 400 customers, and 800 orders distributed across all 5 statuses.

---

## 9. Submission Checklist

- [x] **Repository**:
  - [x] Runs from a fresh clone using only the README.
  - [x] `.env` was never committed (`git log -p -- .env` confirmed empty).
  - [x] `.env.example` present and documented.
  - [x] Incremental commit history across all development phases.
  - [x] Nothing outside the brief was built (no authentication, no admin panel).
- [x] **Documentation**:
  - [x] All 5 resources specified in Step 1 tables with types, requirements, and UUID v4 identifiers.
  - [x] "Design Decisions" section comprehensively explains resources, identifiers, offset vs cursor, envelopes, and money.
  - [x] All 4 defence questions answered in full.
  - [x] Every endpoint documented with query parameters, types, defaults, curl commands, and responses.
- [x] **Verification**:
  - [x] Automated test suite passing with 44/44 tests.
  - [x] Deployed live URL verified on Render.
  - [x] Consumer client verified connecting exclusively to the live public API.
- [x] **Post**:
  - [x] Ready-to-publish engineering post in [`evidence/LINKEDIN_POST.md`](evidence/LINKEDIN_POST.md) teaching system design tradeoffs with live URLs and pasteable curl commands.
