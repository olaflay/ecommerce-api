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
> **Every monetary value is stored as an `INTEGER` in minor currency units (kobo for NGN, cents for USD, pence for GBP). Floating-point (`FLOAT`, `DOUBLE`) and `NUMERIC`/`DECIMAL` types are strictly forbidden for storage of currency amounts.**

Every money column in `FareReceipt` is `INTEGER NOT NULL` in the deployed schema — `baseFareMinor`, `distanceFareMinor`, `timeFareMinor`, `subtotalMinor`, `discountMinor`, `totalFareMinor`, `platformFeeMinor`, `driverEarningsMinor`.

### The Justification:
1. **IEEE 754 Floating-Point Inexactness:** Floating-point arithmetic introduces binary rounding errors (e.g. `0.1 + 0.2 === 0.30000000000000004`). In financial accounting, these rounding fractions compound into unreconcilable ledger variances across millions of transactions.
2. **Explicit Currency Column:** `currency VARCHAR(3)` accompanies every financial column. Storing amounts without an explicit ISO 4217 code creates catastrophic bugs when expanding into multi-currency markets (e.g. treating 5,000 NGN as 5,000 USD).

### The One Deliberate Exception: `surgeMultiplier`

`surgeMultiplier` is `DECIMAL(3, 2) NOT NULL`, and it is **not** money — it is a dimensionless ratio (1.00 = no surge, 1.50 = 50% surge). A multiplier in minor units would be meaningless. It is never summed or accumulated, so it carries no rounding risk of its own; the `totalFareMinor` it produces is rounded to whole kobo by the pricing service and stored as an integer.

### The Ledger Identity

`FareReceipt` additionally carries a CHECK constraint that makes the split impossible to get wrong:

```
check_fare_ledger_balances
  CHECK (("totalFareMinor" = ("platformFeeMinor" + "driverEarningsMinor")))
```

Whatever the pricing service computes, the amount the rider is charged must equal what the platform retains plus what the driver earns. A receipt where those three disagree cannot be written to the table.

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

### Enforcement — What the Database Actually Enforces

The transition table above is enforced by **atomic optimistic-concurrency updates in the application service**, not by the database:

```sql
UPDATE "Trip" SET status = 'in_progress' WHERE id = $1 AND status = 'driver_arriving';
```

The `WHERE status = ...` guard makes the transition single-shot and replay-safe: a second concurrent request matches zero rows and is rejected, so the state machine cannot be stepped twice. This is a deliberate choice — PostgreSQL CHECK constraints cannot read another row, and a trigger per transition edge would add write-path overhead to the highest-frequency table in the system for a rule the application already enforces atomically.

**The database does enforce the *preconditions* that make the table legal**, via these objects that exist in the deployed catalog (`evidence/ddl-inventory.txt`):

| Object | Target | What it makes impossible |
|---|---|---|
| `check_trip_driver_required_when_assigned` | `Trip` | A trip in `driver_assigned`, `driver_arriving`, `in_progress`, or `completed` with a `NULL` `driverId`. An assigned trip always names the driver who holds it. |
| `idx_driver_single_active_trip` | `Trip` | A driver holding two active trips. Because the predicate covers the three assigned/active statuses, a driver cannot accept a second dispatch while one is in flight. |

**Not enforced by the database:** the terminality of `completed`, `cancelled_by_rider`, and `cancelled_by_driver`. Nothing in the schema stops a row from being updated out of a terminal status. That guarantee is the application's, and it is asserted by the test suite rather than by a constraint.

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

**Every name in the tables below is quoted verbatim from `evidence/ddl-inventory.txt`**, which is generated by querying `pg_constraint`, `pg_indexes`, and `pg_trigger` on the deployed database. If a name here does not appear in that file, the name is wrong.

### Business-rule constraints and indexes

| Object Name | Target | Type | Impossible Invalid State Enforced |
|---|---|---|---|
| `idx_rider_single_active_trip` | `Trip` | Partial Unique Index | **A rider cannot have two concurrent active trips.** `CREATE UNIQUE INDEX ... ON "Trip"("riderId") WHERE status IN ('requested', 'driver_assigned', 'driver_arriving', 'in_progress');` |
| `idx_driver_single_active_trip` | `Trip` | Partial Unique Index | **A driver cannot hold two concurrent active trips.** `... ON "Trip"("driverId") WHERE status IN ('driver_assigned', 'driver_arriving', 'in_progress');` |
| `idx_driver_single_active_vehicle` | `Vehicle` | Partial Unique Index | **A driver cannot own two simultaneously active vehicles.** `... ON "Vehicle"("driverId") WHERE "isActive";` Retired vehicles are outside the predicate, so a driver keeps their full vehicle history. |
| `check_trip_driver_required_when_assigned` | `Trip` | Check Constraint | **A trip that names a driver must actually have one.** `status NOT IN ('driver_assigned', 'driver_arriving', 'in_progress', 'completed') OR "driverId" IS NOT NULL`. |
| `check_fare_non_negative` | `FareReceipt` | Check Constraint | **No negative fare or negative driver earnings.** `("totalFareMinor" >= 0) AND ("driverEarningsMinor" >= 0)`. |
| `check_fare_ledger_balances` | `FareReceipt` | Check Constraint | **The receipt reconciles.** `"totalFareMinor" = "platformFeeMinor" + "driverEarningsMinor"`. |
| `check_rating_1_to_5` | `Review` | Check Constraint | **No star rating outside 1–5.** `rating >= 1 AND rating <= 5`. |
| `FareReceipt_tripId_key` | `FareReceipt` | Unique Constraint | **One fare receipt per trip.** No double-billing of the same trip. |
| `Review_tripId_key` | `Review` | Unique Constraint | **One review per trip.** No review brigading by re-submitting. |

### Cross-table rule: `check_review_completed_trip_only`

**A review may only be written for a `completed` trip.** This is the one rule here that a CHECK constraint cannot express, and the reason is fundamental rather than a matter of taste: **a CHECK constraint cannot read another table.** `Review` holds only a `tripId`; whether that trip is completed lives in `Trip.status`, and PostgreSQL CHECK expressions are evaluated against the row being inserted alone.

A `UNIQUE` constraint would not help either — uniqueness and conditional validity are different properties.

The rule is therefore carried by a trigger:

| Object | Kind | Definition |
|---|---|---|
| `fn_review_completed_trip_only` | PL/pgSQL function | Reads the live `Trip` row; `RAISE`s SQLSTATE `23514` naming `check_review_completed_trip_only` when `status <> 'completed'`. |
| `trg_review_completed_trip_only` | `BEFORE INSERT OR UPDATE OF "tripId"` trigger on `Review` | `FOR EACH ROW EXECUTE FUNCTION fn_review_completed_trip_only()` |

Two consequences worth stating plainly:

1. **The logical name `check_review_completed_trip_only` is not a `pg_constraint` entry.** It cannot be — no CHECK constraint can express this rule. It is the stable identifier the trigger raises in its error message, so the API layer and its tests can key off one consistent token. The real catalog objects are the function and trigger named above.
2. **The check runs on `UPDATE OF "tripId"` as well as `INSERT`,** so re-pointing an existing review at a different, non-completed trip is rejected too.

Proof that all six non-completed statuses are rejected, with the server's verbatim messages: `evidence/constraint-violations.txt`.

---

## 7. Indexing Strategy for the Five Core Actions

Every query serving a core user action is backed by an index. The names below are quoted verbatim from `evidence/ddl-inventory.txt`.

| Core Action | Query shape | Index | Definition (verbatim from the catalog) |
|---|---|---|---|
| **Action 1:** Request Trip | Reject if the rider already has an active trip | `idx_trip_rider_status` | `CREATE INDEX idx_trip_rider_status ON public."Trip" USING btree ("riderId", status)` |
| **Action 2:** Driver Accept | Nearby available drivers | `idx_driver_status_geo` | `CREATE INDEX idx_driver_status_geo ON public."Driver" USING btree (status, "currentLat", "currentLng")` |
| **Action 3:** Driver Start | The driver's assigned/active trip | `idx_trip_driver_status` | `CREATE INDEX idx_trip_driver_status ON public."Trip" USING btree ("driverId", status)` |
| **Action 4:** Complete & Bill | Receipt for a trip | `FareReceipt_tripId_key` | `CREATE UNIQUE INDEX "FareReceipt_tripId_key" ON public."FareReceipt" USING btree ("tripId")` |
| **Action 5:** Rider Review | Completed trips eligible for review | `idx_trip_rider_completed` | `CREATE INDEX idx_trip_rider_completed ON public."Trip" USING btree ("riderId", "completedAt" DESC)` |

Plus `idx_trip_status_requestedAt` for the open-dispatch feed (`GET /api/v1/trips/requests`), and `idx_review_driver_rating` for the driver rating aggregate.

### Two kinds of index, and the difference matters

The `idx_*` names above are **lookup paths** — they speed up reads. The partial unique indexes (`idx_rider_single_active_trip`, `idx_driver_single_active_trip`, `idx_driver_single_active_vehicle`) are **enforcement objects**. They exist to make a bad write impossible, and no `EXPLAIN` will ever name one, because a plan only ever reports the access path a query took. Their behaviour is proven by the SQLSTATE `23505` rejections in `evidence/constraint-violations.txt` instead.

### What the planner actually did — the honest result

`evidence/query-plans.txt` holds 11 verbatim `EXPLAIN (ANALYZE, BUFFERS)` plans captured against the deployed database. **On the seeded dataset, every one of them chose a `Seq Scan`.** That is the correct plan, not a defect:

```
ROW COUNTS AT CAPTURE TIME
  Rider 5   Driver 5   Vehicle 5   Trip 5   FareReceipt 5   Review 5
```

A sequential scan of a 5-row heap that fits in a single shared buffer is faster than any index probe. Claiming these queries are index-served on this dataset would be false.

To show the indexes are nonetheless correctly shaped for the query each one serves, the file also captures each query with `enable_seqscan = off` in a transaction-local setting. Those diagnostic plans are labelled as such and confirm the planner *can* reach `idx_driver_status_geo` for the geofence query and `idx_trip_status_requestedAt` for the active-trip guard. Where a diagnostic plan picks a *different* index than the table above names, the file reports that rather than editing it to match the documentation.

The correct claim is therefore: **the indexes exist and are shaped for these query patterns; at production row counts the planner will use them. On a 5-row seed it correctly does not, and that is what the evidence shows.**
