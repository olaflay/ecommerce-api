# ApexRide: API Endpoint Contracts & Protocol Analyses

All endpoints are versioned under `/api/v1/` and return consistent JSON envelopes.

## 0. Authentication, Authorisation & Error Envelope

### Authentication
Every endpoint except `GET /healthz` requires a bearer token. The token's subject resolves to exactly one row in `Rider` or `Driver`, and that `id` is the **only** accepted source of the acting user.

**Ownership is never taken from the request body or path.** A client asking for `GET /api/v1/riders/me/trips` has its `riderId` read from its token, not from a `riderId` query parameter. A mismatch is a `403`, never a silently-rescoped query — otherwise any authenticated user could read any other user's trip history, earnings, and reviews by editing a URL.

| Actor | May act on |
|---|---|
| `Rider` | own trips (request, cancel, review), own reviews |
| `Driver` | own trips (accept, arrive, start, complete), own earnings, own reviews received |
| `Admin` (internal only) | read-only across all entities; never used by the mobile clients |

### Error Envelope

Every non-2xx response uses one shape:

```json
{
  "error": {
    "code": "RIDER_HAS_ACTIVE_TRIP",
    "message": "You already have a trip in progress.",
    "details": [
      { "field": "status", "issue": "active trip 7b8d4e92-3c81-49fa-98e3-0d5b4129b872" }
    ]
  }
}
```

`code` is a stable machine-readable token — clients branch on it, never on `message`. `message` is human-readable and may change. Internal detail (stack traces, SQL text, driver errors) is never included; those are logged server-side and correlated by a request id returned in the `X-Request-Id` response header.

### How Database Rejections Surface

Constraints do the enforcing; the API layer translates their SQLSTATE into a public error code. A rejected write never reaches the client as a raw database error.

| SQLSTATE | Enforcing object | HTTP | Public `code` |
|---|---|---|---|
| `23505` | `idx_rider_single_active_trip` | `409` | `RIDER_HAS_ACTIVE_TRIP` |
| `23505` | `idx_driver_single_active_trip` | `409` | `DRIVER_HAS_ACTIVE_TRIP` |
| `23505` | `idx_driver_single_active_vehicle` | `409` | `DRIVER_HAS_ACTIVE_VEHICLE` |
| `23505` | `FareReceipt_tripId_key` | `409` | `TRIP_ALREADY_BILLED` |
| `23505` | `Review_tripId_key` | `409` | `DUPLICATE_REVIEW` |
| `23514` | `check_rating_1_to_5` | `400` | `RATING_OUT_OF_BOUNDS` |
| `23514` | `check_fare_non_negative` | `422` | `INVALID_FARE_AMOUNT` |
| `23514` | `check_fare_ledger_balances` | `422` | `FARE_LEDGER_UNBALANCED` |
| `23514` | `check_trip_driver_required_when_assigned` | `422` | `TRIP_DRIVER_REQUIRED` |
| `23514` | `trg_review_completed_trip_only` | `409` | `TRIP_NOT_COMPLETED` |
| `23503` | any `_fkey` | `404` / `422` | resource-specific |

Two rows above deserve honesty rather than a clean table. **`23505` does not report which index was violated** — the server returns only the conflicting key columns, so the API layer cannot read the index name from the error. It resolves the cause from the statement it just attempted, which is safe precisely because it is the same statement that failed. And `check_review_completed_trip_only` is a **logical** name, not a `pg_constraint` entry: no CHECK can express a cross-table rule, so the trigger raises SQLSTATE `23514` with that token as the first word of its message. Verbatim server messages are in `evidence/constraint-violations.txt`.

---

## 1. The Core Endpoint Contracts

### 1.1 Action 1: Request a Trip (`POST /api/v1/trips`)
- **Method & Path:** `POST /api/v1/trips`
- **Idempotency:** Enforced via `Idempotency-Key` header (UUID).
- **Request Body:**
```json
{
  "pickupLat": 6.5244,
  "pickupLng": 3.3792,
  "pickupAddress": "12 Admiralty Way, Lekki Phase 1, Lagos",
  "dropoffLat": 6.4281,
  "dropoffLng": 3.4219,
  "dropoffAddress": "Victoria Island Financial Center, Lagos",
  "tier": "standard"
}
```
- **Success Response (`201 Created`):**
```json
{
  "data": {
    "id": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "status": "requested",
    "tier": "standard",
    "pickupAddress": "12 Admiralty Way, Lekki Phase 1, Lagos",
    "dropoffAddress": "Victoria Island Financial Center, Lagos",
    "estimatedFareMinor": 350000,
    "currency": "NGN",
    "requestedAt": "2026-09-27T13:45:00.000Z"
  }
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing coordinates or invalid latitude/longitude range.
  - `409 Conflict` (`RIDER_HAS_ACTIVE_TRIP`): Rider already has an active ongoing trip. Database backstop: `idx_rider_single_active_trip`, SQLSTATE `23505`. This is the check that makes a double-tap on the request button produce one trip, not two.
  - `422 Unprocessable Entity`: Pickup and dropoff coordinates are identical.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### 1.2 Action 2: Driver Accepts Trip (`POST /api/v1/trips/:id/accept`)
- **Method & Path:** `POST /api/v1/trips/:id/accept`
- **Idempotency:** Single atomic statement, `UPDATE "Trip" SET status = 'driver_assigned', "driverId" = $1 WHERE id = $2 AND status = 'requested'`. The `status = 'requested'` predicate is the lock: a concurrent accept matches zero rows, so exactly one driver wins. No read-then-write, no `SELECT ... FOR UPDATE` round trip.
- **Database backstops:** `idx_driver_single_active_trip` (`23505`, `DRIVER_HAS_ACTIVE_TRIP`) and `check_trip_driver_required_when_assigned` (`23514`, `TRIP_DRIVER_REQUIRED`).
- **Success Response (`200 OK`):**
```json
{
  "data": {
    "id": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "status": "driver_assigned",
    "driver": {
      "id": "4a1d2e99-1b82-4fbc-b421-9d5b4129a101",
      "fullName": "Babatunde Adeleke",
      "phoneNumber": "+2348023456789",
      "rating": 4.92,
      "vehicle": {
        "model": "Toyota Corolla (Silver)",
        "licensePlate": "KJA-492-AA"
      }
    },
    "acceptedAt": "2026-09-27T13:46:12.000Z"
  }
}
```
- **Error Codes:**
  - `404 Not Found`: Trip ID does not exist.
  - `409 Conflict` (`TRIP_ALREADY_CLAIMED`): Trip has already been accepted by another driver or cancelled by the rider.
  - `409 Conflict` (`DRIVER_HAS_ACTIVE_TRIP`): The driver already holds an active trip. Database backstop: `idx_driver_single_active_trip`, SQLSTATE `23505`.

---

### 1.3 Action 3: Driver Arrives & Begins Trip (`POST /api/v1/trips/:id/start`)
- **Method & Path:** `POST /api/v1/trips/:id/start`
- **Idempotency:** Same guarded-statement pattern as 1.2 — `UPDATE "Trip" SET status = 'in_progress' WHERE id = $1 AND status = 'driver_arriving'`. Replayed or raced requests match zero rows and are rejected, which is what makes the transition fire exactly once. Asserted in `npm test`.
- **Request Body:**
```json
{
  "verificationPin": "4819"
}
```
- **Success Response (`200 OK`):**
```json
{
  "data": {
    "id": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "status": "in_progress",
    "startedAt": "2026-09-27T13:50:00.000Z"
  }
}
```
- **Error Codes:**
  - `400 Bad Request` (`INVALID_VERIFICATION_PIN`): Invalid 4-digit verification PIN.
  - `409 Conflict` (`TRIP_NOT_STARTABLE`): Trip status is not `driver_arriving`.
  - `422 Unprocessable Entity` (`TRIP_DRIVER_REQUIRED`): The trip is in an assigned state with no driver bound. Database backstop: `check_trip_driver_required_when_assigned`, SQLSTATE `23514`.

---

### 1.4 Action 4: Driver Completes Trip & Triggers Billing (`POST /api/v1/trips/:id/complete`)
- **Method & Path:** `POST /api/v1/trips/:id/complete`
- **Request Body:**
```json
{
  "distanceMeters": 14200,
  "durationSeconds": 1940
}
```
- **Money rule:** every `*Minor` field is an integer count of kobo. No float ever appears in this payload; `surgeMultiplier` is the only non-integer and is a dimensionless ratio, not an amount.
- **Success Response (`200 OK`):**
```json
{
  "data": {
    "id": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "status": "completed",
    "completedAt": "2026-09-27T14:22:20.000Z",
    "receipt": {
      "id": "9c1b3f71-2d4e-4f12-8821-4f183921b712",
      "baseFareMinor": 80000,
      "distanceFareMinor": 213000,
      "timeFareMinor": 97000,
      "surgeMultiplier": 1.20,
      "subtotalMinor": 390000,
      "discountMinor": 0,
      "totalFareMinor": 468000,
      "platformFeeMinor": 93600,
      "driverEarningsMinor": 374400,
      "currency": "NGN",
      "paymentStatus": "succeeded"
    }
  }
}
```

The three figures satisfy the ledger identity the database enforces: `468000 = 93600 + 374400`.
- **Error Codes:**
  - `409 Conflict` (`TRIP_NOT_COMPLETABLE`): Trip already marked completed or cancelled.
  - `422 Unprocessable Entity` (`INVALID_TRIP_METRICS`): Reported distance or duration is zero or negative.
  - `409 Conflict` (`TRIP_ALREADY_BILLED`): A receipt already exists for this trip. Database backstop: `FareReceipt_tripId_key`, SQLSTATE `23505`.
  - `422 Unprocessable Entity` (`FARE_LEDGER_UNBALANCED`): The computed split did not satisfy `"totalFareMinor" = "platformFeeMinor" + "driverEarningsMinor"`. Database backstop: `check_fare_ledger_balances`, SQLSTATE `23514`.

---

### 1.5 Action 5: Rider Submits Rating & Review (`POST /api/v1/trips/:id/reviews`)
- **Method & Path:** `POST /api/v1/trips/:id/reviews`
- **Database guarantee:** the trip must be `completed` (`trg_review_completed_trip_only`) and must not already have a review (`Review_tripId_key`).
- **Request Body:**
```json
{
  "rating": 5,
  "comment": "Smooth ride, professional driver, car was air-conditioned."
}
```
- **Success Response (`201 Created`):**
```json
{
  "data": {
    "id": "1d8b392a-4f21-4a11-89d2-7c819231f822",
    "tripId": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "rating": 5,
    "comment": "Smooth ride, professional driver, car was air-conditioned.",
    "createdAt": "2026-09-27T14:25:00.000Z"
  }
}
```
- **Error Codes:**
  - `400 Bad Request`: Rating not an integer between 1 and 5 (`RATING_OUT_OF_BOUNDS`). Database backstop: `check_rating_1_to_5`, SQLSTATE `23514`.
  - `409 Conflict` (`TRIP_NOT_COMPLETED`): Trip status is not `completed`. Database backstop: `trg_review_completed_trip_only`, SQLSTATE `23514`. This holds for all six non-completed statuses, not only cancellations.
  - `409 Conflict` (`DUPLICATE_REVIEW`): A review already exists for this trip. Database backstop: `Review_tripId_key`, SQLSTATE `23505`.

---

## 1A. The Shared List Contract

Every collection endpoint in §1B below follows one contract. Defining it once means a client learns the pagination, filter, and sort rules a single time.

### Query Parameters

| Parameter | Type | Default | Rules |
|---|---|---|---|
| `limit` | integer | `20` | Range `1`–`100`. Values above `100` are **clamped** to `100`, not rejected. Non-integer or unparseable values are a `400`. |
| `offset` | integer | `0` | Minimum `0`. A negative value is **clamped** to `0`, not rejected. |
| `sort` | string | endpoint-specific | Must be one of the endpoint's documented keys. Any other value is a `400` — the parameter is never interpolated into `ORDER BY` unvalidated. |
| `order` | `asc` \| `desc` | `desc` | Ignored unless `sort` is supplied. |
| `status`, `tier`, `paymentStatus`, `rating` | enum / integer | — | Endpoint-specific filters. An unrecognised enum member is a `400`. |

Clamping rather than rejecting is deliberate: a client asking for `limit=500` gets a usable page instead of an error, while a client passing `limit=abc` has a genuine bug and is told so.

### Response Envelope

```json
{
  "data": [ /* ...items... */ ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "returned": 20,
    "total": 137
  }
}
```

`total` is the count of rows matching the **filters**, before `limit`/`offset` are applied — so a client can compute a page count without walking every page.

### Ordering Stability

Offset pagination is only correct if the ordering is **total**, not partial. Every endpoint's default sort therefore carries a unique tiebreaker: the sort key first, then `id ASC` as the final key. Without it, two rows sharing a `completedAt` could swap between page 1 and page 2, and a client walking pages would show one row twice and skip another.

`npm test` asserts this directly: it pages through the completed-trip ledger and requires the pages to be disjoint and their union to equal the unpaged result.

---

## 1B. Collection Endpoints

### 1.6 Rider Trip History (`GET /api/v1/riders/me/trips`)
- **Default sort:** `completedAt desc`
- **Filters:** `status` (any `TripStatus` member)
- **Index:** `idx_trip_rider_status` on `("riderId", status)`
- **Verified by:** Plan 6 in `evidence/query-plans.txt`

### 1.7 Driver Earnings Ledger (`GET /api/v1/drivers/me/earnings`)
- **Default sort:** `completedAt desc`
- **Filters:** `paymentStatus`; only `succeeded` receipts are money the driver has actually been paid
- **Index:** `idx_trip_driver_status` on `("driverId", status)`, joined to `FareReceipt` via `FareReceipt_tripId_key`
- **Verified by:** Plan 7

### 1.8 Vehicle Listings (`GET /api/v1/vehicles`)
- **Default sort:** `year desc`
- **Filters:** `tier` (multi-valued), `isActive`
- **Index:** `idx_vehicle_driver` on `("driverId", "isActive")`
- **Note:** `idx_driver_single_active_vehicle` also applies but is an *enforcement* index, not a lookup path — it is never named in a plan.
- **Verified by:** Plan 8

### 1.9 Reviews for a Driver (`GET /api/v1/drivers/:id/reviews`)
- **Default sort:** `createdAt desc`
- **Filters:** `rating` (minimum star rating)
- **Index:** `idx_review_driver_rating` on `("driverId", rating)`
- **Verified by:** Plan 9

### 1.10 Reviews Written by a Rider (`GET /api/v1/riders/me/reviews`)
- **Default sort:** `createdAt desc`
- **Filters:** none beyond pagination
- **Index:** `idx_review_rider` on `("riderId")`
- **Verified by:** Plan 10

### 1.11 Open Dispatch Offers (`GET /api/v1/trips/requests`)
- **Default sort:** `requestedAt asc` — oldest request first, which is the fairness order for dispatch
- **Filters:** `tier`
- **Index:** `idx_trip_status_requestedAt` on `(status, requestedAt)`
- **Verified by:** Plan 11

### A Note on the Captured Plans

All 11 plans in `evidence/query-plans.txt` chose `Seq Scan`, because every table holds 5 rows. That is the planner making the right call, and the file reports it as-is. Each plan is also captured with `enable_seqscan = off` to demonstrate the index is reachable and correctly shaped for the query — those diagnostic plans are labelled as such.

---

## 2. Over-Fetching Analysis: REST vs. GraphQL

### The Scenario:
Consider a mobile rider home screen that wants to display a compact card for the rider's latest trip: just the date, the destination address, and the total amount paid.

### REST Response (`GET /api/v1/trips/:id`):
```json
{
  "data": {
    "id": "7b8d4e92-3c81-49fa-98e3-0d5b4129b872",
    "riderId": "1a2b3c4d-...",
    "driverId": "4a1d2e99-...",
    "vehicleId": "8f9e0a1b-...",
    "status": "completed",
    "pickupLat": 6.5244,
    "pickupLng": 3.3792,
    "pickupAddress": "12 Admiralty Way, Lekki Phase 1, Lagos",
    "dropoffLat": 6.4281,
    "dropoffLng": 3.4219,
    "dropoffAddress": "Victoria Island Financial Center, Lagos",
    "distanceMeters": 14200,
    "durationSeconds": 1940,
    "driverNameSnapshot": "Babatunde Adeleke",
    "driverPhoneSnapshot": "+2348023456789",
    "vehiclePlateSnapshot": "KJA-492-AA",
    "vehicleModelSnapshot": "Toyota Corolla",
    "requestedAt": "2026-09-27T13:45:00.000Z",
    "acceptedAt": "2026-09-27T13:46:12.000Z",
    "startedAt": "2026-09-27T13:50:00.000Z",
    "completedAt": "2026-09-27T14:22:20.000Z",
    "receipt": {
      "id": "9c1b3f71-...",
      "baseFareMinor": 80000,
      "distanceFareMinor": 213000,
      "timeFareMinor": 97000,
      "surgeMultiplier": 1.20,
      "subtotalMinor": 390000,
      "discountMinor": 0,
      "totalFareMinor": 468000,
      "platformFeeMinor": 93600,
      "driverEarningsMinor": 374400,
      "currency": "NGN",
      "paymentStatus": "succeeded",
      "paymentMethod": "card",
      "paymentReference": "pay_98234129"
    }
  }
}
```
*Payload Weight:* ~1,200 bytes. The client wanted 3 fields, but received 28 fields. The field count is counted from the payload above; the byte figure is an estimate, not a measured transfer.

### GraphQL Query & Response for the Same Need:
```graphql
query GetTripSummary($tripId: ID!) {
  trip(id: $tripId) {
    completedAt
    dropoffAddress
    receipt {
      totalFareMinor
      currency
    }
  }
}
```

**GraphQL Response:**
```json
{
  "data": {
    "trip": {
      "completedAt": "2026-09-27T14:22:20.000Z",
      "dropoffAddress": "Victoria Island Financial Center, Lagos",
      "receipt": {
        "totalFareMinor": 468000,
        "currency": "NGN"
      }
    }
  }
}
```
*Payload Weight:* ~140 bytes (**88% reduction in over-the-air data transfer**). Both figures are estimates from the JSON shown, not measured over a connection.

### Architectural Decision: REST for MVP vs. When to Switch to GraphQL
1. **Current Decision (MVP): Stick with REST.**
   - REST endpoints leverage standard HTTP caching (e.g. `Cache-Control`, `ETags`, edge CDN caches).
   - Tooling, rate limiting, and observability for REST are trivial and well-standardized.
   - For an MVP with under 50,000 active daily users, mobile cellular bandwidth optimization does not justify GraphQL's schema stitching overhead, N+1 query vulnerability risks (Dataloader requirements), and inability to easily cache responses at standard HTTP proxies.
2. **The Exact Threshold to Switch:**
   - We switch when **mobile client surface diversity expands to 3+ distinct clients** (e.g. iOS Passenger app, Android Passenger app, WearOS watch app, and Partner Fleet Portal) with diverging screen real-estate requirements, OR when cellular data telemetry profiling in emerging markets (where 3G mobile data is costly) indicates over-the-air JSON overhead is responsible for >25% of mobile network latency.

---

## 3. Real-Time Telemetry Analysis: WebSockets vs. Server-Sent Events (SSE)

### The Requirement:
During the `driver_assigned` and `driver_arriving` phases, the rider application needs live location coordinates (`lat`, `lng`, `bearing`) of the driver vehicle moving across the map at 2-second intervals.

### Comparison Matrix:

| Dimension | Server-Sent Events (SSE) | WebSockets (WS) |
|---|---|---|
| **Directionality** | Unidirectional (Server -> Client only) | Bidirectional (Full duplex) |
| **Protocol** | Standard HTTP/1.1 or HTTP/2 (Text/event-stream) | WebSocket Protocol (`ws://` / `wss://` upgrade) |
| **Auto-Reconnection** | Built-in native browser support with `Last-Event-ID` | Manual implementation required |
| **Proxy & Firewall Traversal** | Bypasses corporate proxies & firewalls seamlessly | Often blocked or terminated by strict corporate proxies/load balancers |
| **HTTP/2 Multiplexing** | Shares single TCP connection with other REST requests | Requires separate dedicated TCP connection per socket |

### Architectural Decision:
> **We use Server-Sent Events (SSE) for the Rider Telemetry Stream (`GET /api/v1/trips/:id/driver-location/stream`).**

### Justification:
1. **The Telemetry Direction is Strictly Asymmetric:** The rider client does not send location data to the server during this phase; the rider only consumes the driver's GPS updates. Unidirectional streaming is a textbook fit for SSE.
2. **Resilience in Poor Mobile Connectivity:** Urban cellular networks frequently drop connections as vehicles drive between cell towers. SSE features built-in browser/mobile client auto-reconnection and native event stream resumption via the `Last-Event-ID` header.
3. **Driver Telemetry Upload:** The driver app uploads GPS coordinates via a periodic HTTP batch mutation (`POST /api/v1/drivers/location-ping`). WebSockets would only be justified if there were real-time in-app multi-party messaging or voice dispatch channels requiring sub-10ms full-duplex socket handshakes.
