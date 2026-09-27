# ApexRide: API Endpoint Contracts & Protocol Analyses

All endpoints are versioned under `/api/v1/` and return consistent JSON envelopes.

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
  - `409 Conflict`: Rider already has an active ongoing trip (`RIDER_HAS_ACTIVE_TRIP`).
  - `422 Unprocessable Entity`: Pickup and dropoff coordinates are identical.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### 1.2 Action 2: Driver Accepts Trip (`POST /api/v1/trips/:id/accept`)
- **Method & Path:** `POST /api/v1/trips/:id/accept`
- **Idempotency:** Natural state transition lock (`status = 'requested'`).
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
  - `409 Conflict`: Trip has already been accepted by another driver or cancelled by the rider (`TRIP_ALREADY_CLAIMED`).

---

### 1.3 Action 3: Driver Arrives & Begins Trip (`POST /api/v1/trips/:id/start`)
- **Method & Path:** `POST /api/v1/trips/:id/start`
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
  - `400 Bad Request`: Invalid 4-digit verification PIN.
  - `409 Conflict`: Trip status is not `driver_arriving`.

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
      "totalFareMinor": 468000,
      "driverEarningsMinor": 374400,
      "currency": "NGN",
      "paymentStatus": "succeeded"
    }
  }
}
```
- **Error Codes:**
  - `409 Conflict`: Trip already marked completed or cancelled.
  - `422 Unprocessable Entity`: Reported distance or duration is zero or negative.

---

### 1.5 Action 5: Rider Submits Rating & Review (`POST /api/v1/trips/:id/reviews`)
- **Method & Path:** `POST /api/v1/trips/:id/reviews`
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
  - `400 Bad Request`: Rating not an integer between 1 and 5 (`RATING_OUT_OF_BOUNDS`).
  - `409 Conflict`: Trip is not completed, or a review has already been submitted for this trip (`DUPLICATE_REVIEW` / `TRIP_NOT_COMPLETED`).

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
*Payload Weight:* ~1,200 bytes. The client wanted 3 fields, but received 28 fields.

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
*Payload Weight:* ~140 bytes (**88% reduction in over-the-air data transfer**).

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
