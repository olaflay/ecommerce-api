# ApexRide: The Seven Hard Architectural Decisions

This document formally details the trade-offs, security considerations, and structural invariants that govern the ApexRide schema. Every answer is grounded in high-concurrency production requirements.

---

## 1. Normalization vs. Deliberate Denormalization

### Where one fact lives:
In standard Third Normal Form (3NF), a driver's current full name lives exclusively in `Driver.fullName`, and a vehicle's license plate lives in `Vehicle.licensePlate`. 

### The Two Deliberate Denormalizations:

#### Denormalization 1: Snapshotted Driver & Vehicle Identity on `Trip`
- **Fields Added to `Trip`:** `driverNameSnapshot`, `driverPhoneSnapshot`, `vehiclePlateSnapshot`, `vehicleModelSnapshot`.
- **The Failure Mode of Pure 3NF:** If a trip completed in 2024 dynamically joins to `Driver` and `Vehicle` to display the receipt or audit law-enforcement requests in 2026, any subsequent update to `Driver.fullName` (e.g. legal marriage name change) or `Driver.phoneNumber` (e.g. SIM swap) or vehicle reassignment retroactively rewrites history. A police investigation requesting: *"Who drove passenger Jane Doe on October 12th in vehicle KJA-492-AA?"* would return incorrect or corrupted retrospective data.
- **Decision:** When a trip is accepted, the driver's current name, phone, and vehicle plate are permanently copied into `Trip` as immutable snapshot attributes. The historical trip record is self-contained and tamper-proof.

#### Denormalization 2: Driver Rating Aggregate on `Driver`
- **Field Added to `Driver`:** `rating DECIMAL(3, 2)` and `totalTrips INTEGER`.
- **The Failure Mode of Pure 3NF:** When dispatching rides to 50 candidate drivers within a 3km radius, calculating `SELECT AVG(rating) FROM "Review" WHERE "driverId" = ?` for each candidate driver executes 50 aggregated table scans on the high-write `Review` table on every single ride request.
- **Decision:** We store the rolling average directly on `Driver` and asynchronously update it via a background event when a new review is inserted. The read path remains an $O(1)$ single-row lookup.

---

## 2. Monetary Integrity: Integer Minor Units & Currency

### The Rule:
> **Every monetary value is stored as an `INTEGER` (or `BIGINT`) in minor currency units (kobo for NGN, cents for USD, pence for GBP). Floating-point (`FLOAT`, `DOUBLE`) and unstructured `DECIMAL` types are strictly forbidden for storage of currency amounts.**

### The Justification:
1. **IEEE 754 Floating-Point Inexactness:** Floating-point arithmetic introduces binary rounding errors (e.g. `0.1 + 0.2 === 0.30000000000000004`). In financial accounting, these rounding fractions compound into unreconcilable ledger variances across millions of transactions.
2. **Explicit Currency Column:** In `FareReceipt`, `currency VARCHAR(3)` accompanies every financial column (`baseFareMinor`, `totalFareMinor`, `driverEarningsMinor`). Storing amounts without an explicit ISO 4217 code creates catastrophic bugs when expanding into multi-currency markets (e.g., treating 5,000 NGN as 5,000 USD).

---

## 3. Status Lifecycle & Strict State Machine

Entities with lifecycles must have deterministic transition graphs. 

### State Machine Transition Table:

| Current Status | Allowed Next Status | Disallowed / Forbidden Next Status | Triggering Action |
|---|---|---|---|
| `requested` | `driver_assigned`, `cancelled_by_rider` | `in_progress`, `completed`, `driver_arriving` | Driver accepts, or rider cancels before match. |
| `driver_assigned`| `driver_arriving`, `cancelled_by_rider`, `cancelled_by_driver` | `completed`, `in_progress`, `requested` | Driver begins transit to pickup. |
| `driver_arriving`| `in_progress`, `cancelled_by_rider`, `cancelled_by_driver` | `requested`, `completed` | Driver arrives at pin and verifies passenger. |
| `in_progress` | `completed` | `requested`, `driver_assigned`, `cancelled_by_rider` | Driver drops off rider at destination. |
| `completed` | **NONE (Terminal)** | Any other status | Trip is finished; billing is finalized. |
| `cancelled_by_rider`| **NONE (Terminal)** | Any other status | Cancelled with cancellation fee if applicable. |
| `cancelled_by_driver`| **NONE (Terminal)** | Any other status | Driver cancellation logged for reliability audit. |

### The Non-Obvious Forbidden Transition:
> **A trip in `in_progress` CANNOT be cancelled by the rider (`cancelled_by_rider`).**

If a rider attempts to cancel while the car is moving at 60 km/h on an expressway, allowing `cancelled_by_rider` creates severe safety and payment fraud vulnerabilities (the rider evades the fare while inside the vehicle). The rider can request an early drop-off, which triggers a premature `completed` transition with recalculation of distance and time fare, but never a cancellation.

### Enforcement:
Enforced in application services via atomic optimistic-concurrency updates (`UPDATE "Trip" SET status = 'in_progress' WHERE id = ? AND status = 'driver_arriving'`) and validated with PostgreSQL check triggers.

---

## 4. Time & Soft-Delete Compliance

### The Rules:
1. Every entity carries `createdAt TIMESTAMPTZ` and `updatedAt TIMESTAMPTZ`.
2. `Rider` and `Driver` entities have a nullable `deletedAt TIMESTAMPTZ` column.

### Soft vs. Hard Delete Justification:
- **`Rider` and `Driver` (Soft Deleted):** Under GDPR Article 17 and NDPR (Right to be Forgotten), when a user requests account deletion, we set `deletedAt = NOW()`, scrub personal identifiers (`fullName = 'Deleted User'`, `email = 'deleted-uuid@apexride.internal'`), but **preserve the database row and its foreign key relations**.
- **Why Hard Delete Fails:** Hard-deleting a driver or rider cascades and destroys historical `Trip` and `FareReceipt` records. Tax law and financial regulatory compliance mandates that commercial transaction records and VAT/WHT receipts be maintained for a statutory minimum of 6 to 7 years.
- **`Trip` and `FareReceipt` (Strictly Immutable, Hard-Delete Forbidden):** Financial ledger entries and trip safety logs are append-only. There is no `deletedAt` column on `FareReceipt`; rows are never deleted. Adjustments are handled via credit notes or refund receipt rows.

---

## 5. Non-Sequential Generated Identifiers (UUIDs)

### The Rule:
> **All primary keys use UUID (Universally Unique Identifier) format (`uuid_generate_v4()` or UUIDv7), never auto-incrementing sequential integers (`SERIAL` / `BIGINT AUTO_INCREMENT`).**

### Security & Operational Justifications:
1. **Enumeration Attack Prevention:** Sequential IDs allow competitors or malicious actors to scrape and quantify company metrics by polling sequential numbers (`/api/v1/trips/1000` vs `/api/v1/trips/1001` proves the platform had exactly one trip in that interval).
2. **Horizontal Distributed Scaling:** UUIDs can be safely generated on client nodes or microservice instances before communicating with the database, eliminating the single write-bottleneck of an auto-increment sequence coordinator across database shards.

---

## 6. Database Storage Constraints & Forbidden Invalid States

Database constraints provide the final defense line when application code or concurrent processes fail.

| Constraint Name | Target Table | Type | Impossible Invalid State Enforced |
|---|---|---|---|
| `unique_rider_single_active_trip` | `Trip` | Partial Unique Index | **Prevents a rider from having two concurrent active trips.** Enforces: `CREATE UNIQUE INDEX ... ON "Trip"("riderId") WHERE status IN ('requested', 'driver_assigned', 'driver_arriving', 'in_progress');` |
| `unique_driver_single_active_trip` | `Trip` | Partial Unique Index | **Prevents a driver from accepting two concurrent active trips.** Enforces: `CREATE UNIQUE INDEX ... ON "Trip"("driverId") WHERE status IN ('driver_assigned', 'driver_arriving', 'in_progress');` |
| `check_trip_fare_non_negative` | `FareReceipt` | Check Constraint | **Prevents negative fares or negative platform fee calculations.** (`totalFareMinor >= 0 AND driverEarningsMinor >= 0`). |
| `check_review_rating_range` | `Review` | Check Constraint | **Prevents invalid star ratings outside 1 to 5.** (`rating >= 1 AND rating <= 5`). |
| `unique_trip_review` | `Review` | Unique Constraint | **Prevents duplicate reviews for the same trip.** (`tripId UNIQUE`). |
| `check_review_completed_trip_only` | `Review` | Foreign Key + Validation | **Prevents writing a review for an uncompleted or cancelled trip.** |

---

## 7. Indexing Strategy for the Five Core Actions

Every query serving a core user action is backed by an index specifically constructed to prevent table scans:

| Core Action | Query Executed | Index Serving Query | Index Definition |
|---|---|---|---|
| **Action 1:** Request Trip | Validate active trip count for rider | `idx_trip_rider_active` | `CREATE INDEX ON "Trip"("riderId") WHERE status IN ('requested', 'driver_assigned', 'driver_arriving', 'in_progress');` |
| **Action 2:** Driver Accept | Geospatial lookup of nearby available drivers | `idx_driver_status_geo` | `CREATE INDEX ON "Driver"("status", "currentLat", "currentLng") WHERE status = 'available';` |
| **Action 3:** Driver Start | Lookup active trip by driver ID | `idx_trip_driver_active` | `CREATE INDEX ON "Trip"("driverId") WHERE status IN ('driver_assigned', 'driver_arriving');` |
| **Action 4:** Complete & Bill | Look up trip, compute fare receipt | `idx_fare_receipt_trip` | `CREATE UNIQUE INDEX ON "FareReceipt"("tripId");` |
| **Action 5:** Rider Review | Fetch completed trips eligible for review | `idx_trip_rider_completed` | `CREATE INDEX ON "Trip"("riderId", "completedAt" DESC) WHERE status = 'completed';` |
