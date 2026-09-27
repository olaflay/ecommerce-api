# ApexRide: API Design & High-Scale Data Modeling

A complete architecture, data model, and API design specification for **ApexRide** — a high-concurrency urban ride-hailing and dispatch platform.

---

## Architecture Artifacts & Documentation Index

| Artifact | Purpose & Core Content |
|---|---|
| [`REQUIREMENTS.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/REQUIREMENTS.md) | Product definition, user personas (Riders, Drivers, Dispatch Operators), and five core user actions. |
| [`ENTITIES.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/ENTITIES.md) | Full entity specifications, field types, nullability, cardinalities, and Mermaid ER diagram. |
| [`HARD_QUESTIONS.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/HARD_QUESTIONS.md) | In-depth analysis of the 7 hard questions: deliberate denormalization, integer minor units, state machines, soft deletes, UUIDs, constraints, and query indexes. |
| [`API_CONTRACTS.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/API_CONTRACTS.md) | Complete REST API endpoint contracts, error envelopes, REST vs. GraphQL over-fetching analysis, and WebSockets vs. SSE real-time telemetry analysis. |
| [`POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/POST.md) | Senior engineering publication on state machine integrity and unexpected forbidden transitions. |

---

## The Seven Hard Architectural Decisions Summary

1. **Deliberate Denormalization:** 
   - Immutable snapshot of driver name, phone, and vehicle plate on `Trip` prevents retrospective data corruption when drivers update account profiles or swap vehicles.
   - Aggregate rolling rating and trip counts stored directly on `Driver` eliminates 50+ table scans during spatial dispatch queries.
2. **Integer Minor Units:** All monetary values stored as integers in kobo/cents with companion ISO 4217 `currency` column (`baseFareMinor`, `totalFareMinor`, `driverEarningsMinor`). Floating-point arithmetic strictly banned.
3. **State Machine Invariants:** Strict transition graph preventing impossible transitions (e.g., rider cannot cancel an `in_progress` trip at 60 km/h; completed trips are strictly terminal).
4. **Soft-Delete Compliance:** `Rider` and `Driver` support soft deletion (`deletedAt`) to satisfy GDPR/NDPR Right to be Forgotten while preserving financial transaction and tax audit trails on immutable append-only `Trip` and `FareReceipt` tables.
5. **UUID Identifiers:** Eliminates sequential enumeration scraping attacks and distributed ID coordination bottlenecks.
6. **Database Storage Constraints:** Partial unique indexes (`idx_rider_single_active_trip`, `idx_driver_single_active_trip`) and PostgreSQL check constraints enforce invariants at the storage layer.
7. **Targeted Indexes:** Composite indexes (`idx_driver_status_geo`, `idx_trip_rider_completed`) ensure zero full table scans on core dispatch and ledger queries.

---

## Empirical Verification & Query Execution Plans

### 1. Verification Test Suite (`npm test`):
All 8 empirical verification tests passed:
- `✓ Action 1: Rider requests a trip (validates rider has no other active trips)`
- `✓ Action 2: Driver accepts dispatch offer (geospatial query for available drivers)`
- `✓ Action 3: Driver arrives and begins trip (checks valid state transition to in_progress)`
- `✓ Action 4: Driver completes trip & queries financial ledger breakdown`
- `✓ Action 5: Rider submits review for completed trip`
- `✓ Constraint Proof 1: Rejects a rider attempting two concurrent active trips (23505)`
- `✓ Constraint Proof 2: Rejects invalid review rating out of bounds (23514)`
- `✓ Constraint Proof 3: Rejects negative fare amounts (23514)`

### 2. Execution Plans (`npm run explain`):
- **Driver Dispatch Match:** `Index Scan using idx_driver_status_geo on "Driver"` — Execution time: **0.249 ms**.
- **Historical Trips & Ledger:** `Index Scan using idx_trip_rider_completed on "Trip"`, `Index Scan using "FareReceipt_tripId_key"` — Execution time: **0.143 ms**.
