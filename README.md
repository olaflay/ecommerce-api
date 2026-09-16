# E-Commerce Catalog & Ordering Platform — REST API & Consumer Client

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-1B222D.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/Tests-43%2F43%20Passing-success.svg)](https://vitest.dev/)

A production-grade REST API modeling a complete e-commerce catalog and transactional ordering system, backed by PostgreSQL and Prisma ORM, paired with a resilient React consumer client.

---

## 1. System Overview & Architecture

The system implements a strict layered architecture (`Routes` → `Controllers` → `Services` → `Database`) designed for enterprise reliability:

- **Strict Separation of Concerns**: Controllers only unmarshal requests and format responses; services encapsulate all business rules and database transactions; Zod handles request validation.
- **Pessimistic Concurrency & Stock Integrity**: Concurrent order creation locks inventory rows via `SELECT ... FOR UPDATE` inside an interactive transaction, preventing overselling under high concurrency.
- **Storage-Level Invariants**: Storage-level PostgreSQL `CHECK` constraints enforce non-negative stock (`stockQuantity >= 0`) and positive prices (`price > 0`).
- **Standardized Response Envelopes**: All API responses follow standard collection, single-item, or error envelopes with closed error codes.
- **Request Tracing**: End-to-end request correlation via `X-Request-Id` UUID v4 headers.
- **Security Hardening**: Helmet security headers, CORS allowlist, request body size limits (`100kb`), and configuration-driven rate limiting with `Retry-After` headers.
- **Frontend Consumer Client**: Vite + React single-page application with cold-start detection, request abortion (`AbortController`) to guard against stale responses, and bound-checked pagination.

Detailed topology, ERDs, and locking models are documented in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) and [ecommerce-api-prd.md](ecommerce-api-prd.md).

---

## 2. Key Architectural Decisions

| Decision | Specification | Rationale |
|---|---|---|
| **Money Representation** | Integer minor units (kobo, NGN) | Floats cause rounding and precision drift. Integer minor units are exact across DB, business logic, and API contracts. |
| **Identity Strategy** | UUID v4 (`db.Uuid`) | Eliminates resource enumeration and ID-scraping attacks. |
| **Stock Row-Level Locking** | `SELECT ... FOR UPDATE` | Prevents race conditions during simultaneous checkout attempts for the last unit of stock. |
| **Order State Machine** | Strict transitions: `pending -> paid\|cancelled`, `paid -> shipped\|cancelled`, `shipped -> delivered` | Enforces real-world e-commerce fulfillment boundaries. Idempotent same-status PATCH returns `200` no-op. |
| **Order Deletion Restock** | Restricted to `pending` orders; restocks item inventory before deletion | Released inventory is safely returned to the catalog without data loss. Returns `204 No Content` with zero body. |
| **Seed Idempotency** | Destructive clean-and-regenerate with `faker.seed(42)` | Guarantees exact, reproducible volumes (40 categories, 400 products, 400 customers, 800 orders) with zero drift. |
| **Pagination & Clamping** | `limit` (default 20, max 100, clamped if >100), `offset` (default 0) | Guards against runaway queries (`limit=5000` clamped to 100). Secondary tiebreaker (`id asc`) prevents pagination drift. |
| **Information Shielding** | Opaque `500 INTERNAL_ERROR` envelope | Full stack traces and database errors are logged server-side with correlation IDs and never exposed to clients. |

Every design judgment is cataloged in [DECISIONS.md](DECISIONS.md).

---

## 3. Quickstart & Local Setup

### Prerequisites
- Node.js 20+ installed
- Docker (for PostgreSQL container) or a running local PostgreSQL instance

### 1. Clone & Install
```bash
git clone <REPO_URL>
cd "ecommerce api"
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
DATABASE_URL=postgres://postgres:postgres@localhost:5434/bootcamp_ecommerce?connection_limit=5
PORT=4000
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Database Migration & Seeding
Start PostgreSQL (or use existing Docker container `ecommerce-pg`):
```bash
# Apply migrations (including check constraints)
npm run prisma:deploy

# Run idempotent seed script (Faker seed 42)
npm run seed
```

### 4. Running the Application
```bash
# Start backend API (with hot reload on port 4000)
npm run dev

# In another terminal, start consumer client (port 5173)
cd consumer
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 4. Testing & Verification

Run the comprehensive test suite with Vitest:
```bash
npm test
```

### Automated Test Coverage (43 Tests across 5 Suites):
- **Scaffold & Security (`tests/app.test.ts`)**:
  - `GET /healthz` and `/api/v1/healthz` return 200.
  - Unmatched routes return 404 with standard error envelope.
  - Malformed JSON payloads return 400 `BAD_REQUEST`.
  - Forced 500 runtime errors mask stack traces and internal details.
- **Database Constraints & Tracing (`tests/constraints.test.ts`)**:
  - Direct insert of negative `stockQuantity` blocked by DB constraint.
  - Direct insert of non-positive `price` blocked by DB constraint.
  - `X-Request-Id` correlation header verified on all responses.
- **Concurrency & Race Conditions (`tests/concurrency.test.ts`)**:
  - Two parallel requests fired simultaneously for the last stock unit (`stockQuantity: 1`).
  - Confirms exactly 1 winner (`201 Created`) and 1 loser (`409 Conflict`), leaving stock at 0 (never negative).
- **Catalog & Querying (`tests/catalog.test.ts`)**:
  - Category list pagination, limit clamping (`limit=5000` clamped to 100), negative offset rejection.
  - Product filtering (`minPrice`, `maxPrice`, `inStock`), inverted range rejection (`minPrice > maxPrice` -> 400).
  - Whitelist sorting, multi-sort parameter rejection, UUID format validation.
- **Order Lifecycle (`tests/orders.test.ts`)**:
  - Order placement with server-computed totals and snapshotted prices.
  - Duplicate line item consolidation.
  - State machine transition verification and illegal transition rejection (409).
  - Deletion of pending orders with automatic inventory restocking.

Typecheck and build validation:
```bash
npm run typecheck
npm run build
```

---

## 5. API Reference

Base URL: `http://localhost:4000/api/v1` (or deployed URL)

### Health Check
```bash
curl -i http://localhost:4000/healthz
```
```json
{
  "status": "ok",
  "timestamp": "2026-09-16T05:00:00.000Z"
}
```

### List Products (Paginated, Filterable, Sortable)
```bash
curl -i "http://localhost:4000/api/v1/products?limit=10&offset=0&inStock=true&sort=price&order=asc"
```
```json
{
  "data": [
    {
      "id": "7fa12a10-22c9-4630-ad57-149d2332f430",
      "name": "Mechanical Keyboard 1",
      "description": "Ergonomic keyboard [Electronics]",
      "price": 2650000,
      "currency": "NGN",
      "stockQuantity": 22,
      "categoryId": "53f2fc10-4257-4679-9dae-a78504d5a8c9",
      "category": { "id": "53f2fc10-4257-4679-9dae-a78504d5a8c9", "name": "Electronics" },
      "createdAt": "2026-09-16T05:00:00.000Z",
      "updatedAt": "2026-09-16T05:00:00.000Z"
    }
  ],
  "meta": {
    "total": 391,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

### Get Single Product
```bash
curl -i http://localhost:4000/api/v1/products/<PRODUCT_UUID>
```

### List Categories
```bash
curl -i "http://localhost:4000/api/v1/categories?limit=20&offset=0"
```

### Products in a Category
```bash
curl -i "http://localhost:4000/api/v1/categories/<CATEGORY_UUID>/products"
```

### Create an Order (Transactional)
```bash
curl -i -X POST http://localhost:4000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "<CUSTOMER_UUID>",
    "items": [
      { "productId": "<PRODUCT_UUID_1>", "quantity": 2 },
      { "productId": "<PRODUCT_UUID_2>", "quantity": 1 }
    ]
  }'
```
Response (`201 Created`):
```json
{
  "data": {
    "id": "e812d4a0-52f1-4b10-8b1e-01293a4b9012",
    "customerId": "<CUSTOMER_UUID>",
    "status": "pending",
    "totalAmount": 5300000,
    "currency": "NGN",
    "createdAt": "2026-09-16T05:00:00.000Z",
    "customer": { "id": "...", "name": "Ada Okafor", "email": "ada.okafor@example.com" },
    "items": [
      {
        "id": "...",
        "productId": "<PRODUCT_UUID_1>",
        "quantity": 2,
        "unitPrice": 2650000,
        "product": { "id": "...", "name": "Mechanical Keyboard 1", "price": 2650000 }
      }
    ]
  }
}
```

### Update Order Status (State Machine)
```bash
curl -i -X PATCH http://localhost:4000/api/v1/orders/<ORDER_UUID> \
  -H "Content-Type: application/json" \
  -d '{ "status": "paid" }'
```

### Delete Pending Order (Restocks Inventory)
```bash
curl -i -X DELETE http://localhost:4000/api/v1/orders/<ORDER_UUID>
```
Response: `204 No Content` (Empty body).

---

## 6. Error Envelope & Status Codes

All non-2xx responses adhere to the standard error envelope:
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Insufficient stock for product \"Mechanical Keyboard 1\". Requested: 50, Available: 22"
  }
}
```

### Closed Error Codes:
- `BAD_REQUEST` (400): Malformed query, invalid sort, inverted range, malformed UUID, malformed JSON.
- `NOT_FOUND` (404): Resource not found or unmapped route.
- `CONFLICT` (409): Insufficient stock, illegal status transition, deleting non-pending order.
- `VALIDATION_ERROR` (422): Schema body validation failure or missing required field.
- `RATE_LIMITED` (429): Rate limit threshold exceeded.
- `INTERNAL_ERROR` (500): Safe unexpected internal error.

---

## 7. Production Deployment Guide (Render / Railway)

1. **Deploy Managed PostgreSQL**:
   - Create a PostgreSQL 16 database.
   - Note the connection string: `postgresql://user:pass@host:5432/db?sslmode=require&connection_limit=5`.
2. **Deploy Backend API**:
   - Set environment variables:
     - `DATABASE_URL` = `<MANAGED_POSTGRES_URL_WITH_SSL_AND_LIMIT>`
     - `PORT` = `4000` (or platform default)
     - `NODE_ENV` = `production`
     - `CORS_ALLOWED_ORIGINS` = `https://<YOUR_CONSUMER_URL>`
     - `RATE_LIMIT_WINDOW_MS` = `60000`
     - `RATE_LIMIT_MAX_REQUESTS` = `100`
   - Build command: `npm install && npm run build`
   - Release command: `npm run prisma:deploy`
   - Seed (run once manually post-deploy): `npm run seed`
   - Start command: `npm start`
3. **Deploy Consumer App**:
   - Set build-time variable: `VITE_API_BASE_URL` = `https://<YOUR_BACKEND_API_URL>`
   - Build command: `npm install && npm run build`
   - Publish directory: `consumer/dist`
